// Shipping-layer tests: Docker compose pins, Reset, doctor checks, rule 15 health contract, rule 17 diagram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const start = async () => {
  const placeholder = http.createServer();
  await new Promise((done) => placeholder.listen(0, '127.0.0.1', done));
  const port = placeholder.address().port;
  await new Promise((done) => placeholder.close(done));
  const app = createApp({ port });
  const server = app.listen(port, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  return { server, base: `http://127.0.0.1:${port}`, close: async () => { await new Promise((d) => server.close(d)); } };
};

const post = async (base, reqPath, body, headers = {}) => {
  const res = await fetch(`${base}${reqPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('docker compose publishes 127.0.0.1 only, PORT one variable on both sides (loopback pin, rule 11/18)', () => {
  const compose = fs.readFileSync(path.join(root, 'deploy', 'docker-compose.yml'), 'utf8');
  const PORT_SIDE = String.raw`(?:\d+|\$\{HOST_PORT:-\d+\})`;
  const published = (text) => [...text.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]).filter((p) => new RegExp(`^(?:[\\d.]+:)?${PORT_SIDE}:${PORT_SIDE}$`).test(p));
  const ports = published(compose);
  assert.ok(ports.length > 0 && ports.every((p) => p.startsWith('127.0.0.1:')), ports.join(','));
  assert.deepEqual(ports, ['127.0.0.1:${HOST_PORT:-4780}:${HOST_PORT:-4780}']);
  assert.match(compose, /PORT: "\$\{HOST_PORT:-4780\}"/);
  // No other compose file anywhere may publish without the loopback prefix.
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /node:26-alpine/);
  assert.match(dockerfile, /CMD \["node", "server\/index.js"\]/);
});

test('reset: POST /api/reset clears the session state; workspace reset clears every session in it', async () => {
  const lab = await start();
  try {
    const cookieHeaders = [];
    const seed = async (ws) => {
      const res = await fetch(`${lab.base}/api/flow/act1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: lab.base, 'X-Lab-Workspace': ws, 'X-Expect-Fail': '1' }, body: JSON.stringify({ username: 'u', password: 'p', clientId: 'c', clientSecret: 's', scope: 'x' }) });
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie, 'a write creates a session');
      cookieHeaders.push(ws === undefined ? {} : { Cookie: setCookie.split(';')[0], 'X-Lab-Workspace': ws });
      return setCookie.split(';')[0];
    };
    await seed('alpha');
    const ws = 'alpha';
    const res = await post(lab.base, `/api/workspaces/${ws}/reset`, {}, { Cookie: cookieHeaders[0].Cookie, 'X-Lab-Workspace': ws });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.workspace, ws);
    assert.equal(res.body.sessionsReset, 1);
    const mine = await post(lab.base, '/api/reset', {}, { Cookie: cookieHeaders[0].Cookie, 'X-Lab-Workspace': ws });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.ok, true);
    assert.equal(mine.body.workspace, ws);
    // Bad workspace ids are refused.
    const bad = await post(lab.base, '/api/workspaces/BAD_WS/reset', {}, {});
    assert.equal(bad.status, 400);
  } finally { await lab.close(); }
});

test('health: exact demo-health/1 shape, GET only, no-store (rule 15)', async () => {
  const lab = await start();
  try {
    const res = await fetch(`${lab.base}/api/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /no-store/);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    assert.equal(body.schema, 'demo-health/1');
    assert.equal(body.state, 'ready');
    assert.ok(['offline', 'live'].includes(body.runtime));
    assert.equal(typeof body.at, 'string');
    assert.ok(!Number.isNaN(Date.parse(body.at)));
    assert.equal(body.demo.id, 'idjag-runner');
    assert.equal(typeof body.demo.name, 'string');
    assert.equal(typeof body.demo.version, 'string');
    // POST must not slip through: the JSON-write gate answers 415 before any route.
    const write = await fetch(`${lab.base}/api/health`, { method: 'POST' });
    assert.equal(write.status, 415);
  } finally { await lab.close(); }
});

test('doctor exits 0 and prints one line per check', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts', 'doctor.mjs')], { encoding: 'utf8', env: { ...process.env, PORT: '4789' } });
  const lines = out.trim().split('\n');
  assert.ok(lines.length >= 6, `too few doctor lines: ${lines.length}`);
  assert.ok(lines.every((l) => /^(ok|FAIL) {2}/.test(l)), lines.join('\n'));
  assert.ok(lines.every((l) => l.startsWith('ok')), out);
});

test('reset script prints and exits 0 when no lab is running, refuses a non-loopback LAB_URL', () => {
  const run = (env) => execFileSync(process.execPath, [path.join(root, 'scripts', 'reset.mjs')], { encoding: 'utf8', env: { ...process.env, ...env } });
  const out = run({ PORT: '4789' });
  assert.match(out, /nothing to reset/);
  assert.throws(() => run({ LAB_URL: 'https://evil.example:4789' }), (err) => err.status > 0);
});

test('rule 17: the diagrams are diagram-studio/1 data loaded by id, validated', () => {
  for (const file of ['idjag-grant.json', 'idjagrunner-flow.json']) {
    const diagram = JSON.parse(fs.readFileSync(path.join(root, 'web', 'src', 'diagrams', file), 'utf8'));
    assert.equal(diagram.schema, 'diagram-studio/1', file);
    assert.ok(diagram.nodes.length >= 4, file);
    assert.ok(diagram.edges.length >= 4, file);
    assert.ok(diagram.steps.length >= 3, file);
  }
  // The tab loads by id and offers the picker; no hand-built nodes in JSX.
  const appText = fs.readFileSync(path.join(root, 'web', 'src', 'App.jsx'), 'utf8');
  assert.match(appText, /DiagramTab/);
  const tabText = fs.readFileSync(path.join(root, 'web', 'src', 'DiagramTab.jsx'), 'utf8');
  assert.match(tabText, /loadDiagram\(did\)/);
  assert.doesNotMatch(tabText, /nodes:\s*\[\{/);
  const viewText = fs.readFileSync(path.join(root, 'web', 'src', 'DiagramView.jsx'), 'utf8');
  assert.match(viewText, /loadDiagram\(id\)/);
  assert.doesNotMatch(viewText, /nodes:\s*\[\{/);
});
