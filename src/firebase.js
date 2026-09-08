import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail, onIdTokenChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getFirestore, collection, doc, getDocFromServer, onSnapshot, query, limit, orderBy, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { config } from '../config.js';
import { checkTransition, validateDriver, validateReview, validateAdmin, validateUser, documentVersion } from './domain.js';

const app = initializeApp(config.firebase);
const auth = getAuth(app);
const db = getFirestore(app);
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
export const watchSession = callback => onIdTokenChanged(auth, callback);
export const resetPassword = email => sendPasswordResetEmail(auth, email.trim());
export async function requireAdmin() {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre com sua conta de administrador.');
  const profile = await getDocFromServer(doc(db, 'admins', user.uid));
  const allowed = profile.exists() ? profile.data().active === true : (await user.getIdTokenResult()).claims.admin === true;
  if (!allowed) throw new Error('Esta conta não tem acesso administrativo ativo.');
  return user;
}
export async function ensureAdminProfile() {
  const user = await requireAdmin();
  await runTransaction(db, async tx => {
    const ref = doc(db, 'admins', user.uid);
    const snap = await tx.get(ref);
    if (!snap.exists()) tx.set(ref, { name: user.displayName?.trim().length >= 2 ? user.displayName.trim().slice(0, 120) : 'Administrador', email: user.email || '', active: true, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
}
export function watchAdminAccess(callback, onError) {
  return onSnapshot(doc(db, 'admins', auth.currentUser.uid), snap => callback(snap.exists() && snap.data().active === true), onError);
}
export async function createAdmin(input) {
  const actor = await requireAdmin();
  const body = validateAdmin(input, true);
  // A separate, memory-only Auth instance keeps the operator's session intact.
  const secondary = initializeApp(config.firebase, `admin-create-${crypto.randomUUID()}`);
  const secondaryAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
  let created;
  try {
    created = (await createUserWithEmailAndPassword(secondaryAuth, body.email, input.password)).user;
    await runTransaction(db, async tx => {
      const ref = doc(db, 'admins', created.uid);
      const current = await tx.get(ref);
      if (current.exists()) throw new Error('Esta conta já possui cadastro administrativo.');
      tx.set(ref, { ...body, createdBy: actor.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      audit(tx, actor, 'admin.create', created.uid, body);
    });
  } catch (error) {
    if (created) {
      // Do not delete a successfully committed account after an ambiguous network error.
      try {
        const saved = await getDocFromServer(doc(db, 'admins', created.uid));
        if (saved.exists()) return;
        await deleteUser(created);
      } catch {
        throw new Error(`Não foi possível confirmar o cadastro. Confira a conta ${body.email} (UID ${created.uid}) no Firebase antes de tentar novamente.`);
      }
    }
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondary);
  }
}
export async function saveAdmin(id, input, version) {
  const actor = await requireAdmin();
  const body = validateAdmin(input);
  if (actor.uid === id && !body.active) throw new Error('Você não pode desativar sua própria conta.');
  await runTransaction(db, async tx => {
    const ref = doc(db, 'admins', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Administrador não encontrado.');
    if (documentVersion(snap.data()) !== version) throw new Error('Este administrador foi atualizado. Feche e reabra o cadastro.');
    tx.update(ref, { name: body.name, active: body.active, updatedAt: serverTimestamp() });
    audit(tx, actor, 'admin.update', id, { name: body.name, active: body.active });
  });
}
export function subscribeData(onData, onError) {
  const names = ['users', 'drivers', 'driverApplications', 'trips', 'chats', 'admins'];
  const data = {};
  const ready = new Set();
  let stopped = false;
  const stops = names.map(name => onSnapshot(query(collection(db, name), limit(1001)), snapshot => {
    if (stopped) return;
    if (snapshot.size > 1000) {
      onError(new Error('A coleção excedeu 1.000 registros. É necessário paginar a consulta antes de continuar.'));
      return;
    }
    data[name] = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
    ready.add(name);
    if (ready.size === names.length) onData({ ...data });
  }, onError));
  return () => { stopped = true; stops.forEach(stop => stop()); };
}
function audit(tx, user, action, target, detail) {
  tx.set(doc(collection(db, 'adminAudit')), { adminId: user.uid, action, target, detail, createdAt: serverTimestamp() });
}
export async function getDriver(id) {
  await requireAdmin();
  const snap = await getDocFromServer(doc(db, 'drivers', id));
  if (!snap.exists()) throw new Error('Motorista não encontrado.');
  return { ...snap.data(), id: snap.id, version: documentVersion(snap.data()) };
}
export async function saveDriver(id, input, version) {
  const user = await requireAdmin();
  const body = validateDriver(input);
  await runTransaction(db, async tx => {
    const ref = doc(db, 'drivers', id);
    const snap = await tx.get(ref);
    const profile = await tx.get(doc(db, 'users', id));
    if (!snap.exists()) throw new Error('Motorista não encontrado.');
    if (documentVersion(snap.data()) !== version) throw new Error('O motorista foi atualizado. Feche e reabra o cadastro antes de salvar.');
    if (body.online && profile.data()?.driverApproved !== true) throw new Error('Motorista sem aprovação.');
    tx.update(ref, { ...body, updatedAt: serverTimestamp() });
    audit(tx, user, 'driver.update', id, body);
  });
}
export async function reviewApplication(id, input) {
  const user = await requireAdmin();
  const body = validateReview(input);
  await runTransaction(db, async tx => {
    const ref = doc(db, 'driverApplications', id);
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status !== 'pending') throw new Error('Solicitação não está pendente.');
    const application = snap.data();
    if (application.userId !== id) throw new Error('Identificação da solicitação inconsistente.');
    const userRef = doc(db, 'users', id);
    const driverRef = doc(db, 'drivers', id);
    const profile = await tx.get(userRef);
    const driver = await tx.get(driverRef);
    if (!profile.exists()) throw new Error('Perfil do passageiro não encontrado.');
    tx.update(ref, { ...body, reviewedBy: user.uid, updatedAt: serverTimestamp() });
    if (body.status === 'approved') {
      tx.update(userRef, { driverApproved: true });
      if (!driver.exists()) tx.set(driverRef, { uid: id, name: profile.data().fullName || '', vehicleType: application.vehicleType, vehicleModel: application.vehicleModel, vehicleColor: '', serviceType: 'private', origin: '', destination: '', priceCents: 0, seatsTotal: 1, seatsAvailable: 1, online: false });
    }
    audit(tx, user, 'application.review', id, body);
  });
}
export async function changeTripStatus(id, status) {
  const user = await requireAdmin();
  await runTransaction(db, async tx => {
    const ref = doc(db, 'trips', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Viagem não encontrada.');
    checkTransition(snap.data().status, status);
    tx.update(ref, { status, updatedAt: serverTimestamp() });
    audit(tx, user, 'trip.status', id, { from: snap.data().status, status });
  });
}
export async function getUser(id) {
  await requireAdmin();
  const snapshot = await getDocFromServer(doc(db, 'users', id));
  if (!snapshot.exists()) throw new Error('Usuário não encontrado.');
  return { ...snapshot.data(), id, version: documentVersion(snapshot.data()) };
}
export async function saveUser(id, input, version) {
  const actor = await requireAdmin();
  const { profile: body, vehicleModel, vehicleType } = validateUser(input);
  await runTransaction(db, async tx => {
    const userRef = doc(db, 'users', id);
    const driverRef = doc(db, 'drivers', id);
    const applicationRef = doc(db, 'driverApplications', id);
    const profile = await tx.get(userRef);
    const driver = await tx.get(driverRef);
    const application = await tx.get(applicationRef);
    if (!profile.exists()) throw new Error('Usuário não encontrado.');
    if (documentVersion(profile.data()) !== version) throw new Error('O usuário foi atualizado. Feche e reabra o cadastro.');
    const changedRole = (profile.data().driverApproved === true) !== body.driverApproved;
    tx.update(userRef, { ...body, updatedAt: serverTimestamp() });
    if (body.driverApproved && !driver.exists()) {
      tx.set(driverRef, { uid: id, name: body.fullName, vehicleModel, vehicleType, vehicleColor: '', serviceType: 'private', origin: '', destination: '', priceCents: 0, seatsTotal: 1, seatsAvailable: 1, online: false, updatedAt: serverTimestamp() });
    } else if (driver.exists()) {
      tx.update(driverRef, { name: body.fullName, ...(!body.driverApproved || changedRole ? { online: false } : {}), updatedAt: serverTimestamp() });
    }
    if (changedRole) {
      const decision = { status: body.driverApproved ? 'approved' : 'rejected', reason: body.driverApproved ? '' : 'Convertido em passageiro pela administração.', reviewedBy: actor.uid, updatedAt: serverTimestamp() };
      if (application.exists()) tx.update(applicationRef, decision);
      else if (body.driverApproved) tx.set(applicationRef, { userId: id, vehicleModel, vehicleType, plate: '', submittedAt: serverTimestamp(), ...decision });
    }
    audit(tx, actor, 'user.update', id, { ...body, previousDriverApproved: profile.data().driverApproved === true });
  });
}
export function subscribeMessages(id, callback, onError) {
  return onSnapshot(query(collection(db, 'chats', id, 'messages'), orderBy('sentAt', 'desc'), limit(100)), snap => callback(snap.docs.map(d => ({ ...d.data(), id: d.id })).reverse()), onError);
}
