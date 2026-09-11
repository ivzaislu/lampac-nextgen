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
const v2Controller = read('Modules/TranslationSub/V2Controller.cs');
const settingsController = read('Modules/TranslationSub/SettingsController.cs');
const badge = read('Modules/TranslationSub/translationsub-badge-state.js');
const apiClient = read('Modules/TranslationSub/translationsub-api.js');
const settingsStore = read('Modules/TranslationSub/Services/TranslationSettingsStore.cs');
const realtimeService = read('Modules/TranslationSub/Services/TranslationSubRealtimeService.cs');
const subscriptionStore = read('Modules/TranslationSub/Services/SubscriptionStore.cs');
const subscriptionModel = read('Modules/TranslationSub/Models/TranslationSubscription.cs');
const contentStateModel = read('Modules/TranslationSub/Models/TranslationSubContentState.cs');
const profileProgressModel = read('Modules/TranslationSub/Models/SubscriptionProfileProgress.cs');
const profileProgressStore = read('Modules/TranslationSub/Services/ProfileProgressStore.cs');
const progressService = read('Modules/TranslationSub/Services/TimeCodeProgressService.cs');
const projectionService = read('Modules/TranslationSub/Services/TranslationSubProjectionService.cs');
const subscriptionService = read('Modules/TranslationSub/Services/TranslationSubscriptionService.cs');
const snapshotService = read('Modules/TranslationSub/Services/TranslationSubSnapshotService.cs');
const contentStateService = read('Modules/TranslationSub/Services/TranslationSubContentStateService.cs');
const commandService = read('Modules/TranslationSub/Services/TranslationSubCommandService.cs');
const pluginController = read('Modules/TranslationSub/PluginController.cs');
const realtimeClient = read('Modules/TranslationSub/translationsub-realtime.js');
const cardFlow = read('Modules/TranslationSub/translationsub-card-flow.js');
const sourceClient = read('Modules/TranslationSub/translationsub-source.js');
const contentStateController = (v2Controller.match(
  /Route\("translationsub\/v2\/content-state"\)[\s\S]*?\n    }\n\n    \[HttpPost\]/
) || [''])[0];

assert.ok(!fs.existsSync('Modules/TranslationSub/Controller.cs'),
  'Legacy TranslationSubController must stay removed');
assert.ok(!fs.existsSync('Modules/TranslationSub/translationsub-watch.js'),
  'Client progress watcher must stay removed');

// Lampac owns NWS transport; TranslationSub registers uid/profile and emits invalidations.
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

// Watched progress is backend-owned.
assert.match(timeCode, /Route\("\/timecode\/add"\)/);
assert.match(modInit, /"\/timecode\/add"/);
assert.match(modInit, /Response\.OnCompleted/);
assert.match(modInit, /TimeCodeProgressService\.SyncUser\(uid, profileId\)/);
assert.match(modInit, /PublishProfile\(uid, profileId, "timecode"\)/);
assert.match(v2Controller, /Route\("translationsub\/v2\/snapshot"\)[\s\S]*?TimeCodeProgressService\.SyncUser\(uid, profileId\)/);
assert.doesNotMatch(pluginController, /translationsub-watch\.js/);

// Profile-local state is physically separated from shared subscription metadata.
assert.match(profileProgressModel, /class SubscriptionProfileProgress/);
assert.match(profileProgressModel, /class TranslationSubProfileProjection/);
assert.match(profileProgressModel, /WatchedEpisode/);
assert.doesNotMatch(subscriptionModel, /\bCurrentEpisode\b/);
assert.doesNotMatch(subscriptionModel, /\bNotified\b/);
assert.match(profileProgressStore, /ProfileId/);
assert.match(profileProgressStore, /SubscriptionId/);
assert.match(profileProgressStore, /WatchedEpisode/);
assert.match(progressService, /ProfileProgressStore\.Upsert\(uid, profileId, watchedBySubscription\)/);
assert.doesNotMatch(progressService, /CurrentEpisode|Notified/);
assert.match(projectionService, /List<TranslationSubProfileProjection>/);
assert.match(projectionService, /WatchedEpisode\s*=/);
assert.doesNotMatch(projectionService, /CurrentEpisode|Notified/);
assert.doesNotMatch(commandService, /CurrentEpisode|Notified/);
assert.doesNotMatch(subscriptionService, /CurrentEpisode|Notified/);
assert.match(subscriptionStore, /PublishUid\(uid, "subscription"\)/);
assert.doesNotMatch(subscriptionStore, /CurrentEpisode|Notified/);

// Canonical read model owns all derived profile state and navigation targets.
for (const symbol of ['HasNewEpisodes', 'NewCount', 'ProgressPercent', 'BuildSchedule', 'BuildNavigation'])
  assert.match(snapshotService, new RegExp(symbol));
assert.match(snapshotService, /Badge = new TranslationSubBadgeSnapshot/);
assert.match(snapshotService, /TranslationSubProfileProjection projection/);
assert.match(snapshotService, /projection\.WatchedEpisode/);
assert.match(snapshotService, /Navigation = BuildNavigation\(sub\)/);
assert.doesNotMatch(snapshotService, /sub\.CurrentEpisode|sub\.Notified/);

// Identity, source selection, voice matching and mutations are backend-owned.
assert.match(contentStateService, /ContentIdentityService\.ResolveAsync/);
assert.match(contentStateService, /LampacMetadataService\.GetVariants/);
assert.match(contentStateService, /SubscriptionStore\.Load\(\)/);
assert.doesNotMatch(contentStateService, /TranslationSubProjectionService\.ForProfile/);
assert.match(contentStateService, /FindExisting/);
assert.match(commandService, /ContentIdentityService\.ResolveAsync/);
assert.match(commandService, /LampacMetadataService\.GetVariants/);
assert.match(commandService, /SubscriptionStore\.Mutate/);

// Content/voice state is shared user metadata. Card state must never couple
// itself back to profile-local watched progress or touch the TimeCode DB.
assert.ok(contentStateController, 'v2 content-state controller method could not be isolated');
assert.doesNotMatch(contentStateController, /ResolveProfileId|profileId|TimeCodeProgressService/);
assert.match(contentStateController,
  /TranslationSubContentStateService\.BuildAsync\(\s*uid,\s*body,\s*HttpContext\s*\)/);
assert.match(contentStateService,
  /BuildAsync\(\s*string uid,\s*JObject payload,\s*HttpContext httpContext = null\s*\)/);
assert.doesNotMatch(contentStateService, /\bprofileId\b|ProfileProgressStore|TimeCodeProgressService/);

// Public application API is v2-only.
for (const route of [
  'translationsub/v2/snapshot',
  'translationsub/v2/content-state',
  'translationsub/v2/subscriptions',
  'translationsub/v2/check'
]) assert.match(v2Controller, new RegExp(route.replaceAll('/', '\\/')));
assert.match(settingsController, /Route\("translationsub\/v2\/settings"\)/);

const publicControllers = v2Controller + '\n' + settingsController + '\n' + pluginController;
assert.doesNotMatch(publicControllers, /transsubscribe\//i);
assert.doesNotMatch(publicControllers, /translationsub\/(?:list|updates|progress|variants|add|remove|check|user-settings|sources)(?:"|\?|\/)/i);

// Browser layers consume backend decisions instead of reconstructing them.
for (const call of ['client.contentSummary(', 'client.contentState(', 'client.subscribe(', 'client.unsubscribe('])
  assert.ok(cardFlow.includes(call), `missing backend card-flow call ${call}`);
for (const obsolete of ['sameContent', 'latestAiredSeason', 'normalizeVoice', 'findExisting', 'ensureExternalIds'])
  assert.doesNotMatch(cardFlow, new RegExp(`function\\s+${obsolete}\\s*\\(`));
assert.match(sourceClient, /item\.navigation/);
assert.doesNotMatch(sourceClient, /function\s+tmdbId\s*\(/);
assert.doesNotMatch(sourceClient, /item\.isSerial\s*!==\s*false/);

// Mutation commands return the canonical profile snapshot. BadgeState is the
// only browser layer that knows how a command result carries that snapshot.
assert.match(contentStateModel, /JsonProperty\("snapshot"\)[\s\S]{0,120}?TranslationSubSnapshot Snapshot/);
assert.match(v2Controller, /Subscribe[\s\S]*?result\.Snapshot\s*=\s*TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(v2Controller, /Unsubscribe[\s\S]*?result\.Snapshot\s*=\s*TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(badge, /function\s+applyCommand\s*\(result\)[\s\S]{0,300}?result\.snapshot[\s\S]{0,300}?applySnapshot\(result\.snapshot\)/);
assert.match(cardFlow, /badge\.applyCommand\(result\)/);
assert.match(sourceClient, /badge\.applyCommand\(result\)/);
assert.doesNotMatch(cardFlow, /result\.snapshot|badge\.applySnapshot\(/);
assert.doesNotMatch(sourceClient, /result\.snapshot|badge\.applySnapshot\(/);

// Manual refresh is a backend command returning the canonical snapshot directly.
assert.match(v2Controller, /Route\("translationsub\/v2\/check"\)/);
assert.match(v2Controller, /TranslationSubscriptionService\.Tick\(uid, selectedSources, force: true\)/);
assert.match(v2Controller, /TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(apiClient, /request\('POST', '\/translationsub\/v2\/check'/);
assert.doesNotMatch(apiClient, /['"]\/translationsub\/check/);

// Settings policy stays backend-owned; badge is a read-only snapshot cache.
assert.match(settingsStore, /CheckIntervalHours \{ get; set; \} = 1/);
assert.match(settingsStore, /TmdbRefreshHours \{ get; set; \} = 24/);
assert.match(badge, /api\.snapshot/);
assert.doesNotMatch(badge, /setInterval\(refresh/);

// Realtime owns only websocket transport. Identity/host come from the shared API
// client, and invalidation always refreshes canonical BadgeState.
const badgeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-badge-state.js")');
const realtimeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-realtime.js")');
assert.ok(badgeLoad >= 0 && realtimeLoad > badgeLoad, 'realtime client must load after BadgeState');
assert.match(realtimeClient, /translationsub_nws_id/);
assert.doesNotMatch(realtimeClient, /lampac_nws_id/);
assert.match(realtimeClient, /client\.host\(\)/);
assert.match(realtimeClient, /client\.uid\(\)/);
assert.match(realtimeClient, /client\.profileId\(\)/);
assert.doesNotMatch(realtimeClient, /function\s+(?:uid|profileId|host)\s*\(/);
assert.doesNotMatch(realtimeClient, /TranslationSub\.checkUpdates/);
assert.match(realtimeClient, /TranslationSubRegister/);
assert.match(realtimeClient, /TranslationSubChanged/);
assert.match(realtimeClient, /window\.TranslationSubBadgeState\.refresh\(\)/);

// Execute production realtime client against a minimal socket harness.
const storage = new Map();
const sockets = [];
let badgeRefreshes = 0;
let timerId = 0;
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
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
  Lampa: {
    Storage: {
      get(name, fallback) { return storage.has(name) ? storage.get(name) : fallback; },
      set(name, value) { storage.set(name, value); }
    },
    Utils: { uid() { return 'abcdef0123456789abcdef0123456789'; } },
    Listener: { follow() {} }
  },
  TranslationSubApi: {
    host() { return 'http://lampac.test'; },
    uid() { return 'user1'; },
    profileId() { return '7'; }
  }
};
context.window = context;
context.window.Lampa = context.Lampa;
context.window.TranslationSubApi = context.TranslationSubApi;
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

console.log('TranslationSub v2-only backend-first architecture simulation passed.');
