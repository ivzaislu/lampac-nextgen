import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const moduleDir = path.join(root, 'Modules', 'TranslationSub');
const controllerPath = path.join(moduleDir, 'PluginController.cs');
const fail = [];
const warn = [];

function error(message) {
  fail.push(message);
  console.error(`::error::${message}`);
}

function warning(message) {
  warn.push(message);
  console.warn(`::warning::${message}`);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

if (!fs.existsSync(moduleDir)) error('Modules/TranslationSub directory is missing');
if (!fs.existsSync(controllerPath)) error('TranslationSub PluginController.cs is missing');

const controller = read(controllerPath);
const appended = [...controller.matchAll(/AppendScript\s*\(\s*ref\s+script\s*,\s*"([^"]+\.js)"\s*\)/g)].map((match) => match[1]);
const loaded = ['translationsub.js', ...appended];
const loadedSet = new Set(loaded);
const jsFiles = fs.readdirSync(moduleDir)
  .filter((name) => /^translationsub(?:-[a-z0-9-]+)?\.js$/i.test(name))
  .sort();

if (loaded.length !== loadedSet.size) {
  const seen = new Set();
  const duplicates = loaded.filter((name) => {
    if (seen.has(name)) return true;
    seen.add(name);
    return false;
  });
  error(`Duplicate JS includes in PluginController: ${[...new Set(duplicates)].join(', ')}`);
}

for (const name of loaded) {
  if (!jsFiles.includes(name)) error(`PluginController references missing JS file: ${name}`);
}
for (const name of jsFiles) {
  if (!loadedSet.has(name)) error(`Orphan TranslationSub JS file is not loaded: ${name}`);
}
if (jsFiles.includes('translationsub-card.js')) error('Obsolete translationsub-card.js returned to the module');
if (jsFiles.includes('translationsub-card-actions.js')) error('Obsolete subscription-card action layer returned to the module');

const guards = new Map();
let observerCount = 0;
let componentRegistrationCount = 0;
let globalSelectOverrides = 0;
let bundle = '';

for (const name of loaded) {
  const file = path.join(moduleDir, name);
  if (!fs.existsSync(file)) continue;
  const code = read(file);
  bundle += `\n;\n/* ${name} */\n${code}`;

  try {
    new vm.Script(code, { filename: name });
  } catch (err) {
    error(`${name}: JavaScript syntax error: ${err.message}`);
  }

  if (!/["']use strict["']/.test(code)) error(`${name}: missing 'use strict'`);

  const guardMatch = code.match(/window\.(__TranslationSub[A-Za-z0-9_]+Started)\b/);
  if (!guardMatch) {
    error(`${name}: no TranslationSub startup guard found`);
  } else {
    const guard = guardMatch[1];
    if (guards.has(guard)) error(`Duplicate startup guard ${guard}: ${guards.get(guard)} and ${name}`);
    else guards.set(guard, name);
  }

  observerCount += (code.match(/new\s+MutationObserver\s*\(/g) || []).length;
  componentRegistrationCount += (code.match(/Lampa\.Component\.add\s*\(\s*["']translationsub_list["']/g) || []).length;
  globalSelectOverrides += (code.match(/Lampa\.Select\.show\s*=/g) || []).length;

  if (code.includes('{time}')) error(`${name}: unresolved {time} template placeholder`);
  if (/function\s+schedulePolling\s*\(/.test(code)) error(`${name}: legacy force-polling owner is present`);
  if (/function\s+checkIntervalMinutes\s*\(/.test(code)) error(`${name}: legacy minute polling policy is present`);
  if (/force\s*:\s*["']true["']/.test(code)) warning(`${name}: force=true request flag found; verify it is manual-only`);
}

try {
  new vm.Script(bundle, { filename: 'translationsub.bundle.js' });
} catch (err) {
  error(`Combined TranslationSub bundle syntax error: ${err.message}`);
}

if (observerCount !== 1) error(`Expected exactly one global MutationObserver, found ${observerCount}`);
if (componentRegistrationCount !== 1) error(`translationsub_list must be registered exactly once, found ${componentRegistrationCount}`);
if (globalSelectOverrides !== 0) error(`Global Lampa.Select.show override found ${globalSelectOverrides} time(s)`);

const api = read(path.join(moduleDir, 'translationsub-api.js'));
for (const route of [
  '/translationsub/v2/snapshot',
  '/translationsub/v2/content-state',
  '/translationsub/v2/subscriptions',
  '/translationsub/v2/check',
  '/translationsub/v2/settings'
]) {
  if (!api.includes(route)) error(`Shared API client is missing ${route}`);
}
for (const legacyRoute of [
  '/translationsub/list',
  '/translationsub/updates',
  '/translationsub/variants',
  '/translationsub/add',
  '/translationsub/remove',
  '/translationsub/check'
]) {
  if (api.includes(legacyRoute)) error(`Shared API client still references legacy route ${legacyRoute}`);
}

const core = read(path.join(moduleDir, 'translationsub.js'));
for (const symbol of ['injectFullButton', 'registerComponent', 'SubscriptionComponent', 'schedulePolling', 'addSettings', 'checkIntervalMinutes']) {
  if (core.includes(symbol)) error(`translationsub.js still contains obsolete owner: ${symbol}`);
}
if (/\.on\(\s*["']hover:enter["']\s*,\s*openSubscriptionsPage/.test(core))
  error('Core header bell still bypasses BadgeState/notice flow');
if (!core.includes('api.check(')) error('Core manual refresh must go through shared v2 API client');
if (!core.includes('applySnapshot')) error('Core manual refresh must consume server-returned snapshot');

const page = read(path.join(moduleDir, 'translationsub-page.js'));
if (!page.includes('__TranslationSubPageStarted')) error('Subscriptions page startup guard is missing');
if (!page.includes('snapshot.subscriptions')) error('Subscriptions page must render the backend snapshot');
if (/setTimeout\s*\([^)]*load[^)]*,\s*1[0-9]{3}\s*\)/s.test(page)) error('Subscriptions page contains delayed duplicate load');
if (/\/translationsub\/(?:list|updates|variants|add|remove)\b/.test(page)) error('Subscriptions page directly calls legacy TranslationSub API');

const settings = read(path.join(moduleDir, 'translationsub-settings-v2.js'));
if (!settings.includes('viewBox="0 0 37 37"')) error('Settings icon must use native-like 37x37 proportions');
if (!settings.includes('width:2em!important;height:2em!important')) error('Settings icon must use the standard 2em Lampa settings size');
if (!settings.includes('api.updateSettings')) error('Settings UI must persist through the shared backend API client');
if (!settings.includes('api.settings')) error('Settings UI must load canonical server settings');

const navigation = read(path.join(moduleDir, 'translationsub-navigation.js'));
if (!navigation.includes('new MutationObserver')) error('Navigation no longer repairs Lampa head/menu DOM recreation');
if (/Lampa\.Select\.show\s*=/.test(navigation)) error('Navigation must not monkey-patch global Lampa.Select');

const notice = read(path.join(moduleDir, 'translationsub-notice.js'));
if (/new\s+MutationObserver/.test(notice)) error('Notice drawer must not own a global MutationObserver');
if (/refreshTimer\s*=\s*setInterval|setInterval\s*\(\s*refresh\s*,/s.test(notice)) error('Notice drawer owns duplicate periodic refresh polling');
if (/\/translationsub\/(?:list|updates|variants|add|remove)\b/.test(notice)) error('Notice drawer directly calls legacy TranslationSub API');

const badge = read(path.join(moduleDir, 'translationsub-badge-state.js'));
if (/new\s+MutationObserver/.test(badge)) error('Badge state must not own a global MutationObserver');
if (/setInterval\s*\(\s*refresh\s*,/.test(badge)) error('Badge state must not poll in background');
if (!badge.includes('api.snapshot')) error('Badge state must consume the canonical backend snapshot');
if (!badge.includes('applySnapshot')) error('Badge state must accept authoritative snapshots returned by commands');

const ui = read(path.join(moduleDir, 'translationsub-ui.js'));
if (/repeat\(3\s*,/.test(ui)) error('Obsolete three-column TV layout returned to translationsub-ui.js');

const source = read(path.join(moduleDir, 'translationsub-source.js'));
if (!source.includes('hover:long.translationsubSource')) error('Subscriptions page long-press context menu is missing');
if (!source.includes('Lampa.Select.show')) error('Subscriptions page long-press menu must use Lampa.Select');
if (!source.includes('function restoreContentController')) error('Subscriptions page must restore the Lampa content controller after Select interaction');
if (source.includes('Lampa.Select.close')) error('Subscriptions page must not call Lampa.Select.close(); it can trigger Android TV WebView/history freezes');
if (/function\s+tmdbId\s*\(/.test(source)) error('Subscriptions client must not resolve TMDB/content IDs itself');
if (!source.includes('item.navigation')) error('Subscriptions client must consume the backend navigation target');
if (/item\.isSerial\s*!==\s*false/.test(source)) error('Subscriptions client must not decide tv/movie navigation from isSerial');

const cardFlow = read(path.join(moduleDir, 'translationsub-card-flow.js'));
if (!cardFlow.includes('deliberately only a Lampa transport adapter')) error('Card flow must document its thin transport boundary');
if (!cardFlow.includes('client.contentSummary(')) error('Card button eligibility must come from backend content summary');
if (!cardFlow.includes('client.contentState(')) error('Voice state must come from backend content-state');
if (!cardFlow.includes('client.subscribe(')) error('Subscribe action must use backend command');
if (!cardFlow.includes('client.unsubscribe(')) error('Unsubscribe action must use backend command');
for (const domainOwner of [
  'function detectSerialCard',
  'function normalizeVoice',
  'function sameContent',
  'function findExisting',
  'function latestAiredSeason',
  'function variantSources',
  'function ensureExternalIds'
]) {
  if (cardFlow.includes(domainOwner)) error(`Card flow regained backend domain owner: ${domainOwner}`);
}
if (!cardFlow.includes('function restoreContentController')) error('Card flow must restore the Lampa content controller after Select interaction');
if (cardFlow.includes('Lampa.Select.close')) error('Card flow must not call Lampa.Select.close(); it can trigger Android TV history/WebView regressions');
if (cardFlow.includes('Lampa.Timeline.watchedEpisode')) error('Card flow must not derive watched state from Lampa Timeline');

const tmdbUi = read(path.join(moduleDir, 'translationsub-tmdb-ui.js'));
if (/ScheduleState|scheduleState/.test(tmdbUi)) error('TMDB UI must not own the schedule state machine');

const watch = read(path.join(moduleDir, 'translationsub-watch.js'));
if (/FALLBACK_SYNC_INTERVAL|setInterval\s*\(\s*syncAll/.test(watch)) error('Watch compatibility layer must not poll in background');
if (/event\.type\s*===\s*["']ready["']/.test(watch)) error('Watch compatibility layer must not duplicate app-ready sync');
if (!/Timeline\.listener\.follow\(['"]update['"]/.test(watch)) warning('Timeline compatibility reconciliation has been removed; confirm backend writer audit is complete');

console.log(`TranslationSub JS files checked: ${loaded.length}`);
console.log(`Global MutationObserver count: ${observerCount}`);
console.log(`Startup guards: ${guards.size}`);
console.log(`Warnings: ${warn.length}`);

if (fail.length) {
  console.error(`TranslationSub JS audit failed with ${fail.length} error(s).`);
  process.exit(1);
}

console.log('TranslationSub backend-first JS audit passed.');
