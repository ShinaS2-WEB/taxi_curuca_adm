import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const uid = process.argv[2];
if (!uid) throw new Error('Uso: node --env-file=.env scripts/grant-admin.js UID');
initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT });
const user = await getAuth().getUser(uid);
await getAuth().setCustomUserClaims(uid, { ...user.customClaims, admin: true });
const ref = getFirestore().collection('admins').doc(uid);
await getFirestore().runTransaction(async tx => {
  const current = await tx.get(ref);
  tx.set(ref, {
    name: current.data()?.name || (user.displayName?.length >= 2 ? user.displayName : 'Administrador'),
    email: user.email || '', active: true, updatedAt: FieldValue.serverTimestamp(),
    ...(!current.exists ? { createdBy: uid, createdAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
});
console.log('Permissão de administrador atribuída. Entre novamente no painel.');
