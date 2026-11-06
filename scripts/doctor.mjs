// npm run doctor: one line per check, exit 1 when any fails. Real-PF lab: nothing here calls PingFederate.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, DEMO } from '../server/src/app.js';
import { validateDiagram } from '../web/src/diagrams/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const listenFree = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', (error) => resolve(error.code === 'EADDRINUSE' ? 'busy' : 'error'));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve('free')));
});

const getHealth = (port) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; if (text.length > 8192) req.destroy(); });
    res.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve(null); } });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => req.destroy());
});

check('node 26 or newer', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 26) throw new Error(`Node ${process.versions.node}; this lab needs 26`);
  return `Node ${process.versions.node}`;
});

check('web dist built (npm run build -w web)', () => {
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) throw new Error('web/dist/index.html missing');
  return 'web/dist/index.html present';
});

check('compose publishes 127.0.0.1 only', () => {
  const file = path.join(root, 'deploy', 'docker-compose.yml');
  const text = fs.readFileSync(file, 'utf8');
  const ports = [...text.matchAll(/^\s*-\s+"([^"]+)"\s*$/gm)].map((m) => m[1]).filter((p) => /^\S*:\d+:\d+$/.test(p) || /^\S*:\$\{[^}]+\}:\$\{[^}]+\}$/.test(p));
  if (!ports.length) throw new Error('no published ports found');
  if (!ports.every((p) => p.startsWith('127.0.0.1:'))) throw new Error(`non-loopback publish: ${ports.join(', ')}`);
  return ports.join(', ');
});

check('settings default present', () => {
  const text = fs.readFileSync(path.join(root, 'server', 'src', 'settings.js'), 'utf8');
  if (!/DEFAULT_RUNTIME_URL = 'https:\/\//.test(text)) throw new Error('DEFAULT_RUNTIME_URL missing');
  return 'a default PF runtime URL is compiled in (live mode needs no settings file)';
});

check('health route answers demo-health/1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idjag-doctor-'));
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, webDist: path.join(dir, 'no-dist') }));
  try {
    const health = await getHealth(port);
    if (health?.schema !== 'demo-health/1' || health.demo?.id !== DEMO.id) throw new Error('unexpected health reply');
    return `state ${health.state}, runtime ${health.runtime}`;
  } finally { server.closeAllConnections(); server.close(); }
});

check('port free, or already this lab', async () => {
  const port = Number(process.env.PORT || 4780);
  if (!Number.isInteger(port) || port < 4700 || port > 5299) throw new Error('PORT must be in the A range 47xx-52xx (not 4840)');
  if (await listenFree(port) === 'free') return `${port} is free`;
  const health = await getHealth(port);
  if (health?.demo?.id === DEMO.id) return `${port} is in use by this lab (${health.runtime})`;
  throw new Error(`${port} is in use by something else`);
});

check('diagrams validate', () => {
  const dir = path.join(root, 'web', 'src', 'diagrams');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error('no diagrams found');
  for (const f of files) {
    const problems = validateDiagram(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (problems.length) throw new Error(`${f}: ${problems[0]}`);
  }
  return `${files.length} diagram-studio/1 diagrams validate`;
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    const detail = await fn();
    console.log(`ok    ${name}${detail ? `: ${detail}` : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
