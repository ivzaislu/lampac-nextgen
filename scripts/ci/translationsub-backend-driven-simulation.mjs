import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const nativeWs = read('Core/Services/NativeWebSocket.cs');
const sharedStartup = read('Shared/Startup.cs');
const coreStartup = read('Core/Startup.cs');
const requestInfo = read('Core/Middlewares/RequestInfo.cs');
const events = read('Shared/Models/Events/EventListener.cs');
const timeCode = read('Modules/Sync/TimeCode/Controller.cs');
const modInit = read('Modules/TranslationSub/ModInit.cs');
const controller = read('Modules/TranslationSub/Controller.cs');
const watch = read('Modules/TranslationSub/translationsub-watch.js');
const badge = read('Modules/TranslationSub/translationsub-badge-state.js');
const settingsStore = read('Modules/TranslationSub/Services/TranslationSettingsStore.cs');
const realtimeService = read('Modules/TranslationSub/Services/TranslationSubRealtimeService.cs');
const subscriptionStore = read('Modules/TranslationSub/Services/SubscriptionStore.cs');
const pluginController = read('Modules/TranslationSub/PluginController.cs');
const realtimeClient = read('Modules/TranslationSub/translationsub-realtime.js');

// Lampac already owns the server->client transport.
assert.match(sharedStartup, /public static INws Nws/);
assert.match(nativeWs, /AllConnections\(\)/);
assert.match(nativeWs, /SendAsync\(string connectionId, string method/);
assert.match(coreStartup, /app\.Map\("\/nws"/);

// Modules can observe NWS messages/disconnects and post-AccsDB HTTP middleware.
assert.match(events, /Action<EventNwsMessage> NwsMessage/);
assert.match(events, /Action<EventNwsDisconnected> NwsDisconnected/);
assert.match(events, /Func<bool, EventMiddleware, bool> Middleware/);
const authPos = coreStartup.indexOf('app.UseAuthorization()');
const accsPos = coreStartup.indexOf('app.UseAccsdb()');
const secondModulePos = coreStartup.indexOf('app.UseModule(first: false)');
assert.ok(authPos >= 0 && accsPos > authPos && secondModulePos > accsPos,
  'second module middleware must run after AccsDB');

// WebSocket RequestInfo normally does not resolve user_uid, therefore the
// TranslationSub client explicitly registers uid + profile_id on its NWS socket.
assert.match(requestInfo, /if \(!IsWsRequest\)/);
assert.match(realtimeService, /void Register\(string connectionId, string uid, string profileId\)/);
assert.match(realtimeService, /Task PublishProfile\(string uid, string profileId, string reason\)/);
assert.match(realtimeService, /Task PublishUid\(string uid, string reason\)/);
assert.match(modInit, /TranslationSubRegister/);
assert.match(modInit, /EventListener\.NwsMessage \+= nwsMessage/);
assert.match(modInit, /EventListener\.NwsDisconnected \+= nwsDisconnected/);

// TimeCode completion is observed server-side after the actual POST handler.
assert.match(timeCode, /Route\("\/timecode\/add"\)/);
assert.match(timeCode, /user_id = \$"\{user_id\}_\{profile_id\}"/);
assert.match(modInit, /"\/timecode\/add"/);
assert.match(modInit, /Response\.OnCompleted/);
assert.match(modInit, /PublishProfile\(uid, profileId, "timecode"\)/);

// Shared subscription changes (scheduler, add/remove) publish UID-wide only when
// meaningful shared state changed. Profile-local CurrentEpisode/Notified are
// intentionally excluded from the shared-state fingerprint.
assert.match(subscriptionStore, /SharedStateByUid/);
assert.match(subscriptionStore, /PublishUid\(uid, "subscription"\)/);
assert.doesNotMatch(subscriptionStore, /x\.CurrentEpisode/);
assert.doesNotMatch(subscriptionStore, /x\.Notified/);
assert.doesNotMatch(subscriptionStore, /x\.LastCheckedAt/);
assert.doesNotMatch(subscriptionStore, /x\.TmdbLastSyncedAt/);
assert.match(subscriptionStore, /x\.LastEpisode/);
assert.match(subscriptionStore, /x\.TmdbNextAirDate/);
assert.match(subscriptionStore, /x\.ScheduleState/);

// User-level scheduling defaults are backend-owned and match the intended policy.
assert.match(settingsStore, /CheckIntervalHours \{ get; set; \} = 1/);
assert.match(settingsStore, /TmdbRefreshHours \{ get; set; \} = 24/);

// The new production client is actually shipped after BadgeState and uses a
// distinct NWS id so it cannot replace RCH's lampac_nws_id connection.
const badgeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-badge-state.js")');
const realtimeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-realtime.js")');
assert.ok(badgeLoad >= 0 && realtimeLoad > badgeLoad, 'realtime client must load after BadgeState');
assert.match(realtimeClient, /translationsub_nws_id/);
assert.doesNotMatch(realtimeClient, /lampac_nws_id/);
assert.match(realtimeClient, /TranslationSubRegister/);
assert.match(realtimeClient, /TranslationSubChanged/);
assert.match(realtimeClient, /window\.TranslationSubBadgeState\.refresh\(\)/);

// This is intentionally an additive migration checkpoint. The old frontend
// synchronization remains until the user separately approves its removal.
assert.match(watch, /Timeline\.listener\.follow\('update'/);
assert.match(badge, /setInterval\(refresh, 60 \* 1000\)/);
assert.match(controller, /SyncTimeCodeProgress\(uid\)/);

// Exercise the real production realtime JS with a minimal fake Lampac/WebSocket.
const storage = new Map([
  ['lampac_unic_id', 'user1'],
  ['lampac_profile_id', '7']
]);
const sockets = [];
let badgeRefreshes = 0;
let timerId = 0;
const listenerHandlers = {};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    sockets.push(this);
  }

  send(value) {
    this.sent.push(value);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    if (typeof this.onclose === 'function') this.onclose({});
  }
}

const context = {
  console,
  JSON,
  Math,
  Date,
  encodeURIComponent,
  WebSocket: FakeWebSocket,
  localStorage: {
    getItem(name) { return storage.has(name) ? String(storage.get(name)) : null; },
    setItem(name, value) { storage.set(name, value); }
  },
  document: {
    hidden: false,
    addEventListener() {}
  },
  setInterval() { return ++timerId; },
  clearInterval() {},
  setTimeout(fn) { const id = ++timerId; fn(); return id; },
  clearTimeout() {},
  location: { origin: 'http://lampac.test' },
  Lampa: {
    Storage: {
      get(name, fallback) { return storage.has(name) ? storage.get(name) : fallback; },
      set(name, value) { storage.set(name, value); }
    },
    Utils: {
      uid() { return 'abcdef0123456789abcdef0123456789'; }
    },
    Listener: {
      follow(name, handler) { listenerHandlers[name] = handler; }
    }
  }
};
context.window = context;
context.window.Lampa = context.Lampa;
context.window.LampacHost = 'http://lampac.test';
context.window.TranslationSub = { uid() { return 'user1'; } };
context.window.TranslationSubBadgeState = {
  refresh() { badgeRefreshes++; }
};

vm.runInNewContext(realtimeClient, context, { filename: 'translationsub-realtime.js' });
assert.equal(sockets.length, 1, 'realtime client should create exactly one NWS socket');
const ws = sockets[0];
assert.match(ws.url, /^ws:\/\/lampac\.test\/nws\?id=/);
assert.ok(!ws.url.includes('lampac_nws_id'), 'TranslationSub must not reuse RCH connection id');

ws.readyState = FakeWebSocket.OPEN;
ws.onopen();
ws.onmessage({ data: JSON.stringify({ method: 'Connected', args: ['server-connection'] }) });
assert.equal(ws.sent.length, 1, 'Connected must register TranslationSub identity once');
const registration = JSON.parse(ws.sent[0]);
assert.deepEqual(registration, {
  method: 'TranslationSubRegister',
  args: ['user1', '7']
});
assert.equal(badgeRefreshes, 0, 'initial NWS connect must not duplicate startup snapshot');
console.log('PRODUCTION realtime connect: registered uid+profile without extra /updates');

ws.onmessage({ data: JSON.stringify({ method: 'TranslationSubChanged', args: [1, 'timecode'] }) });
assert.equal(badgeRefreshes, 1, 'backend invalidation must trigger exactly one Badge snapshot refresh');
console.log('PRODUCTION realtime invalidation: exactly one BadgeState.refresh');

storage.set('lampac_profile_id', '8');
assert.equal(context.window.TranslationSubRealtime.register(), true);
const reRegistration = JSON.parse(ws.sent[ws.sent.length - 1]);
assert.deepEqual(reRegistration, {
  method: 'TranslationSubRegister',
  args: ['user1', '8']
});
console.log('PRODUCTION profile switch registration: current profile_id is resent');

// Target routing model for the server registry.
class RoutingModel {
  constructor() {
    this.registrations = new Map();
    this.sent = [];
  }
  register(connectionId, uid, profileId) {
    this.registrations.set(connectionId, { uid, profileId: String(profileId || '0') });
  }
  disconnect(connectionId) { this.registrations.delete(connectionId); }
  publishProfile(uid, profileId) {
    for (const [connectionId, registration] of this.registrations) {
      if (registration.uid === uid && registration.profileId === String(profileId || '0'))
        this.sent.push(connectionId);
    }
  }
  publishUid(uid) {
    for (const [connectionId, registration] of this.registrations) {
      if (registration.uid === uid) this.sent.push(connectionId);
    }
  }
  reset() { this.sent.length = 0; }
}

const routing = new RoutingModel();
routing.register('u1p7', 'user1', '7');
routing.register('u1p8', 'user1', '8');
routing.register('u2p7', 'user2', '7');
routing.publishProfile('user1', '7');
assert.deepEqual(routing.sent, ['u1p7']);
console.log('TARGET TimeCode routing: only matching uid+profile receives invalidation');
routing.reset();
routing.publishUid('user1');
assert.deepEqual(routing.sent.sort(), ['u1p7', 'u1p8']);
console.log('TARGET shared metadata routing: all profiles of matching UID receive invalidation');
routing.reset();
routing.disconnect('u1p8');
routing.publishUid('user1');
assert.deepEqual(routing.sent, ['u1p7']);
console.log('TARGET disconnect routing: stale connection receives nothing');

console.log('ADDITIVE checkpoint: old polling/Timeline/progress paths intentionally still present');
console.log('TranslationSub additive backend realtime production simulation passed.');
