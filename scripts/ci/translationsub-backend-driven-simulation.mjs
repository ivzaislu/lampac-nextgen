import fs from 'node:fs';
import assert from 'node:assert/strict';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const nativeWs = read('Core/Services/NativeWebSocket.cs');
const sharedStartup = read('Shared/Startup.cs');
const nwsClient = read('Core/plugins/nws-client-es5.js');
const coreStartup = read('Core/Startup.cs');
const requestInfo = read('Core/Middlewares/RequestInfo.cs');
const events = read('Shared/Models/Events/EventListener.cs');
const timeCode = read('Modules/Sync/TimeCode/Controller.cs');
const modInit = read('Modules/TranslationSub/ModInit.cs');
const controller = read('Modules/TranslationSub/Controller.cs');
const watch = read('Modules/TranslationSub/translationsub-watch.js');
const badge = read('Modules/TranslationSub/translationsub-badge-state.js');
const settingsStore = read('Modules/TranslationSub/Services/TranslationSettingsStore.cs');

// Lampac already owns the server->client transport.
assert.match(sharedStartup, /public static INws Nws/);
assert.match(nativeWs, /AllConnections\(\)/);
assert.match(nativeWs, /SendAsync\(string connectionId, string method/);
assert.match(coreStartup, /app\.Map\("\/nws"/);

// Lampac's ES5 client already supports arbitrary named messages in both directions.
assert.match(nwsClient, /NativeWsClient\.prototype\.on/);
assert.match(nwsClient, /NativeWsClient\.prototype\.invoke/);
assert.match(nwsClient, /global\.NativeWsClient = NativeWsClient/);

// Modules can observe NWS registration/disconnect and HTTP middleware.
assert.match(events, /Action<EventNwsMessage> NwsMessage/);
assert.match(events, /Action<EventNwsDisconnected> NwsDisconnected/);
assert.match(events, /Func<bool, EventMiddleware, bool> Middleware/);

// The second module middleware runs after authorization/AccsDB, so a module can
// attach Response.OnCompleted to /timecode/add without changing TimeCode itself.
const authPos = coreStartup.indexOf('app.UseAuthorization()');
const accsPos = coreStartup.indexOf('app.UseAccsdb()');
const secondModulePos = coreStartup.indexOf('app.UseModule(first: false)');
assert.ok(authPos >= 0 && accsPos > authPos && secondModulePos > accsPos,
  'second module middleware must run after AccsDB');

// WebSocket RequestInfo normally does not resolve user_uid, so TranslationSub
// must explicitly register uid + profile_id over the existing NWS channel.
assert.match(requestInfo, /if \(!IsWsRequest\)/);
assert.match(requestInfo, /req\.user_uid = uid/);

// Standard TimeCode write endpoint and profile-aware storage identity.
assert.match(timeCode, /Route\("\/timecode\/add"\)/);
assert.match(timeCode, /profile_id/);
assert.match(timeCode, /user_id = \$"\{user_id\}_\{profile_id\}"/);

// Existing TranslationSub module can subscribe to Lampac events in ModInit.
assert.match(modInit, /EventListener\./);

// User-level cadence defaults already match the intended backend policy.
assert.match(settingsStore, /CheckIntervalHours \{ get; set; \} = 1/);
assert.match(settingsStore, /TmdbRefreshHours \{ get; set; \} = 24/);

// Current implementation still has frontend-driven synchronization; the target
// below intentionally models the replacement rather than pretending it exists.
assert.match(watch, /Timeline\.listener\.follow\('update'/);
assert.match(badge, /setInterval\(refresh, 60 \* 1000\)/);
assert.match(controller, /SyncTimeCodeProgress\(uid\)/);

class RealtimeModel {
  constructor() {
    this.registrations = new Map();
    this.sent = [];
    this.revisions = new Map();
  }

  key(uid, profileId) {
    const profile = String(profileId || '0');
    return `${uid}|${profile}`;
  }

  register(connectionId, uid, profileId) {
    assert.ok(connectionId && uid);
    this.registrations.set(connectionId, {
      uid: String(uid),
      profileId: String(profileId || '0')
    });
  }

  disconnect(connectionId) {
    this.registrations.delete(connectionId);
  }

  nextRevision(uid, profileId) {
    const key = this.key(uid, profileId);
    const revision = (this.revisions.get(key) || 0) + 1;
    this.revisions.set(key, revision);
    return revision;
  }

  publishProfile(uid, profileId, reason) {
    const revision = this.nextRevision(uid, profileId);
    for (const [connectionId, registration] of this.registrations) {
      if (registration.uid !== String(uid)) continue;
      if (registration.profileId !== String(profileId || '0')) continue;
      this.sent.push({ connectionId, method: 'TranslationSubChanged', revision, reason });
    }
  }

  publishUid(uid, reason) {
    const profiles = new Set();
    for (const registration of this.registrations.values()) {
      if (registration.uid === String(uid)) profiles.add(registration.profileId);
    }
    for (const profileId of profiles) this.publishProfile(uid, profileId, reason);
  }

  reset() {
    this.sent.length = 0;
  }
}

const realtime = new RealtimeModel();
realtime.register('c-u1-p7', 'user1', '7');
realtime.register('c-u1-p8', 'user1', '8');
realtime.register('c-u2-p7', 'user2', '7');

// TimeCode changed for one Lampa profile: notify only that profile.
realtime.publishProfile('user1', '7', 'timecode');
assert.deepEqual(realtime.sent.map(x => x.connectionId), ['c-u1-p7']);
console.log('TARGET TimeCode write: one profile-specific NWS invalidation');
realtime.reset();

// TMDB/balancer metadata is shared by UID: notify every connected profile of UID.
realtime.publishUid('user1', 'metadata');
assert.deepEqual(realtime.sent.map(x => x.connectionId).sort(), ['c-u1-p7', 'c-u1-p8']);
console.log('TARGET scheduler metadata change: all profiles of UID invalidated once');
realtime.reset();

// No state change means no invalidation at all.
assert.equal(realtime.sent.length, 0);
console.log('TARGET scheduler no-op: zero NWS events');

// Disconnect cleanup prevents stale sends.
realtime.disconnect('c-u1-p8');
realtime.publishUid('user1', 'metadata');
assert.deepEqual(realtime.sent.map(x => x.connectionId), ['c-u1-p7']);
console.log('TARGET disconnect: stale connection receives nothing');
realtime.reset();

// Frontend network ownership in the target architecture.
const frontend = {
  startupSnapshots: 1,
  idlePollingRequests: 0,
  timeCodeProgressRequests: 0,
  bellProgressRequests: 0
};
assert.equal(frontend.startupSnapshots, 1);
assert.equal(frontend.idlePollingRequests, 0);
assert.equal(frontend.timeCodeProgressRequests, 0);
assert.equal(frontend.bellProgressRequests, 0);
console.log('TARGET frontend idle: zero polling and zero /progress requests');

// A pushed invalidation causes one profile-aware snapshot read. The backend owns
// all TimeCode/TMDB/balancer decisions; frontend only renders the returned state.
const pushedRefresh = { progress: 0, updates: 1, profileAware: true };
assert.deepEqual(pushedRefresh, { progress: 0, updates: 1, profileAware: true });
console.log('TARGET pushed change: 0 progress + 1 profile-aware updates snapshot');

// Intended API split after migration: /updates becomes a read snapshot. Keep this
// as a target assertion only; current Controller.cs still has SyncTimeCodeProgress.
console.log('TARGET API ownership: /updates read-only; TimeCode writes and scheduler publish invalidations');
console.log('TranslationSub backend-driven architecture simulation passed.');
