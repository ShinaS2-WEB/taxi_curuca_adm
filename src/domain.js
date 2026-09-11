export const transitions = { requested: ['accepted', 'cancelled'], confirmed: ['accepted', 'cancelled'], accepted: ['in_progress', 'cancelled'], in_progress: ['completed'], completed: [], cancelled: [] };
export function checkTransition(from, to) {
  if (!transitions[from]?.includes(to)) throw new Error('Esta mudança de status não é permitida. Atualize os dados.');
}
export function validateDriver(input) {
  const result = {};
  for (const [key, min, max] of [['name', 2, 120], ['vehicleModel', 2, 100], ['vehicleColor', 0, 40], ['origin', 2, 150], ['destination', 2, 150]]) {
    const value = String(input[key] ?? '').trim();
    if (value.length < min || value.length > max) throw new Error('Preencha nome, veículo e trajeto dentro dos limites indicados.');
    result[key] = value;
  }
  for (const [key, values] of [['vehicleType', ['car', 'motorcycle']], ['serviceType', ['private', 'shared']]]) {
    if (!values.includes(input[key])) throw new Error('Tipo de veículo ou serviço inválido.');
    result[key] = input[key];
  }
  for (const [key, min, max] of [['priceCents', 0, 1000000], ['seatsTotal', 1, 20], ['seatsAvailable', 0, 20]]) {
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error('Confira o preço e a quantidade de vagas.');
    result[key] = input[key];
  }
  if (typeof input.online !== 'boolean') throw new Error('Disponibilidade inválida.');
  result.online = input.online;
  if (result.seatsAvailable > result.seatsTotal) throw new Error('Vagas disponíveis excedem a capacidade.');
  if (result.vehicleType === 'motorcycle' && (result.seatsTotal !== 1 || result.serviceType !== 'private')) throw new Error('Moto permite um passageiro e serviço particular.');
  return result;
}
export function validateReview(input) {
  const reason = String(input.reason ?? '').trim();
  if (!['approved', 'rejected'].includes(input.status) || reason.length > 500 || (input.status === 'rejected' && reason.length < 5)) throw new Error('Informe o motivo da recusa (5 a 500 caracteres).');
  return { status: input.status, reason };
}
export function validateUser(input) {
  const body = {};
  for (const [key, min, max] of [['fullName', 2, 120], ['phone', 0, 40], ['city', 0, 150], ['birthDate', 0, 10], ['emergencyContact', 0, 200]]) {
    const value = String(input[key] ?? '').trim();
    if (value.length < min || value.length > max) throw new Error('Confira o nome e os limites dos dados pessoais.');
    body[key] = value;
  }
  if (typeof input.driverApproved !== 'boolean') throw new Error('Tipo de usuário inválido.');
  body.driverApproved = input.driverApproved;
  const vehicleModel = String(input.vehicleModel ?? '').trim();
  const vehicleType = input.vehicleType || 'car';
  if (body.driverApproved && (vehicleModel.length < 2 || vehicleModel.length > 100 || !['car', 'motorcycle'].includes(vehicleType))) throw new Error('Informe o modelo e o tipo do veículo para converter em motorista.');
  return { profile: body, vehicleModel, vehicleType };
}
// Compare the full document, including app reservations that do not set updatedAt.
export function documentVersion(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return JSON.stringify(canonical(value));
}
export function validateAdmin(input, creating = false) {
  const name = String(input.name ?? '').trim();
  if (name.length < 2 || name.length > 120) throw new Error('Informe um nome entre 2 e 120 caracteres.');
  if (typeof input.active !== 'boolean') throw new Error('Situação de acesso inválida.');
  const body = { name, active: input.active };
  if (creating) {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Informe um e-mail válido.');
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) throw new Error('A senha inicial deve ter entre 8 e 128 caracteres.');
    body.email = email;
  }
  return body;
}
