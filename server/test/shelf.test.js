import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const start = async (env = {}) => {
  const placeholder = http.createServer();
  await new Promise((done) => placeholder.listen(0, '127.0.0.1', done));
  const port = placeholder.address().port;
  await new Promise((done) => placeholder.close(done));
  const app = createApp({ port, env: { ...env }, defaultRuntimeUrl: 'https://runtime.example' });
  const server = app.listen(port, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const base = `http://127.0.0.1:${port}`;
  return { server, base, close: async () => { await new Promise((d) => server.close(d)); } };
};

const get = async (base, p) => {
  const url = new URL(`${base}${p}`);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: url.host } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
};

test('/api/shelf returns the SHELF_URL from env with no-store', async (t) => {
  const ctx = await start({ SHELF_URL: 'https://shelf.example/' });
  t.after(() => ctx.close());
  const r = await get(ctx.base, '/api/shelf');
  assert.equal(r.status, 200);
  assert.equal(r.body.shelfUrl, 'https://shelf.example'); // trailing slash stripped
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('/api/shelf answers gracefully (shelfUrl null) when SHELF_URL is unset', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idjag-shelf-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const settingsFile = path.join(dir, '.env');
  const ctx = await start({ HOME: dir, STANDALONE_ENV: settingsFile });
  t.after(() => ctx.close());
  const r = await get(ctx.base, '/api/shelf');
  assert.equal(r.status, 200);
  assert.equal(r.body.shelfUrl, null);
});

test('/api/shelf reads SHELF_URL from the STANDALONE_ENV settings file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idjag-shelf-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(dir, '.env'), 'SHELF_URL="https://shelf-file.example"\nOTHER=1\n');
  const ctx = await start({ HOME: dir, STANDALONE_ENV: path.join(dir, '.env') });
  t.after(() => ctx.close());
  const r = await get(ctx.base, '/api/shelf');
  assert.equal(r.status, 200);
  assert.equal(r.body.shelfUrl, 'https://shelf-file.example');
});

test('/api/shelf rejects a POST (read-only route)', async (t) => {
  const ctx = await start({ SHELF_URL: 'https://shelf.example:8443/' });
  t.after(() => ctx.close());
  const url = new URL(`${ctx.base}/api/shelf`);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname, headers: { Host: url.host, 'Content-Type': 'application/json', Origin: ctx.base } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end('{}');
  });
  assert.notEqual(status, 200);
});
