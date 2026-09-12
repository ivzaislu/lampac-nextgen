import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.LAMPAC_BASE || 'http://127.0.0.1:9118';
const statePath = process.env.TRANSLATIONSUB_PERSISTENCE_STATE || '/tmp/translationsub-persistence-state.json';
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

function wsBase(url) {
  return url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
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

function lampaHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++)
    hash = (((hash << 5) - hash) + input.charCodeAt(i)) | 0;
  return String(hash === -2147483648 ? 2147483648 : Math.abs(hash));
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const connectionId = `ts-restart-${Math.random().toString(36).slice(2)}`;
const socket = new WebSocket(`${wsBase(base)}/nws?id=${encodeURIComponent(connectionId)}&ver=1`);
let changeResolve;
const changed = withTimeout(new Promise(resolve => { changeResolve = resolve; }), 7000, 'post-restart timecode invalidation');

try {
  await withTimeout(new Promise((resolve, reject) => {
    socket.onerror = () => reject(new Error('post-restart websocket error'));
    socket.onmessage = event => {
      if (event.data === 'pong') return;
      let message;
      try { message = JSON.parse(event.data); }
      catch { return; }

      if (message?.method === 'Connected') {
        socket.send(JSON.stringify({
          method: 'TranslationSubRegister',
          args: [state.uid, state.profileId]
        }));
        resolve();
        return;
      }

      if (message?.method === 'TranslationSubChanged'
          && Array.isArray(message.args)
          && message.args[1] === 'timecode') {
        changeResolve(message);
      }
    };
  }), 5000, 'post-restart websocket connect');

  await new Promise(resolve => setTimeout(resolve, 150));

  const form = new URLSearchParams({
    id: lampaHash(`13${state.title}`),
    data: JSON.stringify({ percent: 80 })
  });
  const response = await fetch(
    `${base}/timecode/add?card_id=${encodeURIComponent(state.contentId + '_tv')}`
      + `&uid=${encodeURIComponent(state.uid)}&profile_id=${encodeURIComponent(state.profileId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString()
    }
  );
  const text = await response.text();
  assert.ok(response.ok, `timecode HTTP ${response.status}: ${text}`);
  const timecode = JSON.parse(text);
  assert.equal(timecode.success, true, timecode);

  const event = await changed;
  assert.equal(event.method, 'TranslationSubChanged', event);
  assert.equal(event.args[1], 'timecode', event);
  assert.equal(typeof event.args[0], 'number', event);
  assert.ok(event.args[0] > 0, event);

  const snapshot = await jsonFetch(
    `/translationsub/v2/snapshot?uid=${encodeURIComponent(state.uid)}`
      + `&profile_id=${encodeURIComponent(state.profileId)}`
  );
  const subscriptions = snapshot?.subscriptions || [];
  assert.equal(subscriptions.length, 1, snapshot);
  assert.equal(subscriptions[0].id, state.subscriptionId, subscriptions[0]);
  assert.equal(Number(subscriptions[0].watchedEpisode), 3, subscriptions[0]);
  assert.equal(Number(snapshot?.badge?.count), 0, snapshot);

  console.log(`TranslationSub post-restart realtime passed; revision=${event.args[0]}`);
} finally {
  try { socket.close(); } catch {}
}
