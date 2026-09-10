import assert from 'node:assert/strict';

const base = process.env.LAMPAC_BASE || 'http://127.0.0.1:9118';
const uid = 'ci@translationsub.test';

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

class Client {
  constructor(profileId) {
    this.profileId = String(profileId);
    this.messages = [];
    this.waiters = [];
    this.ws = null;
  }

  async connect() {
    const id = `ts-ci-${this.profileId}-${Math.random().toString(36).slice(2)}`;
    this.ws = new WebSocket(`${wsBase(base)}/nws?id=${encodeURIComponent(id)}&ver=1`);

    await withTimeout(new Promise((resolve, reject) => {
      this.ws.onerror = () => reject(new Error(`websocket error profile=${this.profileId}`));
      this.ws.onmessage = event => this.onMessage(event.data, resolve);
    }), 5000, `connect profile ${this.profileId}`);

    this.send('TranslationSubRegister', [uid, this.profileId]);
    await delay(150);
  }

  onMessage(raw, connectedResolve) {
    if (raw === 'pong') return;
    let message;
    try { message = JSON.parse(raw); }
    catch { return; }

    if (message && message.method === 'Connected' && connectedResolve) {
      connectedResolve();
      connectedResolve = null;
    }

    this.messages.push(message);
    const pending = this.waiters.slice();
    for (const waiter of pending) {
      if (!waiter.predicate(message)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  }

  send(method, args) {
    assert.equal(this.ws.readyState, WebSocket.OPEN, `profile ${this.profileId} socket is not open`);
    this.ws.send(JSON.stringify({ method, args }));
  }

  waitFor(predicate, label) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return withTimeout(new Promise(resolve => {
      this.waiters.push({ predicate, resolve });
    }), 5000, `${label} profile=${this.profileId}`);
  }

  countReason(reason) {
    return this.messages.filter(message =>
      message && message.method === 'TranslationSubChanged'
      && Array.isArray(message.args) && message.args[1] === reason).length;
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function lampaHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++)
    hash = (((hash << 5) - hash) + input.charCodeAt(i)) | 0;
  return String(hash === -2147483648 ? 2147483648 : Math.abs(hash));
}

const p7 = new Client('7');
const p8 = new Client('8');

try {
  await p7.connect();
  await p8.connect();
  console.log('LIVE NWS: two TranslationSub profiles registered');

  const addP7 = p7.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'subscription',
    'shared add event');
  const addP8 = p8.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'subscription',
    'shared add event');

  const add = await jsonFetch(`/translationsub/add?uid=${encodeURIComponent(uid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid,
      contentId: 'ci-series',
      title: 'CI Series',
      originalTitle: 'CI Series',
      isSerial: true,
      source: 'multi',
      translationId: 'ci-voice',
      translationName: 'CI Voice',
      currentSeason: '1',
      availableEpisode: '3',
      watchedEpisode: '0',
      sources: []
    })
  });
  assert.equal(add?.success, true, add);
  await Promise.all([addP7, addP8]);
  console.log('LIVE shared mutation: both profiles received subscription invalidation');

  const list = await jsonFetch(`/translationsub/list?uid=${encodeURIComponent(uid)}`);
  assert.equal(list.length, 1, list);
  const subId = list[0].Id;
  assert.ok(subId, list[0]);

  const beforeP7 = p7.countReason('timecode');
  const beforeP8 = p8.countReason('timecode');
  const timeCodeP7 = p7.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'timecode',
    'profile TimeCode event');

  const item = lampaHash('11CI Series');
  const form = new URLSearchParams({
    id: item,
    data: JSON.stringify({ percent: 80 })
  });
  const timecodeResponse = await fetch(
    `${base}/timecode/add?card_id=${encodeURIComponent('ci-series_tv')}&uid=${encodeURIComponent(uid)}&profile_id=7`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString()
    }
  );
  const timecodeText = await timecodeResponse.text();
  assert.ok(timecodeResponse.ok, `timecode HTTP ${timecodeResponse.status}: ${timecodeText}`);
  const timecodeJson = JSON.parse(timecodeText);
  assert.equal(timecodeJson.success, true, timecodeJson);

  await timeCodeP7;
  await delay(500);
  assert.equal(p7.countReason('timecode'), beforeP7 + 1,
    'profile 7 should receive exactly one TimeCode invalidation');
  assert.equal(p8.countReason('timecode'), beforeP8,
    'profile 8 must not receive profile 7 TimeCode invalidation');
  console.log('LIVE TimeCode mutation: only matching uid+profile received invalidation');

  const updates = await jsonFetch(
    `/translationsub/updates?uid=${encodeURIComponent(uid)}&profile_id=7&force=false`);
  assert.equal(updates.length, 1, updates);
  assert.equal(Number(updates[0].currentEpisode), 1, updates[0]);
  assert.equal(Number(updates[0].watchedEpisode), 1, updates[0]);
  console.log('LIVE TimeCode state: backend synced watched episode before frontend snapshot');

  await jsonFetch(
    `/translationsub/remove?id=${encodeURIComponent(subId)}&uid=${encodeURIComponent(uid)}`,
    { method: 'POST' });

  console.log('TranslationSub live realtime smoke passed.');
} finally {
  p7.close();
  p8.close();
}
