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
const watchSource = read('translationsub-watch.js');
const badgeSource = read('translationsub-badge-state.js');
const controllerSource = read('Controller.cs');

// Bind the simulation to the current production ownership that we intend to simplify.
assert.match(coreSource, /Lampa\.Listener\.follow\(['"]app['"][\s\S]*refreshUpdates\(\)/,
  'Current core app-ready refresh must exist for the baseline simulation');
assert.match(badgeSource, /function\s+start\s*\(\)[\s\S]*refresh\(\)[\s\S]*setInterval\(refresh,\s*60\s*\*\s*1000\)/,
  'Badge must own startup refresh and one-minute polling');
assert.match(badgeSource, /Lampa\.Listener\.follow\(['"]app['"][\s\S]*render\(\)[\s\S]*refresh\(\)/,
  'Current Badge app-ready network refresh must exist for the baseline simulation');
assert.match(badgeSource, /visibilitychange[\s\S]*if\s*\(!document\.hidden\)\s*refresh\(\)/,
  'Badge foreground refresh must remain available');
assert.match(badgeSource, /profile_id/,
  'Badge polling must remain profile-aware');
assert.match(watchSource, /FALLBACK_SYNC_INTERVAL\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
  'Current five-minute Watch fallback must exist for the baseline simulation');
assert.match(watchSource, /scheduleSync\(3000,\s*false\)/,
  'Current Watch startup sync must exist for the baseline simulation');
assert.match(watchSource, /event\.type\s*===\s*['"]ready['"]\)\s*scheduleSync\(2200,\s*false\)/,
  'Current Watch app-ready sync must exist for the baseline simulation');
assert.match(watchSource, /setInterval\(syncAll,\s*FALLBACK_SYNC_INTERVAL\)/,
  'Current Watch five-minute polling must exist for the baseline simulation');
assert.match(controllerSource, /Updates\([\s\S]*?SyncTimeCodeProgress\(uid\)/,
  'Server /updates must reconcile TimeCode; otherwise removing periodic /progress would be unsafe');

function jqueryStub() {
  const api = {
    length: 0,
    first() { return this; },
    find() { return this; },
    children() { return this; },
    each() { return this; },
    append() { return this; },
    after() { return this; },
    off() { return this; },
    on() { return this; },
    text() { return this; },
    show() { return this; },
    hide() { return this; },
    attr() { return this; },
    addClass() { return this; },
    removeClass() { return this; }
  };
  return api;
}

function createTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  function add(fn, delay, interval) {
    const id = nextId++;
    const ms = Math.max(0, Number(delay) || 0);
    tasks.set(id, { id, fn, due: now + ms, interval: interval ? ms : 0 });
    return id;
  }

  function clear(id) {
    tasks.delete(id);
  }

  async function settle() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  async function advance(ms) {
    const target = now + Math.max(0, Number(ms) || 0);

    while (true) {
      let next = null;
      for (const task of tasks.values()) {
        if (task.due > target) continue;
        if (!next || task.due < next.due || (task.due === next.due && task.id < next.id)) next = task;
      }
      if (!next) break;

      now = next.due;
      if (!tasks.has(next.id)) continue;
      if (next.interval > 0) next.due += next.interval;
      else tasks.delete(next.id);

      next.fn();
      await settle();
    }

    now = target;
    await settle();
  }

  return {
    setTimeout: (fn, delay) => add(fn, delay, false),
    clearTimeout: clear,
    setInterval: (fn, delay) => add(fn, delay, true),
    clearInterval: clear,
    advance,
    settle,
    now: () => now
  };
}

function createCurrentRuntime() {
  const timers = createTimers();
  const appListeners = [];
  const timelineListeners = [];
  const documentListeners = new Map();
  const storage = {
    lampac_unic_id: 'ci-user',
    lampac_profile_id: '7',
    translationsub_sources: []
  };
  const network = { calls: [] };

  function response(data) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(data))
    });
  }

  const sandbox = {
    console,
    Promise,
    Date,
    Math,
    URL,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    LampacHost: 'http://lampac.test',
    location: { origin: 'http://lampac.test', href: 'http://lampac.test/' },
    localStorage: {
      getItem(name) {
        return Object.prototype.hasOwnProperty.call(storage, name) ? String(storage[name]) : null;
      },
      setItem(name, value) { storage[name] = value; }
    },
    document: {
      hidden: false,
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
      body: {},
      getElementById() { return null; },
      getElementsByTagName() { return []; },
      createElement() { return {}; },
      addEventListener(name, callback) {
        if (!documentListeners.has(name)) documentListeners.set(name, []);
        documentListeners.get(name).push(callback);
      }
    },
    $: jqueryStub,
    fetch(url) {
      const value = String(url);
      network.calls.push(value);
      if (value.includes('/translationsub/updates?')) return response([]);
      if (value.includes('/translationsub/progress?')) return response({ success: true, synced: 0 });
      if (value.includes('/translationsub/user-settings?')) return response({ Sources: [], sources: [] });
      return response({});
    }
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.Lampa = {
    Manifest: {},
    Storage: {
      get(name, fallback) {
        return Object.prototype.hasOwnProperty.call(storage, name) ? storage[name] : fallback;
      },
      set(name, value) { storage[name] = value; }
    },
    Utils: { uid: () => 'ci-generated' },
    Listener: {
      follow(name, callback) {
        if (name === 'app') appListeners.push(callback);
      }
    },
    Timeline: {
      listener: {
        follow(name, callback) {
          if (name === 'update') timelineListeners.push(callback);
        }
      }
    }
  };

  const context = vm.createContext(sandbox);
  // Match PluginController order for the three owners involved in background refreshes.
  vm.runInContext(coreSource, context, { filename: 'translationsub.js' });
  vm.runInContext(watchSource, context, { filename: 'translationsub-watch.js' });
  vm.runInContext(badgeSource, context, { filename: 'translationsub-badge-state.js' });

  function count(route) {
    return network.calls.filter((url) => new URL(url).pathname === route).length;
  }

  function emitAppReady() {
    appListeners.slice().forEach((callback) => callback({ type: 'ready' }));
  }

  function emitTimelineUpdate() {
    timelineListeners.slice().forEach((callback) => callback({ type: 'update' }));
  }

  function emitVisible() {
    sandbox.document.hidden = false;
    for (const callback of documentListeners.get('visibilitychange') || []) callback();
  }

  function resetNetwork() {
    network.calls.length = 0;
  }

  return { timers, network, count, emitAppReady, emitTimelineUpdate, emitVisible, resetNetwork };
}

// Baseline: execute the current production files and prove the duplication actually exists.
{
  const rt = createCurrentRuntime();
  await rt.timers.settle();

  assert.equal(rt.count('/translationsub/updates'), 1,
    'Badge startup should perform exactly one immediate /updates before app-ready');
  assert.equal(rt.count('/translationsub/progress'), 0);

  rt.emitAppReady();
  await rt.timers.settle();
  assert.equal(rt.count('/translationsub/updates'), 3,
    'Current app-ready should add two duplicate /updates requests (core + Badge)');

  await rt.timers.advance(2200);
  assert.equal(rt.count('/translationsub/progress'), 1,
    'Current Watch app-ready schedule should add one /progress');
  assert.equal(rt.count('/translationsub/updates'), 4,
    'Current Watch app-ready sync should add a fourth startup /updates');

  console.log('CURRENT startup: 1 progress + 4 updates after app-ready/watch startup');

  rt.resetNetwork();
  await rt.timers.advance(300000 - rt.timers.now());

  assert.equal(rt.count('/translationsub/progress'), 1,
    'Current five-minute Watch fallback should issue one /progress');
  assert.equal(rt.count('/translationsub/updates'), 6,
    'Current five-minute window should contain five Badge polls plus one Watch-triggered /updates');

  console.log('CURRENT five-minute window: 1 progress + 6 updates (5 Badge polls + 1 Watch duplicate)');
}

function createTargetModel() {
  const timers = createTimers();
  const network = { progress: 0, updates: 0 };
  let debounceTimer = null;
  let retryTimer = null;

  function badgeRefresh() {
    network.updates++;
  }

  function watchSync() {
    network.progress++;
    // /progress reconciliation is followed by one visible-state refresh.
    badgeRefresh();
  }

  function scheduleTimelineSync() {
    timers.clearTimeout(debounceTimer);
    debounceTimer = timers.setTimeout(watchSync, 1400);
    timers.clearTimeout(retryTimer);
    retryTimer = timers.setTimeout(watchSync, 4200);
  }

  // Target ownership: Badge alone owns passive/background polling.
  badgeRefresh();
  timers.setInterval(badgeRefresh, 60 * 1000);

  return {
    timers,
    network,
    appReady() {
      // Core injects UI/settings; Badge only renders; Watch does not schedule network work.
    },
    visible() { badgeRefresh(); },
    timelineUpdate: scheduleTimelineSync,
    reset() { network.progress = 0; network.updates = 0; }
  };
}

// Target startup: one passive /updates and no startup /progress.
{
  const target = createTargetModel();
  target.appReady();
  await target.timers.advance(2200);

  assert.equal(target.network.progress, 0);
  assert.equal(target.network.updates, 1);
  console.log('TARGET startup: 0 progress + 1 updates');
}

// Target idle polling: only Badge owns the five one-minute polls in five minutes.
{
  const target = createTargetModel();
  target.reset();
  await target.timers.advance(300000);

  assert.equal(target.network.progress, 0);
  assert.equal(target.network.updates, 5);
  console.log('TARGET five-minute window: 0 progress + 5 updates, no Watch polling duplicate');
}

// Foreground refresh remains one immediate Badge request.
{
  const target = createTargetModel();
  target.reset();
  target.visible();

  assert.equal(target.network.progress, 0);
  assert.equal(target.network.updates, 1);
  console.log('TARGET visibility return: exactly 1 updates request');
}

// Timeline-driven reconciliation remains intact, including the delayed retry that protects
// against TimeCode SQLite commit races. This is event-driven behavior, not background polling.
{
  const target = createTargetModel();
  target.reset();
  target.timelineUpdate();
  await target.timers.advance(1400);

  assert.equal(target.network.progress, 1);
  assert.equal(target.network.updates, 1);

  await target.timers.advance(2800);
  assert.equal(target.network.progress, 2);
  assert.equal(target.network.updates, 2);
  console.log('TARGET Timeline update: progress+updates preserved, including delayed retry');
}

console.log('TranslationSub background-refresh ownership simulation passed.');
