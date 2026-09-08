import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDriver, validateReview, validateAdmin, checkTransition, documentVersion } from '../src/domain.js';
import { dateValue } from '../src/data.js';

const driver = { name: 'Maria Costa', vehicleModel: 'Chevrolet Spin', vehicleColor: 'Prata', vehicleType: 'car', serviceType: 'shared', origin: 'Centro', destination: 'Terminal', priceCents: 1200, seatsTotal: 6, seatsAvailable: 3, online: true };
test('validação de disponibilidade impede sobrelotação, valores fracionários e moto compartilhada', () => {
  assert.deepEqual(validateDriver(driver), driver);
  assert.throws(() => validateDriver({ ...driver, seatsAvailable: 7 }));
  assert.throws(() => validateDriver({ ...driver, seatsAvailable: 1.5 }));
  assert.throws(() => validateDriver({ ...driver, vehicleType: 'motorcycle' }));
  assert.throws(() => validateDriver({ ...driver, priceCents: -1 }));
});
test('revisão e transições não aceitam recusas vazias ou reabertura de viagem', () => {
  assert.throws(() => validateReview({ status: 'rejected', reason: '  ' }));
  assert.throws(() => validateReview({ status: 'pending' }));
  assert.equal(validateReview({ status: 'rejected', reason: ' Corrigir placa ' }).reason, 'Corrigir placa');
  checkTransition('confirmed', 'accepted');
  assert.throws(() => checkTransition('completed', 'accepted'));
  assert.throws(() => checkTransition('confirmed', 'completed'));
});
test('versão detecta reservas do Android mesmo quando updatedAt não muda', () => {
  const original = { ...driver, updatedAt: { seconds: 10, nanoseconds: 1 } };
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(documentVersion(original), documentVersion(reordered));
  assert.notEqual(documentVersion(original), documentVersion({ ...original, seatsAvailable: 2, lastReservationId: 'new-trip' }));
});
test('datas aceitam Timestamp do SDK, serialização antiga e epoch zero', () => {
  assert.equal(dateValue({ toDate: () => new Date(1000) }).getTime(), 1000);
  assert.equal(dateValue({ seconds: 0 }).getTime(), 0);
  assert.equal(dateValue({ _seconds: 10 }).getTime(), 10000);
  assert.equal(dateValue(null), null);
});
test('administradores: validação normaliza e-mail e nunca retorna a senha para persistência', () => {
  const input = { name: '  Maria Admin ', email: ' MARIA@EXEMPLO.COM ', password: 'Senhaforte123', active: true };
  assert.deepEqual(validateAdmin(input, true), { name: 'Maria Admin', email: 'maria@exemplo.com', active: true });
  assert.throws(() => validateAdmin({ ...input, password: '123' }, true));
  assert.throws(() => validateAdmin({ ...input, email: 'invalid' }, true));
  assert.throws(() => validateAdmin({ ...input, active: 'true' }));
  assert.deepEqual(validateAdmin({ ...input, active: false }), { name: 'Maria Admin', active: false });
});
