import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetguard } from '../src/netguard.js';

test('netguard self-test: non-configured origins are refused, real fetch never called by refusals', async () => {
  const real = async () => { throw new Error('real fetch called'); };
  const guard = createNetguard({ getAllowedOrigin: () => new URL('http://127.0.0.1:9'), realFetch: real });
  const result = await guard.selfTest();
  assert.equal(result.ok, true, JSON.stringify(result.checks));
});

test('netguard refuses outbound to any other origin than the configured runtime', async () => {
  let realCalls = 0;
  const guard = createNetguard({
    getAllowedOrigin: () => new URL('https://runtime.example'),
    realFetch: async () => { realCalls += 1; return new Response('{}'); },
  });
  await assert.rejects(guard.fetchImpl('https://runtime.invalid/x', { method: 'GET' }));
  await assert.rejects(guard.fetchImpl('http://127.0.0.1:1/x', { method: 'GET' }));
  assert.equal(realCalls, 0);
  assert.equal(guard.stats().refused, 2);
});

test('netguard allows the configured https origin and loopback http (tests)', async () => {
  const guard = createNetguard({
    getAllowedOrigin: () => new URL('http://127.0.0.1:9'),
    realFetch: async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
  });
  const r = await guard.fetchImpl('http://127.0.0.1:9/.well-known/openid-configuration', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(guard.stats().allowedCalls, 1);
});
