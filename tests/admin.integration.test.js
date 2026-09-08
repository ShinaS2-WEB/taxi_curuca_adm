import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { doc, getDocFromServer, setDoc, serverTimestamp, terminate } from 'firebase/firestore';
import { deleteApp } from 'firebase/app';
import { documentVersion } from '../src/domain.js';

let env, backend, adminApp, adminAuth, adminDb, operator;
before(async () => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Execute somente nos emuladores.');
  env = await initializeTestEnvironment({ projectId: 'demo-taxi-curuca', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
  await env.clearFirestore();
  adminApp = initializeAdminApp({ projectId: 'demo-taxi-curuca' }, 'admin-integration');
  adminAuth = getAdminAuth(adminApp); adminDb = getAdminFirestore(adminApp);
  operator = await adminAuth.createUser({ email: `operator-${Date.now()}@example.com`, password: 'Operator12345' });
  await adminAuth.setCustomUserClaims(operator.uid, { admin: true });
  const configModule = 'data:text/javascript;base64,' + Buffer.from(`export const config = { firebase: { apiKey: 'demo-key', projectId: 'demo-taxi-curuca', authDomain: 'localhost' } };`).toString('base64');
  // Exercise the actual backend with npm equivalents of the CDN modules and emulator endpoints.
  let source = await readFile('src/firebase.js', 'utf8');
  for (const name of ['app', 'auth', 'firestore']) source = source.replaceAll(`https://www.gstatic.com/firebasejs/12.0.0/firebase-${name}.js`, import.meta.resolve(`firebase/${name}`));
  source = source.replace('../config.js', configModule).replace('./domain.js', new URL('../src/domain.js', import.meta.url).href);
  source = `import { connectAuthEmulator } from '${import.meta.resolve('firebase/auth')}';\nimport { connectFirestoreEmulator } from '${import.meta.resolve('firebase/firestore')}';\n` + source;
  source = source.replace('const db = getFirestore(app);', `const db = getFirestore(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true}); connectFirestoreEmulator(db, '127.0.0.1', 8080);`);
  source = source.replace('let created;', `connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', {disableWarnings: true}); let created;`);
  source += '\nexport { auth as testAuth, db as testDb, app as testApp };';
  backend = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  await backend.login(operator.email, 'Operator12345');
  await backend.ensureAdminProfile();
});
after(async () => {
  if (backend) { await backend.logout(); await terminate(backend.testDb); await deleteApp(backend.testApp); }
  await env?.cleanup(); await adminDb?.terminate(); if (adminApp) await deleteAdminApp(adminApp);
});
test('criação real no emulador preserva sessão e permite login da conta criada sem custom claim', async () => {
  await backend.createAdmin({ name: 'Nova Admin', email: 'new-admin@example.com', password: 'AdminSenha123', active: true });
  assert.equal(backend.testAuth.currentUser.uid, operator.uid);
  const created = await adminAuth.getUserByEmail('new-admin@example.com');
  const stored = await adminDb.doc(`admins/${created.uid}`).get();
  assert.equal(stored.data().active, true);
  assert.equal(stored.data().password, undefined);
  await backend.logout(); await backend.login('new-admin@example.com', 'AdminSenha123');
  assert.equal((await backend.requireAdmin()).uid, created.uid);
  assert.notEqual((await backend.testAuth.currentUser.getIdTokenResult()).claims.admin, true);
  await backend.logout(); await backend.login(operator.email, 'Operator12345');
});
test('edição concorrente e autodesativação bloqueadas; desativação revoga consultas de sessão aberta', async () => {
  const target = await adminAuth.getUserByEmail('new-admin@example.com');
  const snapshot = await getDocFromServer(doc(backend.testDb, 'admins', target.uid));
  const version = documentVersion(snapshot.data());
  await backend.saveAdmin(target.uid, { name: 'Nome atualizado', active: true }, version);
  await assert.rejects(() => backend.saveAdmin(target.uid, { name: 'Conflito', active: true }, version), /atualizado/);
  await assert.rejects(() => backend.saveAdmin(operator.uid, { name: 'Operador', active: false }, ''), /própria/);
  await backend.logout(); await backend.login('new-admin@example.com', 'AdminSenha123');
  await adminDb.doc(`admins/${target.uid}`).update({ active: false });
  await assert.rejects(() => backend.requireAdmin(), /ativo/);
  await assert.rejects(() => getDocFromServer(doc(backend.testDb, 'users', 'private-user')), /permission|permissions/i);
  await backend.logout(); await backend.login(operator.email, 'Operator12345');
});
test('e-mail duplicado não troca a sessão nem cria permissões adicionais', async () => {
  await assert.rejects(() => backend.createAdmin({ name: 'Duplicada', email: 'new-admin@example.com', password: 'AdminSenha123', active: true }));
  assert.equal(backend.testAuth.currentUser.uid, operator.uid);
});

test('envio do APK aparece em tempo real; aprovação e recusa retornam ao candidato', async () => {
  for (const status of ['approved', 'rejected']) {
    const uid = `candidate-${status}`;
    const passenger = env.authenticatedContext(uid).firestore();
    await setDoc(doc(passenger, 'users', uid), { fullName: 'Candidato do APK' });
    let stop;
    const received = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Solicitação não chegou ao painel')), 10000);
      stop = backend.subscribeData(data => {
        if (data.driverApplications.some(a => a.id === uid && a.status === 'pending')) {
          clearTimeout(timeout); resolve();
        }
      }, error => { clearTimeout(timeout); reject(error); });
    });
    try {
      // Same fields, document ID and set operation used by FirebaseRepository.kt.
      await setDoc(doc(passenger, 'driverApplications', uid), {
        userId: uid, vehicleModel: 'Honda CG', vehicleType: 'motorcycle', plate: 'ABC1D23',
        status: 'pending', submittedAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await received;
      await backend.reviewApplication(uid, { status, reason: status === 'rejected' ? 'Corrigir documentação' : '' });
      const application = await getDocFromServer(doc(passenger, 'driverApplications', uid));
      const profile = await getDocFromServer(doc(passenger, 'users', uid));
      const driver = await adminDb.doc(`drivers/${uid}`).get();
      assert.equal(application.data().status, status);
      assert.equal(application.data().reviewedBy, operator.uid);
      assert.equal(profile.data().driverApproved === true, status === 'approved');
      assert.equal(driver.exists, status === 'approved');
      if (driver.exists) assert.equal(driver.data().online, false);
      await assert.rejects(() => backend.reviewApplication(uid, { status, reason: 'Segunda análise' }), /pendente/);
    } finally { stop?.(); }
  }
});

test('admin edita usuário e converte nos dois sentidos sem perder histórico ou veículo', async () => {
  const uid = 'convert-user';
  const passenger = env.authenticatedContext(uid).firestore();
  await setDoc(doc(passenger, 'users', uid), { fullName: 'Nome antigo', email: 'contato@example.com' });
  const original = await backend.getUser(uid);
  const input = { fullName: 'Nome atualizado', phone: '91999999999', city: 'Curuçá', birthDate: '', emergencyContact: 'Maria', driverApproved: true, vehicleModel: 'Honda CG', vehicleType: 'motorcycle' };
  await backend.saveUser(uid, input, original.version);
  assert.equal((await backend.getUser(uid)).driverApproved, true);
  assert.equal((await adminDb.doc(`drivers/${uid}`).get()).data().online, false);
  assert.equal((await getDocFromServer(doc(passenger, 'driverApplications', uid))).data().status, 'approved');
  await assert.rejects(() => backend.saveUser(uid, input, original.version), /atualizado/);
  await adminDb.doc(`drivers/${uid}`).update({ online: true, origin: 'Centro', destination: 'Terminal', priceCents: 1500 });
  await adminDb.doc('trips/conversion-history').set({ driverId: uid, passengerId: 'other', status: 'completed' });
  await backend.saveUser(uid, { ...input, driverApproved: false }, (await backend.getUser(uid)).version);
  assert.equal((await backend.getUser(uid)).driverApproved, false);
  assert.equal((await adminDb.doc(`drivers/${uid}`).get()).data().online, false);
  assert.equal((await getDocFromServer(doc(passenger, 'driverApplications', uid))).data().status, 'rejected');
  await assert.rejects(() => setDoc(doc(passenger, 'drivers', uid), { online: true }, { merge: true }), /permission/i);
  await backend.saveUser(uid, input, (await backend.getUser(uid)).version);
  const restored = (await adminDb.doc(`drivers/${uid}`).get()).data();
  assert.equal(restored.online, false);
  assert.equal(restored.priceCents, 1500);
  assert.equal((await adminDb.doc('trips/conversion-history').get()).exists, true);
  assert.equal((await backend.getUser(uid)).email, 'contato@example.com');
});
