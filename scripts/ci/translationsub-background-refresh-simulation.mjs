import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const moduleDir = path.join(root, 'Modules', 'TranslationSub');

function read(name) {
  return fs.readFileSync(path.join(moduleDir, name), 'utf8');
}

const coreSource = read('translationsub.js');
const apiSource = read('translationsub-api.js');
const badgeSource = read('translationsub-badge-state.js');
const navigationSource = read('translationsub-navigation.js');
const noticeSource = read('translationsub-notice.js');
const realtimeSource = read('translationsub-realtime.js');
const settingsSource = read('translationsub-settings-v2.js');
const sourceSource = read('translationsub-source.js');
const uiSource = read('translationsub-ui.js');
const v2ControllerSource = read('V2Controller.cs');
const settingsControllerSource = read('SettingsController.cs');
const modInitSource = read('ModInit.cs');
const pluginControllerSource = read('PluginController.cs');

for (const obsolete of [
  'Controller.cs',
  'translationsub-watch.js',
  'translationsub-tmdb-ui.js',
  'translationsub-polish.js',
  'translationsub-layout-v3.js',
  'translationsub-mobile.js',
  'translationsub-bell-theme.js'
]) {
  assert.ok(!fs.existsSync(path.join(moduleDir, obsolete)),
    `Obsolete TranslationSub file must stay removed: ${obsolete}`);
  assert.doesNotMatch(pluginControllerSource, new RegExp(obsolete.replaceAll('.', '\\.')),
    `Removed TranslationSub file must not be shipped: ${obsolete}`);
}

// Backend owns progress propagation and every canonical read reconciles TimeCode.
assert.match(modInitSource, /"\/timecode\/add"/);
assert.match(modInitSource, /Response\.OnCompleted/);
assert.match(modInitSource, /PublishProfile\(uid, profileId, "timecode"\)/);
assert.match(v2ControllerSource,
  /Route\("translationsub\/v2\/snapshot"\)[\s\S]*?TimeCodeProgressService\.SyncUser\(uid, profileId\)/);

// Core owns readiness; public facade only opens the subscriptions page.
assert.match(coreSource, /function\s+createRuntime\s*\(/);
assert.match(coreSource,
  /window\.TranslationSub\s*=\s*\{\s*openSubscriptions\s*:\s*openSubscriptionsPage\s*\}/m);
assert.doesNotMatch(realtimeSource,
  /window\.TranslationSubRealtime\s*=|\bmanualClose\b|function\s+close\s*\(/);

// Profile identity is attached only to profile-specific endpoints.
const profileParamCount = (apiSource.match(/profile_id\s*:\s*profileId\(\)/g) || []).length;
assert.equal(profileParamCount, 4,
  'profile_id must be sent only by snapshot/subscribe/unsubscribe/check');
assert.doesNotMatch(apiSource, /if\s*\(!params\.profile_id\)/,
  'generic API request must not attach profile_id to every endpoint');
assert.match(apiSource, /function\s+snapshot[\s\S]{0,240}?profile_id\s*:\s*profileId\(\)/);
assert.match(apiSource, /function\s+subscribe[\s\S]{0,240}?profile_id\s*:\s*profileId\(\)/);
assert.match(apiSource, /function\s+unsubscribe[\s\S]{0,240}?profile_id\s*:\s*profileId\(\)/);
assert.match(apiSource, /function\s+check[\s\S]{0,180}?profile_id\s*:\s*profileId\(\)/);
assert.match(apiSource, /function\s+contentState[\s\S]{0,180}?v2\/content-state', \{\}/);
assert.match(apiSource, /function\s+contentSummary[\s\S]{0,180}?v2\/content-state', \{\}/);
assert.match(apiSource, /function\s+settings[\s\S]{0,160}?v2\/settings', \{\}/);
assert.match(apiSource, /function\s+updateSettings[\s\S]{0,180}?v2\/settings', \{\}/);

// Settings GET/POST share the canonical response envelope and server-owned policy.
assert.doesNotMatch(settingsControllerSource, /\bavailableSources\b/);
assert.equal((settingsControllerSource.match(/success\s*=\s*true/g) || []).length, 2,
  'both settings GET and POST must return the canonical success envelope');
assert.equal((settingsControllerSource.match(/availableSourceItems\s*=\s*options/g) || []).length, 2,
  'both settings GET and POST must expose the same source item collection');
assert.doesNotMatch(settingsSource,
  /function\s+canonicalSettings\s*\(|data\.AvailableSourceItems|settings\.availableSourceItems|settings\.AvailableSourceItems/);
assert.match(settingsSource,
  /var\s+settings\s*=\s*data\.settings\s*&&\s*typeof\s+data\.settings\s*===\s*['"]object['"]\s*\?\s*data\.settings\s*:\s*\{\}/);
assert.match(settingsSource, /availableItems\s*=\s*normalizeItems\(data\.availableSourceItems\s*\|\|\s*\[\]\)/);
assert.doesNotMatch(settingsSource, /item\.Id|item\.Name/);

// State/network refresh is event-driven: one startup read, foreground revalidate,
// command application and NWS invalidation. There is no background snapshot poll.
assert.doesNotMatch(badgeSource, /setInterval\s*\(\s*refresh/);
assert.match(badgeSource, /function\s+start\s*\(\)[\s\S]*?refresh\(\)/);
assert.match(badgeSource, /visibilitychange[\s\S]*if\s*\(!document\.hidden\)\s*refresh\(\)/);
assert.match(badgeSource, /translationsub-head--has-updates/);
assert.match(realtimeSource, /TranslationSubChanged/);
assert.match(realtimeSource, /window\.TranslationSubBadgeState\.refresh\(\)/);

// UI owns bell geometry/styles; navigation owns the single DOM repair observer and
// repaints only cached BadgeState after reconstructing head/menu nodes.
assert.match(uiSource, /BELL_BODY/);
assert.match(uiSource, /BELL_CLAPPER/);
assert.match(uiSource, /translationsub-layout--mobile/);
assert.match(uiSource, /translationsub-full-button--mobile/);
assert.match(uiSource,
  /\.translationsub-head\{position:relative;display:flex;align-items:center;justify-content:center\}/);
assert.match(navigationSource, /new\s+MutationObserver\s*\(/);
assert.match(navigationSource, /TranslationSubBadgeState\.render/);
assert.doesNotMatch(navigationSource, /TranslationSubBellTheme|repairTimer|15000/);
assert.doesNotMatch(noticeSource, /new\s+MutationObserver|setInterval\s*\(\s*refresh/);
assert.doesNotMatch(sourceSource, /data-translationsub-card-source/);

function jqueryStub() {
  return {
    length: 0,
    first() { return this; },
    children() { return this; },
    each() { return this; },
    append() { return this; },
    text() { return this; },
    show() { return this; },
    hide() { return this; },
    toggleClass() { return this; }
  };
}

const documentListeners = new Map();
const network = [];
const pendingSnapshots = [];
let autoResolveSnapshots = true;
const sandbox = {
  console, Promise, Date, Math, isNaN,
  document: {
    hidden: false,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return {}; },
    addEventListener(name, callback) {
      if (!documentListeners.has(name)) documentListeners.set(name, []);
      documentListeners.get(name).push(callback);
    }
  },
  $: jqueryStub,
  setInterval() { throw new Error('BadgeState must not start a polling interval'); },
  clearInterval() {},
  setTimeout(fn) { fn(); return 1; },
  clearTimeout() {},
  TranslationSubRuntime: { onReady(callback) { callback(); } },
  TranslationSubApi: {
    profileId() { return '0'; },
    snapshot(success) {
      network.push('snapshot');
      if (autoResolveSnapshots) {
        success({ profileId: '0', badge: { count: 0 }, subscriptions: [], updates: [] });
      } else {
        pendingSnapshots.push(success);
      }
    }
  }
};
sandbox.window = sandbox;
sandbox.window.TranslationSubRuntime = sandbox.TranslationSubRuntime;
sandbox.window.TranslationSubApi = sandbox.TranslationSubApi;

vm.runInNewContext(badgeSource, sandbox, { filename: 'translationsub-badge-state.js' });
assert.deepEqual(network, ['snapshot'], 'startup must perform exactly one snapshot read');
assert.equal(
  Object.keys(sandbox.TranslationSubBadgeState).sort().join(','),
  'applyCommand,open,refresh,render,subscribe',
  'BadgeState public surface must stay minimal'
);

const observedCounts = [];
const unsubscribe = sandbox.TranslationSubBadgeState.subscribe((value) => observedCounts.push(value.count));
assert.deepEqual(observedCounts, [0], 'state subscription must publish current snapshot immediately');
const applied = sandbox.TranslationSubBadgeState.applyCommand({
  success: true,
  snapshot: { profileId: '0', badge: { count: 3 }, subscriptions: [], updates: [{ id: 'x' }] }
});
assert.equal(applied && applied.count, 3, 'command application must return canonical state view');
assert.deepEqual(observedCounts, [0, 3], 'subscription must publish authoritative snapshot changes');
unsubscribe();

sandbox.document.hidden = false;
for (const callback of documentListeners.get('visibilitychange') || []) callback();
assert.deepEqual(network, ['snapshot', 'snapshot'],
  'foreground return must add exactly one snapshot read');

// Concurrent consumers share one in-flight GET and all waiters complete from it.
autoResolveSnapshots = false;
let coalescedCallbacks = 0;
sandbox.TranslationSubBadgeState.refresh(() => { coalescedCallbacks++; });
sandbox.TranslationSubBadgeState.refresh(() => { coalescedCallbacks++; });
assert.deepEqual(network, ['snapshot', 'snapshot', 'snapshot'],
  'two concurrent refresh consumers must create only one network read');
assert.equal(pendingSnapshots.length, 1, 'exactly one snapshot request must remain in flight');
pendingSnapshots.shift()({
  profileId: '0', badge: { count: 1 }, subscriptions: [], updates: [{ id: 'new' }]
});
assert.equal(coalescedCallbacks, 2, 'all coalesced refresh consumers must be completed');
let finalCount = -1;
const stop = sandbox.TranslationSubBadgeState.subscribe((value) => { finalCount = value.count; });
stop();
assert.equal(finalCount, 1, 'coalesced snapshot must update canonical state');

console.log('TranslationSub refresh ownership: one startup read, coalesced state, no client polling.');
