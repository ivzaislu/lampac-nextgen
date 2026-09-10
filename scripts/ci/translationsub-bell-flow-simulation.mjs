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
const noticeSource = read('translationsub-notice.js');

// Bind the runtime test to the implemented production ownership model.
assert.match(watchSource, /function\s+flushCallbacks\s*\(updates\)[\s\S]*callback\(updates\)/,
  'Watch must pass refreshed updates to sync callbacks');
assert.match(watchSource, /function\s+finish\s*\(\)[\s\S]*refreshVisibleState\(function\s*\(updates\)[\s\S]*complete\(updates,\s*350\)/,
  'Watch success path must refresh Badge once before completing callbacks');
assert.match(watchSource, /function\s+failProgress\s*\(\)[\s\S]*refreshVisibleState\(function\s*\(updates\)/,
  'Watch progress-error path must still perform one Badge refresh');
assert.match(badgeSource, /TranslationSubWatch\.sync\(openWithUpdates\)/,
  'Badge must consume updates returned by Watch.sync');
assert.match(badgeSource, /refresh\(openWithUpdates\)/,
  'Badge no-Watch fallback must perform exactly one refresh');
assert.match(badgeSource, /TranslationSubNotice\.open\(updates\)/,
  'Badge must pass preloaded updates into Notice.open');
assert.doesNotMatch(badgeSource, /refresh\(function\s*\(\)[\s\S]*TranslationSubNotice\.open\(\)/,
  'Legacy Badge refresh-then-Notice-reload flow is still present');
assert.match(noticeSource, /function\s+openDrawer\s*\(preloadedUpdates\)/,
  'Notice.open must accept preloaded updates');
assert.match(noticeSource, /if\s*\(Array\.isArray\(preloadedUpdates\)\)[\s\S]*renderDrawer\(preloadedUpdates\)/,
  'Notice must render preloaded updates without a network reload');
assert.match(noticeSource, /loadUpdates\(renderDrawer\)/,
  'Standalone Notice fallback must retain its own loader');
assert.match(noticeSource, /profile_id/,
  'Standalone Notice fallback must remain profile-aware');
assert.match(badgeSource, /addQuery\(parts,\s*['"]profile_id['"],\s*profileId\(\)\)/,
  'Badge updates request must remain profile-aware');

function jqueryStub(arg) {
  const created = typeof arg === 'string' && arg.trim().startsWith('<');
  const node = created ? {} : undefined;
  const api = {
    length: created ? 1 : 0,
    0: node,
    each(fn) {
      if (this.length && typeof fn === 'function') fn.call(this[0], 0, this[0]);
      return this;
    },
    children() { return jqueryStub(''); },
    first() { return this; },
    append() { return this; },
    text() { return this; },
    show() { return this; },
    hide() { return this; },
    find() { return created ? jqueryStub('<div></div>') : jqueryStub(''); },
    attr(name, value) { return value === undefined ? '' : this; },
    addClass() { return this; },
    empty() { return this; },
    remove() { return this; },
    on() { return this; },
    html() { return this; }
  };
  return api;
}

function createRuntime({ updates = [{ id: 'u1' }] } = {}) {
  const storage = {
    lampac_unic_id: 'ci-user',
    lampac_profile_id: '7',
    translationsub_card_source: 'tmdb'
  };

  const network = {
    calls: [],
    modals: [],
    updates: updates.slice(),
    failProgress: false,
    failUpdates: false
  };

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
    parseInt,
    isNaN,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    location: { origin: 'http://lampac.test' },
    localStorage: {
      getItem(name) {
        return Object.prototype.hasOwnProperty.call(storage, name) ? String(storage[name]) : null;
      },
      setItem(name, value) {
        storage[name] = value;
      }
    },
    document: {
      hidden: false,
      head: { appendChild() {} },
      documentElement: { appendChild() {} },
      getElementById() { return null; },
      createElement() { return {}; },
      addEventListener() {}
    },
    $: jqueryStub,
    fetch(url) {
      const value = String(url);
      network.calls.push(value);
      if (value.includes('/translationsub/progress?')) {
        if (network.failProgress) return Promise.reject(new Error('progress failed'));
        return response({ success: true, count: 1, source: 'lampac-timecode' });
      }
      if (value.includes('/translationsub/updates?')) {
        if (network.failUpdates) return Promise.reject(new Error('updates failed'));
        return response(network.updates.slice());
      }
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
      set(name, value) {
        storage[name] = value;
      }
    },
    Utils: { uid: () => 'ci-generated' },
    Listener: { follow() {} },
    Template: {
      get() { throw new Error('template unavailable in CI stub'); },
      string() { return '<svg></svg>'; }
    },
    Modal: {
      open(config) { network.modals.push(config); },
      close() {}
    },
    Controller: { toggle() {} },
    Activity: { push() {} }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(watchSource, context, { filename: 'translationsub-watch.js' });
  vm.runInContext(noticeSource, context, { filename: 'translationsub-notice.js' });
  vm.runInContext(badgeSource, context, { filename: 'translationsub-badge-state.js' });

  async function settle() {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async function ready() {
    // Badge performs one startup refresh. Let it settle, then remove it from the
    // measurement so each test counts only the user action under test.
    await settle();
    network.calls.length = 0;
    network.modals.length = 0;
  }

  function count(route) {
    return network.calls.filter((url) => new URL(url).pathname === route).length;
  }

  function routeCalls(route) {
    return network.calls.filter((url) => new URL(url).pathname === route);
  }

  return { sandbox, network, ready, settle, count, routeCalls };
}

// 1) Production success path: exactly one TimeCode reconciliation and one updates fetch.
{
  const rt = createRuntime();
  await rt.ready();
  rt.sandbox.TranslationSubBadgeState.open();
  await rt.settle();

  assert.equal(rt.count('/translationsub/progress'), 1);
  assert.equal(rt.count('/translationsub/updates'), 1);
  assert.equal(rt.network.modals.length, 1);
  const updateUrl = new URL(rt.routeCalls('/translationsub/updates')[0]);
  assert.equal(updateUrl.searchParams.get('profile_id'), '7');
  console.log('PRODUCTION success flow: 1 progress + 1 updates, profile preserved');
}

// 2) Empty updates are valid preloaded data; Notice must not reload them.
{
  const rt = createRuntime({ updates: [] });
  await rt.ready();
  rt.sandbox.TranslationSubBadgeState.open();
  await rt.settle();

  assert.equal(rt.count('/translationsub/progress'), 1);
  assert.equal(rt.count('/translationsub/updates'), 1);
  assert.equal(rt.network.modals.length, 1);
  console.log('PRODUCTION empty flow: 1 + 1, no duplicate fetch for []');
}

// 3) Progress failure remains best-effort and still performs only one updates fetch.
{
  const rt = createRuntime();
  await rt.ready();
  rt.network.failProgress = true;
  rt.sandbox.TranslationSubBadgeState.open();
  await rt.settle();

  assert.equal(rt.count('/translationsub/progress'), 1);
  assert.equal(rt.count('/translationsub/updates'), 1);
  assert.equal(rt.network.modals.length, 1);
  console.log('PRODUCTION progress-error flow: still exactly one updates request');
}

// 4) Updates failure uses Badge cache and Notice must not retry the network.
{
  const rt = createRuntime({ updates: [{ id: 'cached' }] });
  await rt.ready();
  rt.network.failUpdates = true;
  rt.sandbox.TranslationSubBadgeState.open();
  await rt.settle();

  assert.equal(rt.count('/translationsub/progress'), 1);
  assert.equal(rt.count('/translationsub/updates'), 1);
  assert.equal(rt.network.modals.length, 1);
  console.log('PRODUCTION updates-error flow: cached data, no Notice retry');
}

// 5) Badge without Watch falls back to one profile-aware updates request.
{
  const rt = createRuntime();
  await rt.ready();
  rt.sandbox.TranslationSubWatch = null;
  rt.sandbox.TranslationSubBadgeState.open();
  await rt.settle();

  assert.equal(rt.count('/translationsub/progress'), 0);
  assert.equal(rt.count('/translationsub/updates'), 1);
  assert.equal(rt.network.modals.length, 1);
  const updateUrl = new URL(rt.routeCalls('/translationsub/updates')[0]);
  assert.equal(updateUrl.searchParams.get('profile_id'), '7');
  console.log('PRODUCTION no-Watch fallback: exactly one profile-aware updates request');
}

// 6) Standalone Notice remains functional and loads once with profile_id.
{
  const rt = createRuntime();
  await rt.ready();
  rt.sandbox.TranslationSubNotice.open();
  await rt.settle();

  assert.equal(rt.count('/translationsub/progress'), 0);
  assert.equal(rt.count('/translationsub/updates'), 1);
  assert.equal(rt.network.modals.length, 1);
  const updateUrl = new URL(rt.routeCalls('/translationsub/updates')[0]);
  assert.equal(updateUrl.searchParams.get('profile_id'), '7');
  console.log('PRODUCTION standalone Notice fallback: one profile-aware updates request');
}

console.log('TranslationSub production bell-flow runtime simulation passed.');
