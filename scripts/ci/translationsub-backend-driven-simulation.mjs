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
const database = read('Modules/TranslationSub/Services/TranslationSubDatabase.cs');
const badge = read('Modules/TranslationSub/translationsub-badge-state.js');
const apiClient = read('Modules/TranslationSub/translationsub-api.js');
const settingsStore = read('Modules/TranslationSub/Services/TranslationSettingsStore.cs');
const realtimeService = read('Modules/TranslationSub/Services/TranslationSubRealtimeService.cs');
const subscriptionStore = read('Modules/TranslationSub/Services/SubscriptionStore.cs');
const subscriptionModel = read('Modules/TranslationSub/Models/TranslationSubscription.cs');
const contentStateModel = read('Modules/TranslationSub/Models/TranslationSubContentState.cs');
const variantModel = read('Modules/TranslationSub/Models/TranslationVariant.cs');
const metadataModel = read('Modules/TranslationSub/Models/TranslationMetadata.cs');
const profileProgressModel = read('Modules/TranslationSub/Models/SubscriptionProfileProgress.cs');
const profileProgressStore = read('Modules/TranslationSub/Services/ProfileProgressStore.cs');
const progressService = read('Modules/TranslationSub/Services/TimeCodeProgressService.cs');
const metadataService = read('Modules/TranslationSub/Services/LampacMetadataService.cs');
const metadataClient = read('Modules/TranslationSub/Services/LampacMetadataClient.cs');
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
assert.ok(!fs.existsSync('Modules/TranslationSub/translationsub-bell-theme.js'),
  'Obsolete bell theme adapter must stay removed');
assert.doesNotMatch(pluginController, /translationsub-(?:watch|bell-theme)\.js/);

// Canonical persistence is one SQLite database. Legacy JSON files are cleanup-only.
assert.match(database, /DatabasePath\s*=\s*"database\/translationsub\.db"/);
for (const table of ['settings', 'subscriptions', 'profile_progress'])
  assert.match(database, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
for (const store of [settingsStore, subscriptionStore, profileProgressStore])
  assert.match(store, /TranslationSubDatabase\.Open\(\)/);
assert.doesNotMatch(settingsStore + subscriptionStore + profileProgressStore,
  /database\/translationsub\/(?:settings|subscriptions|profile-progress)\.json/);

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

// Watched progress is backend-owned and reconciled from TimeCode.
assert.match(timeCode, /Route\("\/timecode\/add"\)/);
assert.match(modInit, /"\/timecode\/add"/);
assert.match(modInit, /Response\.OnCompleted/);
assert.match(modInit, /TimeCodeProgressService\.SyncUser\(uid, profileId\)/);
assert.match(modInit, /PublishProfile\(uid, profileId, "timecode"\)/);
assert.match(v2Controller, /Route\("translationsub\/v2\/snapshot"\)[\s\S]*?TimeCodeProgressService\.SyncUser\(uid, profileId\)/);

// Profile-local state stays separate from shared subscription metadata.
assert.match(profileProgressModel, /class SubscriptionProfileProgress/);
assert.match(profileProgressModel, /class TranslationSubProfileProjection/);
assert.match(profileProgressModel, /WatchedEpisode/);
assert.doesNotMatch(subscriptionModel, /\bCurrentEpisode\b|\bNotified\b/);
assert.match(profileProgressStore, /ProfileId/);
assert.match(profileProgressStore, /SubscriptionId/);
assert.match(progressService, /ProfileProgressStore\.Upsert\(uid, profileId, watchedBySubscription\)/);
assert.doesNotMatch(progressService, /CurrentEpisode|Notified/);
assert.match(projectionService, /List<TranslationSubProfileProjection>/);
assert.match(projectionService, /WatchedEpisode\s*=/);

// Canonical read model owns derived state and navigation targets.
for (const symbol of ['HasNewEpisodes', 'NewCount', 'ProgressPercent', 'BuildSchedule', 'BuildNavigation'])
  assert.match(snapshotService, new RegExp(symbol));
assert.match(snapshotService, /Badge = new TranslationSubBadgeSnapshot/);
assert.match(snapshotService, /projection\.WatchedEpisode/);
assert.match(snapshotService, /Navigation = BuildNavigation\(sub\)/);

// Identity/source/voice decisions are backend-owned.
assert.match(contentStateService, /ContentIdentityService\.ResolveAsync/);
assert.match(contentStateService, /LampacMetadataService\.GetVariants/);
assert.match(commandService, /ContentIdentityService\.ResolveAsync/);
assert.match(commandService, /LampacMetadataService\.GetVariants/);
assert.match(commandService, /SubscriptionStore\.Mutate/);

// Metadata identity must be scoped before any Lampac uid/token propagation.
const metadataGet = (metadataClient.match(
  /static async Task<string> GetAsync\([\s\S]*?\n    public static string AppendQuery/
) || [''])[0];
assert.ok(metadataGet, 'LampacMetadataClient.GetAsync could not be isolated');
assert.match(metadataClient, /TrustedExternalOrigin\(source\.Url, httpContext\)/);
assert.match(metadataClient, /static bool SameOrigin\(Uri uri, Uri trustedOrigin\)/);
assert.match(metadataGet, /if \(localRoute \|\| SameOrigin\(uri, trustedExternalOrigin\)\)/);
assert.ok(
  metadataGet.indexOf('ResolveRequestUri(pathOrUrl') >= 0
    && metadataGet.indexOf('ResolveRequestUri(pathOrUrl') < metadataGet.indexOf('AccsDbInvk.Args(pathOrUrl'),
  'metadata target must be resolved before native identity is attached'
);

// Scheduler mutations replay once against fresh storage and no-op batches do not write.
assert.match(subscriptionStore, /AsyncLocal<MutationBatch>/);
assert.match(subscriptionStore, /public static IDisposable BeginBatch\(\)/);
assert.match(subscriptionService,
  /var snapshot = SubscriptionStore\.Load\(\);\s*using var storeBatch = SubscriptionStore\.BeginBatch\(\);/);
const flushBatch = (subscriptionStore.match(
  /static void FlushBatch\(MutationBatch batch\)[\s\S]*?\n    static Dictionary<string, string> SharedStateByUid/
) || [''])[0];
assert.ok(flushBatch, 'SubscriptionStore batch flush could not be isolated');
assert.match(flushBatch, /Operations\.Count == 0[\s\S]*?return;/);
assert.match(flushBatch,
  /beforePersisted[\s\S]*?PersistedState\(list\)[\s\S]*?StringComparison\.Ordinal[\s\S]*?return;/);
assert.equal((flushBatch.match(/SaveUnsafe\(list\)/g) || []).length, 1,
  'one logical scheduler batch may save subscriptions only once');
assert.equal((flushBatch.match(/PublishSharedChanges\(changedUids\)/g) || []).length, 1,
  'one logical scheduler batch may publish shared changes only once');
assert.match(flushBatch, /var list = LoadUnsafe\(\)/,
  'queued scheduler mutations must replay against fresh storage at commit time');

// Internal metadata aggregate stays backend-only and compact.
assert.doesNotMatch(variantModel,
  /TranslationSourceBlock|public\s+string\s+Id\s*\{|public\s+string\s+Name\s*\{|public\s+string\s+KpId\s*\{|public\s+string\s+ImdbId\s*\{/);
const variantsResponse = (variantModel.match(/public class TranslationVariantsResponse[\s\S]*?\n}/) || [''])[0];
assert.ok(variantsResponse, 'TranslationVariantsResponse model could not be isolated');
assert.match(variantsResponse, /List<TranslationVariant>\s+Translations/);
assert.doesNotMatch(variantsResponse, /\bSource\b|\bSeasons\b|\bItems\b/);
assert.doesNotMatch(metadataModel, /\bSourceName\b/);
assert.doesNotMatch(metadataClient, /\bSourceName\s*=/);
assert.doesNotMatch(metadataService, /\bsourceNames\b|\bblocks\b|TranslationSourceBlock|\bSeasons\s*=|\bItems\s*=/);

// Available source discovery is synchronous registry state.
assert.doesNotMatch(metadataService, /AvailableSourcesAsync|Task\.FromResult<IReadOnlyList<LampacSourceOption>>/);
assert.equal((settingsController.match(/LampacSourceRegistry\.AvailableSources\(\)/g) || []).length, 2,
  'settings GET and POST must read available sources directly from the registry');

// Content/voice state is user-wide and must not couple to profile-local progress.
assert.ok(contentStateController, 'v2 content-state controller method could not be isolated');
assert.doesNotMatch(contentStateController, /ResolveProfileId|profileId|TimeCodeProgressService/);
assert.match(contentStateController,
  /TranslationSubContentStateService\.BuildAsync\(\s*uid,\s*body,\s*HttpContext\s*\)/);
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
assert.doesNotMatch(publicControllers, /translationsub\/(?:list|updates|progress|variants|add|remove|user-settings|sources)(?:"|\?|\/)/i);

// Browser layers consume backend decisions instead of reconstructing them.
for (const call of ['client.contentSummary(', 'client.contentState(', 'client.subscribe(', 'client.unsubscribe('])
  assert.ok(cardFlow.includes(call), `missing backend card-flow call ${call}`);
for (const obsolete of ['sameContent', 'latestAiredSeason', 'normalizeVoice', 'findExisting', 'ensureExternalIds'])
  assert.doesNotMatch(cardFlow, new RegExp(`function\\s+${obsolete}\\s*\\(`));
assert.match(sourceClient, /item\.navigation/);
assert.doesNotMatch(sourceClient, /function\s+tmdbId\s*\(/);

// Commands return canonical snapshots and BadgeState is their sole browser owner.
assert.match(contentStateModel, /JsonProperty\("snapshot"\)[\s\S]{0,120}?TranslationSubSnapshot Snapshot/);
assert.match(v2Controller, /Subscribe[\s\S]*?result\.Snapshot\s*=\s*TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(v2Controller, /Unsubscribe[\s\S]*?result\.Snapshot\s*=\s*TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(badge, /function\s+applyCommand\s*\(result\)[\s\S]{0,320}?result\.snapshot[\s\S]{0,320}?applySnapshot\(result\.snapshot\)/);
assert.match(cardFlow, /badge\.applyCommand\(result\)/);
assert.match(sourceClient, /badge\.applyCommand\(result\)/);

// Manual refresh is a backend command returning the canonical snapshot directly.
assert.match(v2Controller, /Route\("translationsub\/v2\/check"\)/);
assert.match(v2Controller, /TranslationSubscriptionService\.Tick\([\s\S]{0,160}?force:\s*true\)/);
assert.match(v2Controller, /TranslationSubSnapshotService\.Build\(uid, profileId\)/);
assert.match(apiClient, /request\('POST', '\/translationsub\/v2\/check'/);

// Settings policy stays backend-owned; badge is a read-only snapshot cache.
assert.match(settingsStore, /CheckIntervalHours \{ get; set; \} = 1/);
assert.match(settingsStore, /TmdbRefreshHours \{ get; set; \} = 24/);
assert.match(badge, /api\.snapshot/);
assert.doesNotMatch(badge, /setInterval\(refresh/);

// Realtime owns only websocket transport and invalidates canonical BadgeState.
const badgeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-badge-state.js")');
const realtimeLoad = pluginController.indexOf('AppendScript(ref script, "translationsub-realtime.js")');
assert.ok(badgeLoad >= 0 && realtimeLoad > badgeLoad, 'realtime client must load after BadgeState');
assert.match(realtimeClient, /translationsub_nws_id/);
assert.match(realtimeClient, /client\.host\(\)/);
assert.match(realtimeClient, /client\.uid\(\)/);
assert.match(realtimeClient, /client\.profileId\(\)/);
assert.match(realtimeClient, /TranslationSubRegister/);
assert.match(realtimeClient, /TranslationSubChanged/);
assert.match(realtimeClient, /window\.TranslationSubBadgeState\.refresh\(\)/);

// Execute the production realtime client against a minimal socket harness.
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
  addEventListener() {},
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
  TranslationSubRuntime: { onReady(callback) { callback(); } },
  TranslationSubApi: {
    host() { return 'http://lampac.test'; },
    uid() { return 'user1'; },
    profileId() { return '7'; }
  }
};
context.window = context;
context.window.Lampa = context.Lampa;
context.window.TranslationSubRuntime = context.TranslationSubRuntime;
context.window.TranslationSubApi = context.TranslationSubApi;
context.window.TranslationSubBadgeState = { refresh() { badgeRefreshes++; } };

vm.runInNewContext(realtimeClient, context, { filename: 'translationsub-realtime.js' });
assert.equal(sockets.length, 1);
const ws = sockets[0];
ws.readyState = FakeWebSocket.OPEN;
ws.onopen();
ws.onmessage({ data: JSON.stringify({ method: 'Connected', args: ['server-connection'] }) });
assert.deepEqual(JSON.parse(ws.sent[0]), { method: 'TranslationSubRegister', args: ['user1', '7'] });
assert.equal(badgeRefreshes, 1, 'connect registration must revalidate the canonical snapshot');
ws.onmessage({ data: JSON.stringify({ method: 'TranslationSubChanged', args: [1, 'timecode'] }) });
assert.equal(badgeRefreshes, 2, 'state invalidation must revalidate the canonical snapshot');

console.log('TranslationSub v2-only backend-first architecture simulation passed.');
