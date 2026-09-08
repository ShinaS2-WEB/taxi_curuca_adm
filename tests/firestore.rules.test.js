import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

let env;
const driver = { uid: 'd1', name: 'Maria Costa', vehicleModel: 'Spin', vehicleColor: 'Prata', vehicleType: 'car', serviceType: 'shared', origin: 'Centro', destination: 'Terminal', priceCents: 1200, seatsTotal: 6, seatsAvailable: 3, online: true };
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-taxi-curuca', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/p1'), { fullName: 'Passageiro', driverApproved: false }),
      setDoc(doc(db, 'users/d1'), { fullName: 'Maria Costa', driverApproved: true }),
      setDoc(doc(db, 'driverApplications/p1'), { userId: 'p1', status: 'pending', vehicleModel: 'Spin', vehicleType: 'car' }),
      setDoc(doc(db, 'drivers/d1'), driver),
      setDoc(doc(db, 'trips/t1'), { passengerId: 'p1', driverId: 'd1', status: 'confirmed', seats: 1 }),
      setDoc(doc(db, 'chats/c1'), { participantIds: ['p1', 'd1'], tripId: 't1' }),
      setDoc(doc(db, 'chats/c1/messages/m1'), { senderId: 'p1', text: 'Olá' }),
    ]);
  });
});
test('anônimo e passageiro não podem consultar os dados administrativos nem se promover', async () => {
  const anonymous = env.unauthenticatedContext().firestore();
  const passenger = env.authenticatedContext('p1').firestore();
  await assertFails(getDocs(collection(anonymous, 'users')));
  await assertFails(getDocs(collection(passenger, 'users')));
  await assertFails(updateDoc(doc(passenger, 'users/p1'), { driverApproved: true }));
  await assertFails(updateDoc(doc(passenger, 'driverApplications/p1'), { status: 'approved' }));
  await assertFails(getDoc(doc(passenger, 'users/d1')));
});
test('administrador consulta cadastros e mensagens, sem exclusão ou escrita de chat', async () => {
  const db = env.authenticatedContext('admin', { admin: true }).firestore();
  for (const name of ['users', 'drivers', 'driverApplications', 'trips', 'chats']) await assertSucceeds(getDocs(collection(db, name)));
  await assertSucceeds(getDocs(collection(db, 'chats/c1/messages')));
  await assertFails(deleteDoc(doc(db, 'users/p1')));
  await assertFails(setDoc(doc(db, 'chats/c1/messages/new'), { senderId: 'admin', text: 'indevido' }));
});
test('aprovação exige atualização atômica do perfil e permite criação do motorista', async () => {
  const db = env.authenticatedContext('admin', { admin: true }).firestore();
  const review = { status: 'approved', reason: '', reviewedBy: 'admin', updatedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(db, 'driverApplications/p1'), review));
  await assertFails(updateDoc(doc(db, 'users/p1'), { driverApproved: true }));
  const batch = writeBatch(db);
  batch.update(doc(db, 'driverApplications/p1'), review);
  batch.update(doc(db, 'users/p1'), { driverApproved: true });
  batch.set(doc(db, 'drivers/p1'), { ...driver, uid: 'p1', online: false, seatsTotal: 1, seatsAvailable: 1, priceCents: 0 });
  batch.set(doc(db, 'adminAudit/review'), { adminId: 'admin', action: 'application.review', target: 'p1', detail: { status: 'approved' }, createdAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(doc(db, 'driverApplications/p1'), { ...review, status: 'rejected', reason: 'Correção' }));
  await assertFails(deleteDoc(doc(db, 'adminAudit/review')));
});
test('regras validam vagas, recusa e transições mesmo fora da interface', async () => {
  const db = env.authenticatedContext('admin', { admin: true }).firestore();
  await assertFails(updateDoc(doc(db, 'drivers/d1'), { seatsAvailable: 7, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'drivers/d1'), { seatsAvailable: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'driverApplications/p1'), { status: 'rejected', reason: '', reviewedBy: 'admin', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'driverApplications/p1'), { status: 'rejected', reason: 'Corrigir placa', reviewedBy: 'admin', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'trips/t1'), { status: 'completed', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'trips/t1'), { status: 'accepted', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'trips/t1'), { passengerId: 'admin' }));
});
test('fluxos existentes do aplicativo: perfil próprio, reserva e mensagens dos participantes', async () => {
  const db = env.authenticatedContext('p1').firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/p1'), { fullName: 'Nome atualizado' }));
  await assertSucceeds(getDoc(doc(db, 'trips/t1')));
  await assertSucceeds(getDocs(collection(db, 'chats/c1/messages')));
  const batch = writeBatch(db);
  batch.set(doc(db, 'trips/t2'), { passengerId: 'p1', driverId: 'd1', status: 'confirmed', seats: 1 });
  batch.update(doc(db, 'drivers/d1'), { seatsAvailable: 2, lastReservationId: 't2' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(setDoc(doc(db, 'chats/c1/messages/m2'), { senderId: 'p1', text: 'Estou chegando' }));
});
test('somente administradores ativos podem criar e editar administradores', async () => {
  const admin = env.authenticatedContext('admin', { admin: true }).firestore();
  const passenger = env.authenticatedContext('p1').firestore();
  const body = { name: 'Nova administradora', email: 'nova@exemplo.com', active: true, createdBy: 'admin', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(setDoc(doc(passenger, 'admins/p1'), { ...body, createdBy: 'p1' }));
  await assertFails(getDocs(collection(passenger, 'admins')));
  await assertSucceeds(setDoc(doc(admin, 'admins/new'), body));
  const member = env.authenticatedContext('new').firestore();
  await assertSucceeds(getDocs(collection(member, 'users')));
  await assertSucceeds(updateDoc(doc(member, 'admins/new'), { name: 'Nome editado', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(member, 'admins/new'), { active: false, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(member, 'admins/new'), { email: 'troca@exemplo.com', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(admin, 'admins/new'), { active: false, updatedAt: serverTimestamp() }));
  await assertFails(getDocs(collection(member, 'users')));
  await assertFails(updateDoc(doc(member, 'admins/new'), { active: true, updatedAt: serverTimestamp() }));
  const staleClaim = env.authenticatedContext('new', { admin: true }).firestore();
  await assertFails(getDocs(collection(staleClaim, 'users')));
  await assertFails(deleteDoc(doc(admin, 'admins/new')));
});
