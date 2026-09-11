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
const bellSource = read('translationsub-bell-theme.js');
const navigationSource = read('translationsub-navigation.js');
const noticeSource = read('translationsub-notice.js');
const realtimeSource = read('translationsub-realtime.js');
const sourceSource = read('translationsub-source.js');
const uiSource = read('translationsub-ui.js');
const v2ControllerSource = read('V2Controller.cs');
const modInitSource = read('ModInit.cs');
const pluginControllerSource = read('PluginController.cs');

for (const obsolete of [
  'Controller.cs',
  'translationsub-watch.js',
  'translationsub-tmdb-ui.js',
  'translationsub-polish.js',
  'translationsub-layout-v3.js',
  'translationsub-mobile.js'
]) {
  assert.ok(!fs.existsSync(path.join(moduleDir, obsolete)), `Obsolete TranslationSub file must stay removed: ${obsolete}`);
  assert.doesNotMatch(pluginControllerSource, new RegExp(obsolete.replaceAll('.', '\\.')),
    `Removed TranslationSub file must not be shipped: ${obsolete}`);
}

// Backend owns progress propagation and every canonical read reconciles from
// TimeCode as a safety net for restarts or missed realtime delivery.
assert.match(modInitSource, /"\/timecode\/add"/);
assert.match(modInitSource, /Response\.OnCompleted/);
assert.match(modInitSource, /PublishProfile\(uid, profileId, "timecode"\)/);
assert.match(v2ControllerSource,
  /Route\("translationsub\/v2\/snapshot"\)[\s\S]*?TimeCodeProgressService\.SyncUser\(uid, profileId\)/);

// The public browser surface stays intentionally small. Realtime is an internal
// transport module; core exposes only the page-opening facade.
assert.match(coreSource,
  /window\.TranslationSub\s*=\s*\{\s*openSubscriptions\s*:\s*openSubscriptionsPage\s*\}/m);
assert.doesNotMatch(coreSource, /\bversion\s*:\s*META\.version/);
assert.doesNotMatch(realtimeSource,
  /window\.TranslationSubRealtime\s*=|\bmanualClose\b|function\s+close\s*\(/);

// Removed DOM compatibility markers/selectors must not creep back in.
assert.doesNotMatch(badgeSource,
  /translationsub-head>\.translationsub-badge|translationsub-menu-item>\.translationsub-menu-badge/);
assert.doesNotMatch(sourceSource, /data-translationsub-card-source/);
assert.doesNotMatch(noticeSource,
  /data-translationsub-empty|translationsub-notice__empty \.notice__time/);

// Profile identity is transported only for endpoints whose response/state is
// profile-specific. Content-state and settings are user-wide/profile-independent.
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

// State/network refresh is event driven: one startup read, foreground revalidate
// and NWS invalidation. app-ready only renders the snapshot already in memory.
assert.doesNotMatch(badgeSource, /setInterval\s*\(\s*refresh/);
assert.match(badgeSource, /function\s+start\s*\(\)[\s\S]*refresh\(\)/);
assert.match(badgeSource,
  /Lampa\.Listener\.follow\(['"]app['"],\s*function\s*\(event\)\s*\{\s*if\s*\(!event\s*\|\|\s*event\.type\s*!==\s*['"]ready['"]\)\s*return;\s*render\(\);\s*\}\);/);
assert.match(badgeSource, /visibilitychange[\s\S]*if\s*\(!document\.hidden\)\s*refresh\(\)/);
assert.match(realtimeSource, /TranslationSubChanged/);
assert.match(realtimeSource, /window\.TranslationSubBadgeState\.refresh\(\)/);

// Presentation has one layout owner. Mobile/page layout lives in UI; deleted
// patch layers are forbidden from returning.
assert.match(uiSource, /translationsub-layout--mobile/);
assert.match(uiSource, /translationsub-full-button--mobile/);
assert.match(uiSource, /Lampa\.Listener\.follow\(['"]full['"]/);

// Presentation follows the observable snapshot store. Permanent visual repair
// polling is forbidden; MutationObserver/app lifecycle are the DOM repair path.
assert.match(badgeSource, /function\s+subscribe\s*\(/);
assert.match(bellSource, /badge\.subscribe\(updateHeadState\)/);
assert.doesNotMatch(bellSource, /setInterval\s*\(\s*updateHeadState/);
assert.doesNotMatch(bellSource, /750\s*\)/);
assert.match(navigationSource, /new\s+MutationObserver\s*\(/);
assert.doesNotMatch(navigationSource, /repairTimer/);
assert.doesNotMatch(navigationSource, /15000/);

function jqueryStub() {
  return {
    length: 0,
    first() { return this; }, children() { return this; }, each() { return this; },
    append() { return this; }, text() { return this; }, show() { return this; },
    hide() { return this; }
  };
}

const appListeners = [];
const documentListeners = new Map();
const network = [];
const pendingSnapshots = [];
let autoResolveSnapshots = true;
const sandbox = {
  console, Promise, Date, Math,
  document: {
    hidden: false,
    head: { appendChild() {} }, documentElement: { appendChild() {} },
    getElementById() { return null; }, createElement() { return {}; },
    addEventListener(name, callback) {
      if (!documentListeners.has(name)) documentListeners.set(name, []);
      documentListeners.get(name).push(callback);
    }
  },
  $: jqueryStub,
  setInterval() { throw new Error('BadgeState must not start a polling interval'); },
  clearInterval() {}, setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
  Lampa: {
    Listener: {
      follow(name, callback) { if (name === 'app') appListeners.push(callback); }
    }
  },
  TranslationSubApi: {
    snapshot(success) {
      network.push('snapshot');
      if (autoResolveSnapshots) success({ badge: { count: 0 }, subscriptions: [], updates: [] });
      else pendingSnapshots.push(success);
    }
  }
};
sandbox.window = sandbox;
sandbox.window.Lampa = sandbox.Lampa;

vm.runInNewContext(badgeSource, sandbox, { filename: 'translationsub-badge-state.js' });
assert.deepEqual(network, ['snapshot'], 'startup must perform exactly one snapshot read');
assert.equal(
  Object.keys(sandbox.TranslationSubBadgeState).sort().join(','),
  'applyCommand,open,refresh,render,subscribe',
  'BadgeState public surface must stay minimal'
);

const observedCounts = [];
const unsubscribe = sandbox.TranslationSubBadgeState.subscribe((value) => observedCounts.push(value.count));
assert.deepEqual(observedCounts, [0], 'state subscription must publish the current snapshot immediately');
const applied = sandbox.TranslationSubBadgeState.applyCommand({
  success: true,
  snapshot: { badge: { count: 3 }, subscriptions: [], updates: [{ id: 'x' }] }
});
assert.equal(applied && applied.count, 3, 'command application must return the canonical state view');
assert.deepEqual(observedCounts, [0, 3], 'state subscription must publish authoritative snapshot changes');
unsubscribe();

appListeners.forEach((callback) => callback({ type: 'ready' }));
assert.deepEqual(network, ['snapshot'], 'app-ready must not duplicate the startup snapshot read');

sandbox.document.hidden = false;
for (const callback of documentListeners.get('visibilitychange') || []) callback();
assert.deepEqual(network, ['snapshot', 'snapshot'],
  'foreground return must add exactly one snapshot read');

// Concurrent consumers (page + drawer/realtime) share one in-flight GET.
autoResolveSnapshots = false;
let coalescedCallbacks = 0;
sandbox.TranslationSubBadgeState.refresh(() => { coalescedCallbacks++; });
sandbox.TranslationSubBadgeState.refresh(() => { coalescedCallbacks++; });
assert.deepEqual(network, ['snapshot', 'snapshot', 'snapshot'],
  'two concurrent refresh consumers must create only one network read');
assert.equal(pendingSnapshots.length, 1, 'exactly one snapshot request must remain in flight');
pendingSnapshots.shift()({ badge: { count: 1 }, subscriptions: [], updates: [{ id: 'new' }] });
assert.equal(coalescedCallbacks, 2, 'all coalesced refresh consumers must be completed');
let finalCount = -1;
const stop = sandbox.TranslationSubBadgeState.subscribe((value) => { finalCount = value.count; });
stop();
assert.equal(finalCount, 1, 'coalesced snapshot must update canonical state');

console.log('TranslationSub refresh ownership: one startup read, coalesced state, no client polling.');
