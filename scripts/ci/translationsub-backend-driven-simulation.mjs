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
const v2Controller = read('Modules/TranslationSub/V2Controller.cs');
const badge = read('Modules/TranslationSub/translationsub-badge-state.js');
const apiClient = read('Modules/TranslationSub/translationsub-api.js');
const settingsStore = read('Modules/TranslationSub/Services/TranslationSettingsStore.cs');
const realtimeService = read('Modules/TranslationSub/Services/TranslationSubRealtimeService.cs');
const subscriptionStore = read('Modules/TranslationSub/Services/SubscriptionStore.cs');
const profileProgressStore = read('Modules/TranslationSub/Services/ProfileProgressStore.cs');
const progressService = read('Modules/TranslationSub/Services/TimeCodeProgressService.cs');
const snapshotService = read('Modules/TranslationSub/Services/TranslationSubSnapshotService.cs');
const contentStateService = read('Modules/TranslationSub/Services/TranslationSubContentStateService.cs');
const commandService = read('Modules/TranslationSub/Services/TranslationSubCommandService.cs');
const pluginController = read('Modules/TranslationSub/PluginController.cs');
const realtimeClient = read('Modules/TranslationSub/translationsub-realtime.js');
const cardFlow = read('Modules/TranslationSub/translationsub-card-flow.js');
const sourceClient = read('Modules/TranslationSub/translationsub-source.js');

// Lampac owns server->client NWS transport and TranslationSub registers uid/profile.
assert.match(sharedStartup, /public static INws Nws/);
assert.match(nativeWs, /AllConnections\(\)/);
assert.match(nativeWs, /SendAsync\(string connectionId, string method/);
assert.match(coreStartup, /app\.Map\("\/nws"/);
assert.match(events, /Action<EventNwsMessage> NwsMessage/);
assert.match(events, /Action<EventNwsDisconnected> NwsDisconnected/);
assert.match(requestInfo, /if \(!IsWsRequest\)/);
assert.match(realtimeService, /void Register\(string connectionId, string uid, string profileId\)/);
assert.match(realtimeService, /Task PublishProfile\(string uid, string profileId, string reason\)/);
assert.match(realtimeService, /Task PublishUid\(string uid, string reason\)/);
assert.match(modInit, /TranslationSubRegister/);

// Watched progress is backend-owned. The authoritative TimeCode mutation is
// observed server-side, while reads retain server-side reconciliation as a
// restart/missed-event safety net. No browser progress watcher is shipped.
assert.match(timeCode, /Route\("\/timecode\/add"\)/);
assert.match(modInit, /"\/timecode\/add"/);
assert.match(modInit, /Response\.OnCompleted/);
assert.match(modInit, /TimeCodeProgressService\.SyncUser\(uid, profileId\)/);
assert.match(modInit, /PublishProfile\(uid, profileId, "timecode"\)/);
assert.match(controller, /Route\("translationsub\/v2\/snapshot"\)[\s\S]*?SyncTimeCodeProgress\(uid, profileId\)/);
assert.ok(!fs.existsSync('Modules/TranslationSub/translationsub-watch.js'),
  'Client progress watcher must stay removed');
assert.doesNotMatch(pluginController, /translationsub-watch\.js/);

// Profile-local state is isolated from shared subscription metadata.
assert.match(profileProgressStore, /ProfileId/);
assert.match(profileProgressStore, /SubscriptionId/);
assert.match(profileProgressStore, /WatchedEpisode/);
assert.match(progressService, /ProfileProgressStore\.Upsert\(uid, profileId, watchedBySubscription\)/);
assert.doesNotMatch(progressService, /sub\.CurrentEpisode\s*=/);
assert.doesNotMatch(progressService, /sub\.Notified\s*=/);
assert.match(subscriptionStore, /PublishUid\(uid, "subscription"\)/);
assert.doesNotMatch(subscriptionStore, /x\.CurrentEpisode/);
assert.doesNotMatch(subscriptionStore, /x\.Notified/);

// Canonical read model owns derived state and navigation targets.
for (const symbol of ['HasNewEpisodes', 'NewCount', 'ProgressPercent', 'BuildSchedule', 'BuildNavigation'])
  assert.match(snapshotService, new RegExp(symbol));
assert.match(snapshotService, /Badge = new TranslationSubBadgeSnapshot/);
assert.match(snapshotService, /Navigation = BuildNavigation\(sub\)/);

// Content identity, source selection, voice matching and mutation commands are backend-owned.
assert.match(contentStateService, /ContentIdentityService\.ResolveAsync/);
assert.match(contentStateService, /LampacMetadataService\.GetVariants/);
assert.match(contentStateService, /FindExisting/);
assert.match(commandService, /ContentIdentityService\.ResolveAsync/);
assert.match(commandService, /LampacMetadataService\.GetVariants/);
assert.match(commandService, /SubscriptionStore\.Mutate/);

// Browser card/source layers consume backend decisions instead of reconstructing them.
assert.match(cardFlow, /client\.contentSummary\(/);
assert.match(cardFlow, /client\.contentState\(/);
assert.match(cardFlow, /client\.subscribe\(/);
assert.match(cardFlow, /client\.unsubscribe\(/);
for (const obsolete of ['sameContent', 'latestAiredSeason', 'normalizeVoice', 'findExisting', 'ensureExternalIds'])
  assert.doesNotMatch(cardFlow, new RegExp(`function\\s+${obsolete}\\s*\\(`));
assert.match(sourceClient, /item\.navigation/);
assert.doesNotMatch(sourceClient, /function\s+tmdbId\s*\(/);
assert.doesNotMatch(sourceClient, /item\.isSerial\s*!==\s*false/);

// Manual refresh is a backend command and returns the canonical snapshot directly.
assert.match(v2Controller, /Route\("translationsub\/v2\/check"\)/);
assert.match(v2Controller, /TranslationSubscriptionService\.Tick\(uid, selectedSources, force: true\)/);
assert.match(v2Controller, /TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(apiClient, /request\('POST', '\/translationsub\/v2\/check'/);
assert.doesNotMatch(apiClient, /['"]\/translationsub\/check/);

// Settings policy stays backend-owned; BadgeState is read-only snapshot state.
assert.match(settingsStore, /CheckIntervalHours \{ get; set; \} = 1/);
assert.match(settingsStore, /TmdbRefreshHours \{ get; set; \} = 24/);
assert.match(badge, /api\.snapshot/);
assert.doesNotMatch(badge, /setInterval\(refresh/);

// Realtime invalidation client uses a dedicated socket and refreshes canonical state.
const badgeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-badge-state.js")');
const realtimeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-realtime.js")');
assert.ok(badgeLoad >= 0 && realtimeLoad > badgeLoad, 'realtime client must load after BadgeState');
assert.match(realtimeClient, /translationsub_nws_id/);
assert.doesNotMatch(realtimeClient, /lampac_nws_id/);
assert.match(realtimeClient, /TranslationSubRegister/);
assert.match(realtimeClient, /TranslationSubChanged/);
assert.match(realtimeClient, /window\.TranslationSubBadgeState\.refresh\(\)/);

// Execute the production realtime client against a minimal socket harness.
const storage = new Map([
  ['lampac_unic_id', 'user1'],
  ['lampac_profile_id', '7']
]);
const sockets = [];
let badgeRefreshes = 0;
let timerId = 0;
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; if (typeof this.onclose === 'function') this.onclose({}); }
}
const context = {
  console, JSON, Math, Date, encodeURIComponent, WebSocket: FakeWebSocket,
  localStorage: {
    getItem(name) { return storage.has(name) ? String(storage.get(name)) : null; },
    setItem(name, value) { storage.set(name, value); }
  },
  document: { hidden: false, addEventListener() {} },
  setInterval() { return ++timerId; }, clearInterval() {},
  setTimeout(fn) { const id = ++timerId; fn(); return id; }, clearTimeout() {},
  location: { origin: 'http://lampac.test' },
  Lampa: {
    Storage: {
      get(name, fallback) { return storage.has(name) ? storage.get(name) : fallback; },
      set(name, value) { storage.set(name, value); }
    },
    Utils: { uid() { return 'abcdef0123456789abcdef0123456789'; } },
    Listener: { follow() {} }
  }
};
context.window = context;
context.window.Lampa = context.Lampa;
context.window.LampacHost = 'http://lampac.test';
context.window.TranslationSub = { uid() { return 'user1'; } };
context.window.TranslationSubBadgeState = { refresh() { badgeRefreshes++; } };

vm.runInNewContext(realtimeClient, context, { filename: 'translationsub-realtime.js' });
assert.equal(sockets.length, 1);
const ws = sockets[0];
ws.readyState = FakeWebSocket.OPEN;
ws.onopen();
ws.onmessage({ data: JSON.stringify({ method: 'Connected', args: ['server-connection'] }) });
assert.deepEqual(JSON.parse(ws.sent[0]), { method: 'TranslationSubRegister', args: ['user1', '7'] });
assert.equal(badgeRefreshes, 0);
ws.onmessage({ data: JSON.stringify({ method: 'TranslationSubChanged', args: [1, 'timecode'] }) });
assert.equal(badgeRefreshes, 1);

console.log('TranslationSub backend-first architecture simulation passed.');
