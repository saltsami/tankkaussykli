// Exercise the production Next.js routes against a local Supabase HTTP fixture.
// No credentials, external data or real push messages are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createECDH } from 'node:crypto';
import { once } from 'node:events';
const userId = '00000000-0000-0000-0000-000000000001';
const ruleId = '00000000-0000-0000-0000-000000000002';
const stationId = '00000000-0000-0000-0000-000000000003';
const requests = [];
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  let body = '';
  for await (const part of req) body += part;
  requests.push({ method: req.method, url, body: body ? JSON.parse(body) : null });
  res.setHeader('Content-Type', 'application/json');
  function send(value, status = 200) { res.statusCode = status; res.end(JSON.stringify(value)); }
  if (url.pathname === '/auth/v1/user') {
    if (req.headers.authorization !== 'Bearer valid-session') return send({ message: 'Invalid JWT', code: 'bad_jwt' }, 401);
    return send({ id: userId, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
  }
  if (req.headers.authorization !== 'Bearer fixture-service-key') return send({ message: 'Unauthorized' }, 401);
  if (url.pathname === '/rest/v1/price_alert_rules') {
    if (req.method === 'DELETE') return send([]);
    return send([{ id: ruleId, fuel_type: 'DIESEL', threshold: '2.000',
      stations: { osm_type: 'node', osm_id: 42, name: 'Asema' }, push_subscriptions: { enabled: true } }]);
  }
  if (url.pathname === '/rest/v1/stations') return send(req.method === 'GET' ? { id: stationId } : []);
  if (url.pathname === '/rest/v1/rpc/save_price_alert') return send(ruleId);
  if (url.pathname === '/rest/v1/rpc/enqueue_price_alerts') return send(0);
  if (url.pathname === '/rest/v1/rpc/claim_price_alert_deliveries') return send([]);
  return send({ message: 'Unexpected fixture request' }, 500);
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const fixturePort = fixture.address().port;
// Reserve an ephemeral app port before launching the child.
const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
const appPort = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const ec = createECDH('prime256v1'); ec.generateKeys();
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], {
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-public-key', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
    VAPID_PUBLIC_KEY: ec.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: ec.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: 'mailto:fixture@example.com', CRON_SECRET: 'fixture-cron-secret', PRICE_ALERT_MAX_AGE_HOURS: '24' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stderr.on('data', data => process.stderr.write(data));
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next.js readiness timed out')), 15000);
    app.stdout.on('data', data => { if (data.toString().includes('Ready')) { clearTimeout(timeout); resolve(); } });
    app.once('exit', code => { clearTimeout(timeout); reject(new Error(`Next.js exited: ${code}`)); });
  });
  const base = `http://127.0.0.1:${appPort}`;
  const headers = { Authorization: 'Bearer valid-session', 'Content-Type': 'application/json' };
  let r = await fetch(base + '/api/price-alerts?config');
  assert.equal(r.status, 200); const config = await r.json(); assert.equal(config.enabled, true);
  assert.equal(config.maxAgeHours, 24); assert.equal(config.publicKey, ec.getPublicKey().toString('base64url'));
  assert.equal(JSON.stringify(config).includes('fixture-service-key'), false);
  for (const authorization of [null, 'Bearer bad-session']) {
    r = await fetch(base + '/api/price-alerts', { headers: authorization ? { Authorization: authorization } : {} }); assert.equal(r.status, 401);
  }
  r = await fetch(base + '/api/price-alerts', { headers }); assert.equal(r.status, 200);
  const rules = (await r.json()).rules; assert.equal(rules[0].stationId, 'node-42'); assert.equal(rules[0].threshold, 2);
  const ownerRead = requests.find(q => q.url.pathname === '/rest/v1/price_alert_rules' && q.method === 'GET');
  assert.equal(ownerRead.url.searchParams.get('user_id'), `eq.${userId}`);
  const input = { user_id: 'ignored-untrusted-owner', station: { osmType: 'node', osmId: 42, name: 'Asema', brand: '', address: '', lat: 62, lng: 25 },
    fuel: 'DIESEL', threshold: 2, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture',
      keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: Buffer.alloc(16).toString('base64url') } } };
  r = await fetch(base + '/api/price-alerts', { method: 'PUT', headers, body: JSON.stringify(input) }); assert.equal(r.status, 200);
  assert.equal((await r.json()).ruleId, ruleId);
  const save = requests.find(q => q.url.pathname === '/rest/v1/rpc/save_price_alert');
  assert.equal(save.body.p_user_id, userId); assert.equal(save.body.p_station_id, stationId); assert.equal(save.body.p_threshold, 2);
  r = await fetch(base + '/api/price-alerts', { method: 'DELETE', headers, body: JSON.stringify({ id: ruleId }) }); assert.equal(r.status, 200);
  const deletion = requests.find(q => q.url.pathname === '/rest/v1/price_alert_rules' && q.method === 'DELETE');
  assert.equal(deletion.url.searchParams.get('id'), `eq.${ruleId}`); assert.equal(deletion.url.searchParams.get('user_id'), `eq.${userId}`);
  r = await fetch(base + '/api/price-alerts', { method: 'PUT', headers: { ...headers, Origin: 'https://evil.test' }, body: JSON.stringify(input) }); assert.equal(r.status, 403);
  r = await fetch(base + '/api/price-alerts', { method: 'PUT', headers, body: JSON.stringify({ ...input, threshold: 4.001 }) }); assert.equal(r.status, 400);
  r = await fetch(base + '/api/price-alerts', { method: 'PUT', headers, body: 'x'.repeat(17000) }); assert.equal(r.status, 400);
  r = await fetch(base + '/api/cron/price-alerts'); assert.equal(r.status, 401);
  r = await fetch(base + '/api/cron/price-alerts', { headers: { Authorization: 'Bearer fixture-cron-secret' } }); assert.equal(r.status, 200);
  assert.equal((await r.json()).claimed, 0);
  assert.equal(requests.filter(q => q.url.pathname === '/rest/v1/rpc/claim_price_alert_deliveries').length, 1);
  console.log('Production API smoke passed: session validation, owner-filtered reads/deletes, trusted save owner, input/body/origin checks, authorized cron.');
} finally {
  app.kill(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
}
