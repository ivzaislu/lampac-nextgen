import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.LAMPAC_BASE || 'http://127.0.0.1:9118';
const uid = 'ci@translationsub.test';
const subscriptionId = 'ci-subscription';
const storePath = process.env.TRANSLATIONSUB_STORE
  || '/tmp/lampac-runtime/database/translationsub/subscriptions.json';

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
      this.ws.onmessage = event => {
        if (event.data === 'pong') return;
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; }

        if (message?.method === 'Connected') resolve();
        this.messages.push(message);

        for (const waiter of this.waiters.slice()) {
          if (!waiter.predicate(message)) continue;
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      };
    }), 5000, `connect profile ${this.profileId}`);

    this.send('TranslationSubRegister', [uid, this.profileId]);
    await delay(150);
  }

  send(method, args) {
    assert.equal(this.ws.readyState, WebSocket.OPEN,
      `profile ${this.profileId} socket is not open`);
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
      message?.method === 'TranslationSubChanged'
      && Array.isArray(message.args)
      && message.args[1] === reason).length;
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

function postJson(path, body = {}) {
  return jsonFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function lampaHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++)
    hash = (((hash << 5) - hash) + input.charCodeAt(i)) | 0;
  return String(hash === -2147483648 ? 2147483648 : Math.abs(hash));
}

function subscriptionFrom(snapshot) {
  return (snapshot?.subscriptions || []).find(item => item?.id === subscriptionId);
}

const p7 = new Client('7');
const p8 = new Client('8');

try {
  assert.ok(fs.existsSync(storePath), `seeded subscription store is missing: ${storePath}`);

  await p7.connect();
  await p8.connect();
  console.log('LIVE NWS: two TranslationSub profiles registered');

  const settings = await postJson(`/translationsub/v2/settings?uid=${encodeURIComponent(uid)}`, {
    sources: [],
    useTmdbSchedule: false,
    checkIntervalHours: 1,
    tmdbRefreshHours: 24,
    endedRefreshDays: 7,
    newSeasonMode: 'auto'
  });
  assert.equal(settings?.success, true, settings);

  // A forced check with disabled sources changes the seeded subscription exactly
  // once. The batch must persist one final state and emit one shared invalidation.
  const beforeChangedP7 = p7.countReason('subscription');
  const beforeChangedP8 = p8.countReason('subscription');
  const changedP7 = p7.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'subscription',
    'batched shared change');
  const changedP8 = p8.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'subscription',
    'batched shared change');

  const changed = await postJson(
    `/translationsub/v2/check?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(changed?.success, true, changed);
  await Promise.all([changedP7, changedP8]);
  await delay(350);

  assert.equal(p7.countReason('subscription'), beforeChangedP7 + 1,
    'changed batch must emit exactly one shared invalidation to profile 7');
  assert.equal(p8.countReason('subscription'), beforeChangedP8 + 1,
    'changed batch must emit exactly one shared invalidation to profile 8');

  const changedSub = subscriptionFrom(changed.snapshot);
  assert.ok(changedSub, changed.snapshot);
  assert.equal(changedSub.schedule?.code, 'sources_disabled', changedSub);

  const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(persisted.length, 1, persisted);
  assert.equal(persisted[0].Id, subscriptionId, persisted[0]);
  assert.equal(persisted[0].ScheduleState, 'sources_disabled', persisted[0]);
  console.log('LIVE changed tick: one canonical save state + one invalidation per connection');

  // Repeating the exact same check must be a true no-op: no file rewrite and no
  // realtime invalidation. This exercises PersistedState + batch no-op handling.
  const noOpBeforeP7 = p7.countReason('subscription');
  const noOpBeforeP8 = p8.countReason('subscription');
  const beforeNoOpStat = fs.statSync(storePath, { bigint: true }).mtimeNs;
  const beforeNoOpFile = fs.readFileSync(storePath, 'utf8');

  const noOp = await postJson(
    `/translationsub/v2/check?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(noOp?.success, true, noOp);
  await delay(650);

  assert.equal(p7.countReason('subscription'), noOpBeforeP7,
    'no-op batch must not invalidate profile 7');
  assert.equal(p8.countReason('subscription'), noOpBeforeP8,
    'no-op batch must not invalidate profile 8');
  assert.equal(fs.readFileSync(storePath, 'utf8'), beforeNoOpFile,
    'no-op batch must leave persisted contents unchanged');
  assert.equal(fs.statSync(storePath, { bigint: true }).mtimeNs, beforeNoOpStat,
    'no-op batch must not rewrite subscriptions.json');
  assert.equal(subscriptionFrom(noOp.snapshot)?.schedule?.code, 'sources_disabled', noOp.snapshot);
  console.log('LIVE no-op tick: zero writes and zero subscription invalidations');

  // An immediate command whose mutation changes nothing must obey the same store
  // invariant. Missing unsubscribe executes Mutate but must not rewrite or publish.
  const immediateBeforeP7 = p7.countReason('subscription');
  const immediateBeforeP8 = p8.countReason('subscription');
  const beforeImmediateStat = fs.statSync(storePath, { bigint: true }).mtimeNs;
  const beforeImmediateFile = fs.readFileSync(storePath, 'utf8');

  const missing = await postJson(
    `/translationsub/v2/subscriptions/missing/remove?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(missing?.success, false, missing);
  assert.equal(missing?.error, 'subscription_not_found', missing);
  await delay(450);

  assert.equal(p7.countReason('subscription'), immediateBeforeP7,
    'missing unsubscribe must not invalidate profile 7');
  assert.equal(p8.countReason('subscription'), immediateBeforeP8,
    'missing unsubscribe must not invalidate profile 8');
  assert.equal(fs.readFileSync(storePath, 'utf8'), beforeImmediateFile,
    'missing unsubscribe must leave persisted contents unchanged');
  assert.equal(fs.statSync(storePath, { bigint: true }).mtimeNs, beforeImmediateStat,
    'missing unsubscribe must not rewrite subscriptions.json');
  console.log('LIVE immediate no-op: zero writes and zero subscription invalidations');

  // TimeCode remains the authoritative profile-local writer. Only profile 7 is
  // invalidated, then the canonical snapshot must already contain watched episode 1.
  const beforeTimeP7 = p7.countReason('timecode');
  const beforeTimeP8 = p8.countReason('timecode');
  const timeCodeP7 = p7.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'timecode',
    'profile TimeCode change');

  const item = lampaHash('11CI Series');
  const form = new URLSearchParams({
    id: item,
    data: JSON.stringify({ percent: 80 })
  });
  const timecodeResponse = await fetch(
    `${base}/timecode/add?card_id=${encodeURIComponent('ci-series_tv')}`
      + `&uid=${encodeURIComponent(uid)}&profile_id=7`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString()
    }
  );
  const timecodeText = await timecodeResponse.text();
  assert.ok(timecodeResponse.ok,
    `timecode HTTP ${timecodeResponse.status}: ${timecodeText}`);
  const timecodeJson = JSON.parse(timecodeText);
  assert.equal(timecodeJson.success, true, timecodeJson);

  await timeCodeP7;
  await delay(450);
  assert.equal(p7.countReason('timecode'), beforeTimeP7 + 1,
    'profile 7 must receive exactly one TimeCode invalidation');
  assert.equal(p8.countReason('timecode'), beforeTimeP8,
    'profile 8 must not receive profile 7 TimeCode invalidation');

  const snapshot = await jsonFetch(
    `/translationsub/v2/snapshot?uid=${encodeURIComponent(uid)}&profile_id=7`);
  const afterTimeCode = subscriptionFrom(snapshot);
  assert.ok(afterTimeCode, snapshot);
  assert.equal(Number(afterTimeCode.watchedEpisode), 1, afterTimeCode);
  console.log('LIVE TimeCode: profile-scoped invalidation + canonical watched state');

  console.log('TranslationSub backend-first live realtime smoke passed.');
} finally {
  p7.close();
  p8.close();
}
