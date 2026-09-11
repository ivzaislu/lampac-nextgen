import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const moduleDir = path.join(root, 'Modules', 'TranslationSub');
const controllerPath = path.join(moduleDir, 'PluginController.cs');
const fail = [];

function error(message) {
  fail.push(message);
  console.error(`::error::${message}`);
}

function read(name) {
  return fs.readFileSync(path.join(moduleDir, name), 'utf8');
}

const controller = fs.readFileSync(controllerPath, 'utf8');
const appended = [...controller.matchAll(/AppendScript\s*\(\s*ref\s+script\s*,\s*"([^"]+\.js)"\s*\)/g)]
  .map((match) => match[1]);
const loaded = ['translationsub.js', ...appended];
const loadedSet = new Set(loaded);
const jsFiles = fs.readdirSync(moduleDir)
  .filter((name) => /^translationsub(?:-[a-z0-9-]+)?\.js$/i.test(name))
  .sort();

if (loaded.length !== loadedSet.size) error('PluginController contains duplicate TranslationSub JS includes');
for (const name of loaded) {
  if (!jsFiles.includes(name)) error(`PluginController references missing JS file: ${name}`);
}
for (const name of jsFiles) {
  if (!loadedSet.has(name)) error(`Orphan TranslationSub JS file is not loaded: ${name}`);
}
if (jsFiles.includes('translationsub-watch.js')) error('Obsolete client progress watcher returned');
if (controller.includes('translationsub-watch.js')) error('PluginController still ships obsolete progress watcher');

const guards = new Map();
let observerCount = 0;
let componentRegistrationCount = 0;
let globalSelectOverrides = 0;
let bundle = '';

for (const name of loaded) {
  const code = read(name);
  bundle += `\n;\n/* ${name} */\n${code}`;

  try { new vm.Script(code, { filename: name }); }
  catch (err) { error(`${name}: JavaScript syntax error: ${err.message}`); }

  if (!/["']use strict["']/.test(code)) error(`${name}: missing 'use strict'`);
  const guardMatch = code.match(/window\.(__TranslationSub[A-Za-z0-9_]+Started)\b/);
  if (!guardMatch) error(`${name}: no TranslationSub startup guard found`);
  else if (guards.has(guardMatch[1])) error(`Duplicate startup guard ${guardMatch[1]}`);
  else guards.set(guardMatch[1], name);

  observerCount += (code.match(/new\s+MutationObserver\s*\(/g) || []).length;
  componentRegistrationCount += (code.match(/Lampa\.Component\.add\s*\(\s*["']translationsub_list["']/g) || []).length;
  globalSelectOverrides += (code.match(/Lampa\.Select\.show\s*=/g) || []).length;

  if (code.includes('{time}')) error(`${name}: unresolved {time} template placeholder`);
  if (/function\s+schedulePolling\s*\(/.test(code)) error(`${name}: legacy polling owner returned`);
  if (/function\s+checkIntervalMinutes\s*\(/.test(code)) error(`${name}: client polling policy returned`);
  if (/\/translationsub\/(?:list|updates|progress|variants|add|remove|check)\b/.test(code))
    error(`${name}: direct legacy TranslationSub API call found`);
  if (/\/transsubscribe\//.test(code)) error(`${name}: legacy transsubscribe alias call found`);
}

try { new vm.Script(bundle, { filename: 'translationsub.bundle.js' }); }
catch (err) { error(`Combined TranslationSub bundle syntax error: ${err.message}`); }

if (observerCount !== 1) error(`Expected exactly one global MutationObserver, found ${observerCount}`);
if (componentRegistrationCount !== 1) error(`translationsub_list must be registered exactly once, found ${componentRegistrationCount}`);
if (globalSelectOverrides !== 0) error(`Global Lampa.Select.show override found ${globalSelectOverrides} time(s)`);

const api = read('translationsub-api.js');
for (const route of [
  '/translationsub/v2/snapshot',
  '/translationsub/v2/content-state',
  '/translationsub/v2/subscriptions',
  '/translationsub/v2/check',
  '/translationsub/v2/settings'
]) {
  if (!api.includes(route)) error(`Shared API client is missing ${route}`);
}
if (/request\(['"](?:PUT|DELETE)['"]/.test(api))
  error('Thin API client uses unsupported dynamic-module mutation verbs');
if (!api.includes("'/translationsub/v2/subscriptions/' + id + '/remove'"))
  error('Thin API client is missing canonical POST unsubscribe command route');

const core = read('translationsub.js');
for (const symbol of ['injectFullButton', 'registerComponent', 'SubscriptionComponent', 'schedulePolling', 'addSettings', 'checkIntervalMinutes']) {
  if (core.includes(symbol)) error(`translationsub.js still contains obsolete owner: ${symbol}`);
}
if (!core.includes('api.check(') || !core.includes('applySnapshot'))
  error('Core manual check must consume the snapshot returned by v2/check');

const page = read('translationsub-page.js');
if (!page.includes('snapshot.subscriptions')) error('Subscriptions page must render backend snapshot data');
if (!page.includes('result.snapshot')) error('Subscriptions page must consume manual-check snapshot without refetch');
if (!page.includes('item.display')) error('Subscriptions page must render backend display projection');
if (/api\.check\([\s\S]{0,900}?\bload\s*\(/.test(page))
  error('Subscriptions page refetches immediately after v2/check');
for (const domainField of ['item.watchedEpisode', 'item.availableEpisode', 'item.fromEpisode', 'item.toEpisode']) {
  if (page.includes(domainField)) error(`Subscriptions page reconstructs domain display from ${domainField}`);
}
if (/function\s+sourceLabels\s*\(/.test(page))
  error('Subscriptions page must not aggregate source labels client-side');

const settings = read('translationsub-settings-v2.js');
if (!settings.includes('api.updateSettings')) error('Settings UI must persist through backend API');
if (!settings.includes('api.settings')) error('Settings UI must load canonical backend settings');
if (!settings.includes('viewBox="0 0 37 37"')) error('Settings bell SVG lost its native-like proportions');

const navigation = read('translationsub-navigation.js');
if (!navigation.includes('new MutationObserver')) error('Navigation DOM repair observer is missing');
if (/Lampa\.Select\.show\s*=/.test(navigation)) error('Navigation must not monkey-patch global Lampa.Select');

const notice = read('translationsub-notice.js');
if (/new\s+MutationObserver/.test(notice)) error('Notice drawer must not own a global MutationObserver');
if (/setInterval\s*\(\s*refresh/.test(notice)) error('Notice drawer must not poll in background');
if (!notice.includes('item.display')) error('Notice drawer must render backend display projection');
for (const domainField of ['item.season', 'item.watchedEpisode', 'item.fromEpisode', 'item.toEpisode', 'item.newCount']) {
  if (notice.includes(domainField)) error(`Notice drawer reconstructs notification semantics from ${domainField}`);
}
if (/function\s+sourceLabels\s*\(/.test(notice)) error('Notice drawer must not aggregate sources client-side');
if (/item\s*&&\s*\(item\.tmdbId\s*\|\|\s*item\.contentId\)/.test(notice))
  error('Notice drawer must use backend navigation target, not content-id fallbacks');

const badge = read('translationsub-badge-state.js');
if (/new\s+MutationObserver/.test(badge)) error('Badge state must not own a global MutationObserver');
if (/setInterval\s*\(\s*refresh/.test(badge)) error('Badge state must not poll in background');
if (!badge.includes('api.snapshot')) error('Badge state must consume canonical backend snapshot');
if (!badge.includes('applySnapshot')) error('Badge state must accept authoritative command snapshots');

const source = read('translationsub-source.js');
if (!source.includes('hover:long.translationsubSource')) error('Subscriptions page long-press menu is missing');
if (!source.includes('Lampa.Select.show')) error('Subscriptions long-press menu must use Lampa.Select');
if (!source.includes('function restoreContentController')) error('Subscriptions menu must restore Lampa content controller');
if (source.includes('Lampa.Select.close')) error('Subscriptions client must not call Lampa.Select.close()');
if (/function\s+tmdbId\s*\(/.test(source)) error('Subscriptions client must not resolve navigation IDs itself');
if (!source.includes('item.navigation')) error('Subscriptions client must consume backend navigation target');
if (/item\.isSerial\s*!==\s*false/.test(source)) error('Subscriptions client must not derive tv/movie navigation');

const cardFlow = read('translationsub-card-flow.js');
if (!cardFlow.includes('deliberately only a Lampa transport adapter')) error('Card flow thin-client boundary comment is missing');
for (const call of ['client.contentSummary(', 'client.contentState(', 'client.subscribe(', 'client.unsubscribe(']) {
  if (!cardFlow.includes(call)) error(`Card flow is missing backend call ${call}`);
}
for (const domainOwner of [
  'detectSerialCard', 'normalizeVoice', 'sameContent', 'findExisting',
  'latestAiredSeason', 'variantSources', 'ensureExternalIds'
]) {
  if (new RegExp(`function\\s+${domainOwner}\\s*\\(`).test(cardFlow))
    error(`Card flow regained backend domain owner: ${domainOwner}`);
}
if (cardFlow.includes('Lampa.Timeline.watchedEpisode')) error('Card flow must not derive watched state from Lampa Timeline');
if (cardFlow.includes('Lampa.Select.close')) error('Card flow must not call Lampa.Select.close()');

const tmdbUi = read('translationsub-tmdb-ui.js');
if (/ScheduleState|scheduleState/.test(tmdbUi)) error('TMDB UI must not own schedule state machine');
if (!tmdbUi.includes('display.tmdbFacts') || !tmdbUi.includes('display.tmdbNext'))
  error('TMDB UI must render backend TMDB display projection');
for (const leakedDomain of ['targetSeasonEpisodes', 'nextAirDate', 'nextSeason', 'nextEpisode', 'tmdb.status']) {
  if (tmdbUi.includes(leakedDomain)) error(`TMDB UI reconstructs backend state from ${leakedDomain}`);
}
if (/new\s+Date\s*\(/.test(tmdbUi)) error('TMDB UI must not format schedule dates client-side');

console.log(`TranslationSub JS files checked: ${loaded.length}`);
console.log(`Global MutationObserver count: ${observerCount}`);
console.log(`Startup guards: ${guards.size}`);
if (fail.length) {
  console.error(`TranslationSub JS audit failed with ${fail.length} error(s).`);
  process.exit(1);
}
console.log('TranslationSub thin-client JS audit passed.');
