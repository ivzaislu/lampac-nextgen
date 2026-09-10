import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const moduleDir = path.join(root, 'Modules', 'TranslationSub');

function read(name) {
  return fs.readFileSync(path.join(moduleDir, name), 'utf8');
}

const watchSource = read('translationsub-watch.js');
const badgeSource = read('translationsub-badge-state.js');
const modInitSource = read('ModInit.cs');

// Production ownership after backend-first migration:
// - server observes successful /timecode/add and publishes invalidation;
// - BadgeState owns snapshot reads on startup/app-ready/foreground/realtime;
// - Watch is event-driven compatibility only and must not poll in background.
assert.match(modInitSource, /"\/timecode\/add"/,
  'Backend must observe the authoritative TimeCode write path');
assert.match(modInitSource, /Response\.OnCompleted/,
  'TimeCode reconciliation must happen after the request completed');
assert.match(modInitSource, /PublishProfile\(uid, profileId, "timecode"\)/,
  'Backend must publish profile-scoped invalidation after progress changes');

assert.match(badgeSource, /function\s+start\s*\(\)[\s\S]*refresh\(\)/,
  'BadgeState should perform the initial snapshot read');
assert.match(badgeSource, /Lampa\.Listener\.follow\(['"]app['"][\s\S]*render\(\)[\s\S]*refresh\(\)/,
  'BadgeState should refresh once on app-ready');
assert.match(badgeSource, /visibilitychange[\s\S]*if\s*\(!document\.hidden\)\s*refresh\(\)/,
  'Foreground refresh must remain available');
assert.doesNotMatch(badgeSource, /setInterval\(refresh,\s*60\s*\*\s*1000\)/,
  'BadgeState must not poll every minute');

assert.match(watchSource, /Timeline\.listener\.follow\('update'/,
  'Compatibility Timeline reconciliation should remain until writer audit is complete');
assert.match(watchSource, /scheduleSync\(1400,\s*true\)/,
  'Timeline update should retain the delayed reconciliation race guard');
assert.match(watchSource, /setTimeout\(function\s*\(\)[\s\S]*syncAll\(\)[\s\S]*4200/,
  'Timeline compatibility path should retain one delayed retry');
assert.doesNotMatch(watchSource, /FALLBACK_SYNC_INTERVAL/,
  'Watch must not own passive polling');
assert.doesNotMatch(watchSource, /setInterval\(syncAll/,
  'Watch must not own passive polling');
assert.doesNotMatch(watchSource, /scheduleSync\(3000/,
  'Watch must not perform startup reconciliation');
assert.doesNotMatch(watchSource, /event\.type\s*===\s*['"]ready['"]/,
  'Watch must not duplicate app-ready network work');

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
    settle
  };
}

function createRuntime() {
  const timers = createTimers();
  const appListeners = [];
  const timelineListeners = [];
  const documentListeners = new Map();
  const storage = {
    lampac_unic_id: 'ci-user',
    lampac_profile_id: '7'
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
      if (value.includes('/translationsub/v2/snapshot?'))
        return response({ badge: { count: 0 }, subscriptions: [], updates: [] });
      if (value.includes('/translationsub/progress?'))
        return response({ success: true, synced: 0 });
      return response({});
    }
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.Lampa = {
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
  sandbox.TranslationSubApi = {
    snapshot(success) {
      sandbox.fetch('http://lampac.test/translationsub/v2/snapshot?uid=ci-user&profile_id=7')
        .then((r) => r.text()).then((t) => success(JSON.parse(t)));
    }
  };

  const context = vm.createContext(sandbox);
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

  return { timers, count, emitAppReady, emitTimelineUpdate, emitVisible, resetNetwork };
}

// Startup: Badge owns exactly one initial snapshot. Watch stays idle.
{
  const rt = createRuntime();
  await rt.timers.settle();
  assert.equal(rt.count('/translationsub/v2/snapshot'), 1);
  assert.equal(rt.count('/translationsub/progress'), 0);

  rt.emitAppReady();
  await rt.timers.settle();
  assert.equal(rt.count('/translationsub/v2/snapshot'), 2,
    'app-ready should add one Badge snapshot');
  assert.equal(rt.count('/translationsub/progress'), 0,
    'Watch must not reconcile on app-ready');
}

// Idle five-minute window: no passive frontend network work.
{
  const rt = createRuntime();
  await rt.timers.settle();
  rt.resetNetwork();
  await rt.timers.advance(300000);
  assert.equal(rt.count('/translationsub/v2/snapshot'), 0);
  assert.equal(rt.count('/translationsub/progress'), 0);
  console.log('TARGET idle five-minute window: 0 frontend polling requests');
}

// Foreground return: one snapshot only.
{
  const rt = createRuntime();
  await rt.timers.settle();
  rt.resetNetwork();
  rt.emitVisible();
  await rt.timers.settle();
  assert.equal(rt.count('/translationsub/v2/snapshot'), 1);
  assert.equal(rt.count('/translationsub/progress'), 0);
  console.log('TARGET visibility return: exactly 1 snapshot request');
}

// Timeline fallback: one reconciliation + snapshot, then one delayed retry + snapshot.
{
  const rt = createRuntime();
  await rt.timers.settle();
  rt.resetNetwork();
  rt.emitTimelineUpdate();
  await rt.timers.advance(1400);
  assert.equal(rt.count('/translationsub/progress'), 1);
  assert.equal(rt.count('/translationsub/v2/snapshot'), 1);

  await rt.timers.advance(2800);
  assert.equal(rt.count('/translationsub/progress'), 2);
  assert.equal(rt.count('/translationsub/v2/snapshot'), 2);
  console.log('TARGET Timeline compatibility path: progress + snapshot with delayed retry');
}

console.log('TranslationSub background-refresh ownership simulation passed.');
