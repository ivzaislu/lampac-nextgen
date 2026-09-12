import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.LAMPAC_BASE || 'http://127.0.0.1:9118';
const uid = 'ci@translationsub.test';
const otherUid = 'other@translationsub.test';
const subscriptionId = 'ci-subscription';
const storePath = process.env.TRANSLATIONSUB_STORE
  || '/tmp/lampac-runtime/database/translationsub.db';

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
  constructor(label, clientUid, profileId) {
    this.label = label;
    this.uid = clientUid;
    this.profileId = String(profileId);
    this.messages = [];
    this.waiters = [];
    this.ws = null;
  }

  async connect() {
    const id = `ts-ci-${this.label}-${Math.random().toString(36).slice(2)}`;
    this.ws = new WebSocket(`${wsBase(base)}/nws?id=${encodeURIComponent(id)}&ver=1`);

    await withTimeout(new Promise((resolve, reject) => {
      this.ws.onerror = () => reject(new Error(`websocket error client=${this.label}`));
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
    }), 5000, `connect client ${this.label}`);

    this.register(this.uid, this.profileId);
    await delay(150);
  }

  register(clientUid = this.uid, profileId = this.profileId) {
    this.uid = clientUid;
    this.profileId = String(profileId);
    this.send('TranslationSubRegister', [this.uid, this.profileId]);
  }

  send(method, args) {
    assert.equal(this.ws.readyState, WebSocket.OPEN,
      `client ${this.label} socket is not open`);
    this.ws.send(JSON.stringify({ method, args }));
  }

  waitFor(predicate, label) {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return withTimeout(new Promise(resolve => {
      this.waiters.push({ predicate, resolve });
    }), 5000, `${label} client=${this.label}`);
  }

  countReason(reason) {
    return this.messages.filter(message =>
      message?.method === 'TranslationSubChanged'
      && Array.isArray(message.args)
      && message.args[1] === reason).length;
  }

  changedMessages(reason) {
    return this.messages.filter(message =>
      message?.method === 'TranslationSubChanged'
      && Array.isArray(message.args)
      && (reason === undefined || message.args[1] === reason));
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

function assertRealtimeMessage(message, reason) {
  assert.equal(message?.method, 'TranslationSubChanged', message);
  assert.ok(Array.isArray(message?.args), message);
  assert.equal(message.args.length, 2, message);
  assert.ok(Number.isInteger(message.args[0]) && message.args[0] > 0,
    `revision must be positive integer: ${JSON.stringify(message)}`);
  assert.equal(message.args[1], reason, message);
  return message.args[0];
}

async function writeTimeCode(profileId, episode, percent) {
  const item = lampaHash(`1${episode}CI Series`);
  const form = new URLSearchParams({
    id: item,
    data: JSON.stringify({ percent })
  });
  const response = await fetch(
    `${base}/timecode/add?card_id=${encodeURIComponent('ci-series_tv')}`
      + `&uid=${encodeURIComponent(uid)}&profile_id=${encodeURIComponent(profileId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString()
    }
  );
  const text = await response.text();
  assert.ok(response.ok, `timecode HTTP ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.success, true, body);
}

const p7a = new Client('p7a', uid, '7');
const p7b = new Client('p7b', uid, '7');
const p8 = new Client('p8', uid, '8');
const other7 = new Client('other7', otherUid, '7');
const clients = [p7a, p7b, p8, other7];

try {
  assert.ok(fs.existsSync(storePath), `TranslationSub database is missing: ${storePath}`);

  await Promise.all(clients.map(client => client.connect()));
  console.log('LIVE NWS: two profile-7 connections, profile 8, and foreign uid registered');

  const settings = await postJson(`/translationsub/v2/settings?uid=${encodeURIComponent(uid)}`, {
    sources: [],
    useTmdbSchedule: false,
    checkIntervalHours: 1,
    tmdbRefreshHours: 24,
    endedRefreshDays: 7,
    newSeasonMode: 'auto'
  });
  assert.equal(settings?.success, true, settings);

  // A shared subscription mutation must fan out to every connection of the uid,
  // across profiles, but never to another uid. All recipients of one publish get
  // the same revision and reason.
  const beforeShared = new Map(clients.map(client => [client, client.countReason('subscription')]));
  const sharedWaiters = [p7a, p7b, p8].map(client => client.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'subscription',
    'shared subscription change'));

  const changed = await postJson(
    `/translationsub/v2/check?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(changed?.success, true, changed);
  const sharedMessages = await Promise.all(sharedWaiters);
  await delay(350);

  for (const client of [p7a, p7b, p8]) {
    assert.equal(client.countReason('subscription'), beforeShared.get(client) + 1,
      `shared mutation must emit exactly one invalidation to ${client.label}`);
  }
  assert.equal(other7.countReason('subscription'), beforeShared.get(other7),
    'foreign uid must not receive shared invalidation');

  const sharedRevisions = sharedMessages.map(message => assertRealtimeMessage(message, 'subscription'));
  assert.equal(new Set(sharedRevisions).size, 1,
    `one PublishUid must use one revision for all recipients: ${sharedRevisions}`);
  const firstSharedRevision = sharedRevisions[0];

  const changedSub = subscriptionFrom(changed.snapshot);
  assert.ok(changedSub, changed.snapshot);
  assert.equal(changedSub.schedule?.code, 'sources_disabled', changedSub);
  console.log('LIVE shared fan-out: multi-connection/profile delivery + foreign uid isolation');

  // Repeating the same check is a no-op: no SQLite rewrite and no invalidation.
  const noOpBefore = new Map(clients.map(client => [client, client.countReason('subscription')]));
  const beforeNoOpStat = fs.statSync(storePath, { bigint: true }).mtimeNs;
  const beforeNoOpFile = fs.readFileSync(storePath);

  const noOp = await postJson(
    `/translationsub/v2/check?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(noOp?.success, true, noOp);
  await delay(650);

  for (const client of clients) {
    assert.equal(client.countReason('subscription'), noOpBefore.get(client),
      `no-op batch must not invalidate ${client.label}`);
  }
  assert.deepEqual(fs.readFileSync(storePath), beforeNoOpFile,
    'no-op batch must leave translationsub.db contents unchanged');
  assert.equal(fs.statSync(storePath, { bigint: true }).mtimeNs, beforeNoOpStat,
    'no-op batch must not rewrite translationsub.db');
  console.log('LIVE no-op tick: zero SQLite writes and zero invalidations');

  // Missing unsubscribe is also a true no-op.
  const immediateBefore = new Map(clients.map(client => [client, client.countReason('subscription')]));
  const beforeImmediateStat = fs.statSync(storePath, { bigint: true }).mtimeNs;
  const beforeImmediateFile = fs.readFileSync(storePath);

  const missing = await postJson(
    `/translationsub/v2/subscriptions/missing/remove?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(missing?.success, false, missing);
  assert.equal(missing?.error, 'subscription_not_found', missing);
  await delay(450);

  for (const client of clients) {
    assert.equal(client.countReason('subscription'), immediateBefore.get(client),
      `missing unsubscribe must not invalidate ${client.label}`);
  }
  assert.deepEqual(fs.readFileSync(storePath), beforeImmediateFile,
    'missing unsubscribe must leave translationsub.db contents unchanged');
  assert.equal(fs.statSync(storePath, { bigint: true }).mtimeNs, beforeImmediateStat,
    'missing unsubscribe must not rewrite translationsub.db');
  console.log('LIVE immediate no-op: zero SQLite writes and zero invalidations');

  // Profile-local TimeCode must reach every connection registered to profile 7,
  // but not another profile or another uid.
  const beforeTime = new Map(clients.map(client => [client, client.countReason('timecode')]));
  const timeWaiters = [p7a, p7b].map(client => client.waitFor(message =>
    message?.method === 'TranslationSubChanged' && message?.args?.[1] === 'timecode',
    'profile TimeCode change'));

  await writeTimeCode('7', 1, 80);
  const timeMessages = await Promise.all(timeWaiters);
  await delay(450);

  for (const client of [p7a, p7b]) {
    assert.equal(client.countReason('timecode'), beforeTime.get(client) + 1,
      `profile 7 must receive exactly one TimeCode invalidation: ${client.label}`);
  }
  assert.equal(p8.countReason('timecode'), beforeTime.get(p8),
    'profile 8 must not receive profile 7 TimeCode invalidation');
  assert.equal(other7.countReason('timecode'), beforeTime.get(other7),
    'foreign uid must not receive profile 7 TimeCode invalidation');

  const timeRevisions = timeMessages.map(message => assertRealtimeMessage(message, 'timecode'));
  assert.equal(new Set(timeRevisions).size, 1,
    `one PublishProfile must use one revision for all recipients: ${timeRevisions}`);
  assert.ok(timeRevisions[0] > firstSharedRevision,
    `revision must increase across publishes: shared=${firstSharedRevision}, time=${timeRevisions[0]}`);

  let snapshot = await jsonFetch(
    `/translationsub/v2/snapshot?uid=${encodeURIComponent(uid)}&profile_id=7`);
  let afterTimeCode = subscriptionFrom(snapshot);
  assert.ok(afterTimeCode, snapshot);
  assert.equal(Number(afterTimeCode.watchedEpisode), 1, afterTimeCode);
  console.log('LIVE TimeCode: profile fan-out + profile/uid isolation + revision contract');

  // The same websocket can move between profiles. Re-register p7b as profile 8,
  // then a profile-7 TimeCode change must only reach p7a.
  p7b.register(uid, '8');
  await delay(200);
  const beforeReprofile = new Map(clients.map(client => [client, client.countReason('timecode')]));
  const p7aSecond = p7a.waitFor(message =>
    message?.method === 'TranslationSubChanged'
      && message?.args?.[1] === 'timecode'
      && message?.args?.[0] > timeRevisions[0],
    'reprofiled profile TimeCode change');

  await writeTimeCode('7', 2, 80);
  const secondTime = await p7aSecond;
  await delay(450);
  const secondTimeRevision = assertRealtimeMessage(secondTime, 'timecode');
  assert.ok(secondTimeRevision > timeRevisions[0],
    'second TimeCode publish must advance revision');
  assert.equal(p7a.countReason('timecode'), beforeReprofile.get(p7a) + 1,
    'remaining profile-7 connection must receive second TimeCode invalidation');
  assert.equal(p7b.countReason('timecode'), beforeReprofile.get(p7b),
    're-registered connection must stop receiving old profile invalidations');
  assert.equal(p8.countReason('timecode'), beforeReprofile.get(p8),
    'profile 8 must not receive profile 7 TimeCode invalidation');
  assert.equal(other7.countReason('timecode'), beforeReprofile.get(other7),
    'foreign uid must stay isolated after re-registration');

  snapshot = await jsonFetch(
    `/translationsub/v2/snapshot?uid=${encodeURIComponent(uid)}&profile_id=7`);
  afterTimeCode = subscriptionFrom(snapshot);
  assert.ok(afterTimeCode, snapshot);
  assert.equal(Number(afterTimeCode.watchedEpisode), 2, afterTimeCode);
  console.log('LIVE re-register: connection moved profiles without stale profile delivery');

  // Disconnect one profile-8 connection, then remove the subscription. Remaining
  // connections of the uid must still receive exactly one shared invalidation and
  // the foreign uid must remain isolated. This also exercises server unregister.
  p8.close();
  await delay(250);
  const beforeRemove = new Map([p7a, p7b, other7].map(client =>
    [client, client.countReason('subscription')]));
  const removeWaiters = [p7a, p7b].map(client => client.waitFor(message =>
    message?.method === 'TranslationSubChanged'
      && message?.args?.[1] === 'subscription'
      && message?.args?.[0] > secondTimeRevision,
    'unsubscribe shared change'));

  const removed = await postJson(
    `/translationsub/v2/subscriptions/${encodeURIComponent(subscriptionId)}/remove`
      + `?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.equal(removed?.success, true, removed);
  const removeMessages = await Promise.all(removeWaiters);
  await delay(450);

  const removeRevisions = removeMessages.map(message => assertRealtimeMessage(message, 'subscription'));
  assert.equal(new Set(removeRevisions).size, 1,
    `unsubscribe PublishUid must share revision: ${removeRevisions}`);
  assert.ok(removeRevisions[0] > secondTimeRevision,
    'unsubscribe shared publish must advance revision');
  assert.equal(p7a.countReason('subscription'), beforeRemove.get(p7a) + 1,
    'profile 7 connection must receive unsubscribe invalidation');
  assert.equal(p7b.countReason('subscription'), beforeRemove.get(p7b) + 1,
    're-registered profile 8 connection must receive uid-wide unsubscribe invalidation');
  assert.equal(other7.countReason('subscription'), beforeRemove.get(other7),
    'foreign uid must not receive unsubscribe invalidation');

  const emptySnapshot = await jsonFetch(
    `/translationsub/v2/snapshot?uid=${encodeURIComponent(uid)}&profile_id=7`);
  assert.deepEqual(emptySnapshot?.subscriptions || [], [], emptySnapshot);
  assert.deepEqual(emptySnapshot?.updates || [], [], emptySnapshot);
  console.log('LIVE disconnect/unsubscribe: unregister survives and uid-wide fan-out stays correct');

  console.log('TranslationSub expanded live realtime regression passed.');
} finally {
  for (const client of clients) client.close();
}
