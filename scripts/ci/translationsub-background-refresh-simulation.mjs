import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const moduleDir = path.join(root, 'Modules', 'TranslationSub');

function read(name) {
  return fs.readFileSync(path.join(moduleDir, name), 'utf8');
}

const badgeSource = read('translationsub-badge-state.js');
const bellSource = read('translationsub-bell-theme.js');
const navigationSource = read('translationsub-navigation.js');
const realtimeSource = read('translationsub-realtime.js');
const v2ControllerSource = read('V2Controller.cs');
const modInitSource = read('ModInit.cs');
const pluginControllerSource = read('PluginController.cs');

assert.ok(!fs.existsSync(path.join(moduleDir, 'Controller.cs')),
  'Legacy TranslationSub controller must stay removed');
assert.ok(!fs.existsSync(path.join(moduleDir, 'translationsub-watch.js')),
  'Client progress watcher must stay removed');
assert.doesNotMatch(pluginControllerSource, /translationsub-watch\.js/,
  'Removed progress watcher must not be shipped');

// Backend owns progress propagation and every canonical read reconciles from
// TimeCode as a safety net for restarts or missed realtime delivery.
assert.match(modInitSource, /"\/timecode\/add"/);
assert.match(modInitSource, /Response\.OnCompleted/);
assert.match(modInitSource, /PublishProfile\(uid, profileId, "timecode"\)/);
assert.match(v2ControllerSource,
  /Route\("translationsub\/v2\/snapshot"\)[\s\S]*?TimeCodeProgressService\.SyncUser\(uid, profileId\)/);

// State/network refresh is event driven: startup, app-ready, foreground and NWS.
assert.doesNotMatch(badgeSource, /setInterval\s*\(\s*refresh/);
assert.match(badgeSource, /function\s+start\s*\(\)[\s\S]*refresh\(\)/);
assert.match(badgeSource, /Lampa\.Listener\.follow\(['"]app['"][\s\S]*refresh\(\)/);
assert.match(badgeSource, /visibilitychange[\s\S]*if\s*\(!document\.hidden\)\s*refresh\(\)/);
assert.match(realtimeSource, /TranslationSubChanged/);
assert.match(realtimeSource, /window\.TranslationSubBadgeState\.refresh\(\)/);

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
      success({ badge: { count: 0 }, subscriptions: [], updates: [] });
    }
  }
};
sandbox.window = sandbox;
sandbox.window.Lampa = sandbox.Lampa;

vm.runInNewContext(badgeSource, sandbox, { filename: 'translationsub-badge-state.js' });
assert.deepEqual(network, ['snapshot'], 'startup must perform exactly one snapshot read');

const observedCounts = [];
const unsubscribe = sandbox.TranslationSubBadgeState.subscribe((value) => observedCounts.push(value.count));
assert.deepEqual(observedCounts, [0], 'state subscription must publish the current snapshot immediately');
sandbox.TranslationSubBadgeState.applySnapshot({ badge: { count: 3 }, subscriptions: [], updates: [{ id: 'x' }] });
assert.deepEqual(observedCounts, [0, 3], 'state subscription must publish authoritative snapshot changes');
unsubscribe();

appListeners.forEach((callback) => callback({ type: 'ready' }));
assert.deepEqual(network, ['snapshot', 'snapshot'], 'app-ready must add exactly one snapshot read');

sandbox.document.hidden = false;
for (const callback of documentListeners.get('visibilitychange') || []) callback();
assert.deepEqual(network, ['snapshot', 'snapshot', 'snapshot'],
  'foreground return must add exactly one snapshot read');

console.log('TranslationSub refresh ownership: server-driven state, no client polling.');
