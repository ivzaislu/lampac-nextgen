import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const moduleDir = path.join(root, 'Modules', 'TranslationSub');

function read(name) {
  return fs.readFileSync(path.join(moduleDir, name), 'utf8');
}

const watchSource = read('translationsub-watch.js');
const badgeSource = read('translationsub-badge-state.js');
const noticeSource = read('translationsub-notice.js');

// Anchor the simulation to the current production control flow. If production
// changes before the implementation phase, this test must be reviewed instead
// of silently simulating an obsolete design.
assert.match(watchSource, /function\s+finish\s*\(\)[\s\S]*refreshVisibleState\(\);[\s\S]*flushCallbacks\(\);/,
  'Current Watch flow changed: expected refreshVisibleState() before callbacks');
assert.match(badgeSource, /function\s+openDrawerSynced\s*\(\)[\s\S]*refresh\(function\s*\(\)[\s\S]*TranslationSubNotice\.open\(\)/,
  'Current Badge flow changed: expected explicit refresh before Notice.open()');
assert.match(noticeSource, /function\s+openDrawer\s*\(\)[\s\S]*loadUpdates\(function\s*\(updates\)/,
  'Current Notice flow changed: expected unconditional loadUpdates()');
assert.match(badgeSource, /addQuery\(parts,\s*['"]profile_id['"],\s*profileId\(\)\)/,
  'Badge updates request must remain profile-aware');
assert.doesNotMatch(noticeSource, /profile_id/,
  'Notice unexpectedly became profile-aware; update simulation assumptions');

function makeNetwork({ failProgress = false, failUpdates = false, updates = [{ id: 'u1' }] } = {}) {
  const calls = [];
  return {
    calls,
    async progress(profileId) {
      calls.push({ route: '/translationsub/progress', profileId });
      if (failProgress) throw new Error('progress failed');
      return { success: true };
    },
    async updates(profileId) {
      calls.push({ route: '/translationsub/updates', profileId });
      if (failUpdates) throw new Error('updates failed');
      return updates.slice();
    }
  };
}

function count(net, route) {
  return net.calls.filter((call) => call.route === route).length;
}

// Model the production success path exactly at the ownership level:
// Watch.finish() refreshes Badge, Badge.open() refreshes again, then Notice.open()
// loads again. The first refresh can overlap the second, but it is still a request.
async function simulateCurrentBellSuccess(profileId) {
  const net = makeNetwork();
  await net.progress(profileId);
  await Promise.all([
    net.updates(profileId), // Watch.finish() -> refreshVisibleState()
    (async () => {
      await net.updates(profileId); // Badge.open() -> refresh(...)
      await net.updates(null);      // Notice.open() -> loadUpdates(), no profile_id today
    })()
  ]);
  return net;
}

// Target design primitives. These are CI-only models; production JS is not changed.
async function targetBadgeRefresh(net, profileId, cachedUpdates) {
  try {
    return await net.updates(profileId);
  } catch {
    return cachedUpdates.slice();
  }
}

async function targetNoticeOpen(net, profileId, preloadedUpdates) {
  if (Array.isArray(preloadedUpdates)) {
    return { updates: preloadedUpdates.slice(), networkLoad: false };
  }

  try {
    return { updates: await net.updates(profileId), networkLoad: true };
  } catch {
    return { updates: [], networkLoad: true };
  }
}

async function targetWatchSync(net, profileId, cachedUpdates) {
  try {
    await net.progress(profileId);
  } catch {
    // Progress reconciliation remains best effort. We still perform one Badge refresh
    // so the drawer can open with the freshest server state available.
  }
  return targetBadgeRefresh(net, profileId, cachedUpdates);
}

async function simulateTargetBell({ failProgress = false, failUpdates = false, cachedUpdates = [] } = {}) {
  const profileId = '7';
  const net = makeNetwork({ failProgress, failUpdates });
  const updates = await targetWatchSync(net, profileId, cachedUpdates);
  const notice = await targetNoticeOpen(net, profileId, updates);
  return { net, notice, profileId };
}

// 1) Prove the problem exists in the current ownership model.
{
  const net = await simulateCurrentBellSuccess('7');
  assert.equal(count(net, '/translationsub/progress'), 1);
  assert.equal(count(net, '/translationsub/updates'), 3);
  const updateCalls = net.calls.filter((call) => call.route === '/translationsub/updates');
  assert.equal(updateCalls.filter((call) => call.profileId === '7').length, 2);
  assert.equal(updateCalls.filter((call) => call.profileId === null).length, 1);
  console.log('CURRENT success flow: 1 progress + 3 updates (confirmed by simulation)');
}

// 2) Target success path must be exactly 1 + 1, with no Notice network reload.
{
  const { net, notice, profileId } = await simulateTargetBell();
  assert.equal(count(net, '/translationsub/progress'), 1);
  assert.equal(count(net, '/translationsub/updates'), 1);
  assert.equal(notice.networkLoad, false);
  assert.deepEqual(notice.updates, [{ id: 'u1' }]);
  const updateCall = net.calls.find((call) => call.route === '/translationsub/updates');
  assert.equal(updateCall.profileId, profileId);
  console.log('TARGET success flow: 1 progress + 1 updates, profile preserved');
}

// 3) Empty preloaded data is valid data and must not trigger Notice fallback fetch.
{
  const net = makeNetwork({ updates: [] });
  const profileId = '7';
  const updates = await targetWatchSync(net, profileId, []);
  const notice = await targetNoticeOpen(net, profileId, updates);
  assert.equal(count(net, '/translationsub/progress'), 1);
  assert.equal(count(net, '/translationsub/updates'), 1);
  assert.equal(notice.networkLoad, false);
  assert.deepEqual(notice.updates, []);
  console.log('TARGET empty flow: no duplicate fetch for []');
}

// 4) /progress failure must not cause a second /updates retry.
{
  const { net, notice } = await simulateTargetBell({ failProgress: true });
  assert.equal(count(net, '/translationsub/progress'), 1);
  assert.equal(count(net, '/translationsub/updates'), 1);
  assert.equal(notice.networkLoad, false);
  console.log('TARGET progress-error flow: still exactly one updates request');
}

// 5) /updates failure must use Badge cache and must not make Notice retry the network.
{
  const cached = [{ id: 'cached' }];
  const { net, notice } = await simulateTargetBell({ failUpdates: true, cachedUpdates: cached });
  assert.equal(count(net, '/translationsub/progress'), 1);
  assert.equal(count(net, '/translationsub/updates'), 1);
  assert.equal(notice.networkLoad, false);
  assert.deepEqual(notice.updates, cached);
  console.log('TARGET updates-error flow: cached data, no network retry');
}

// 6) Badge fallback without Watch: one updates request, then preloaded Notice render.
{
  const net = makeNetwork();
  const profileId = '7';
  const updates = await targetBadgeRefresh(net, profileId, []);
  const notice = await targetNoticeOpen(net, profileId, updates);
  assert.equal(count(net, '/translationsub/progress'), 0);
  assert.equal(count(net, '/translationsub/updates'), 1);
  assert.equal(notice.networkLoad, false);
  console.log('TARGET no-Watch fallback: exactly one updates request');
}

// 7) Standalone Notice remains functional and its fallback becomes profile-aware.
{
  const net = makeNetwork();
  const profileId = '7';
  const notice = await targetNoticeOpen(net, profileId, undefined);
  assert.equal(count(net, '/translationsub/progress'), 0);
  assert.equal(count(net, '/translationsub/updates'), 1);
  assert.equal(notice.networkLoad, true);
  const updateCall = net.calls.find((call) => call.route === '/translationsub/updates');
  assert.equal(updateCall.profileId, profileId);
  console.log('TARGET standalone Notice fallback: one profile-aware updates request');
}

console.log('TranslationSub bell-flow design simulation passed.');
