import { mkdir, copyFile, rm, lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

// Only these public files belong in the deployment artifact.
const publicFiles = ['index.html', 'config.js', '.nojekyll', 'src/app.js', 'src/firebase.js', 'src/domain.js', 'src/data.js', 'src/styles.css'];
if (config.dataMode !== 'firebase') throw new Error('Publicação exige dataMode firebase.');
for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
  if (typeof config.firebase?.[key] !== 'string' || !config.firebase[key].trim()) {
    throw new Error(`Configuração Firebase ausente: ${key}`);
  }
}
// Reject common private credentials without printing their contents.
const privateCredential = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|["']private_key["']\s*:|["']type["']\s*:\s*["']service_account["']|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/;
for (const file of publicFiles) {
  if (!(await lstat(file)).isFile()) throw new Error(`Arquivo público inválido: ${file}`);
  if (privateCredential.test(await readFile(file, 'utf8'))) {
    throw new Error(`Possível credencial privada em ${file}. Publicação interrompida.`);
  }
}
const output = resolve('dist');
if (dirname(output) !== resolve('.')) throw new Error('A saída deve ficar dentro do projeto.');
const existing = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing?.isSymbolicLink()) throw new Error('A pasta dist não pode ser um link.');
await rm(output, { recursive: true, force: true });
for (const file of publicFiles) {
  const target = resolve('dist', file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(file), target);
}
console.log('Arquivos públicos copiados para dist. Sem compilação ou dependências de runtime Node.');
