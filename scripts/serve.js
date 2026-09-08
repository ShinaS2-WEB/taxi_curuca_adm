import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const directory = resolve(process.argv[2] || '.');
const allowed = new Set(['index.html', 'config.js', '.nojekyll', 'src/app.js', 'src/firebase.js', 'src/domain.js', 'src/data.js', 'src/styles.css']);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const prefix = process.env.SITE_PREFIX || '/';
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    const target = resolve(directory, relative);
    if (!allowed.has(relative) || !target.startsWith(directory + sep)) { res.writeHead(404).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'text/plain', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Painel: http://127.0.0.1:${process.env.PORT || 4173}${prefix}`));
