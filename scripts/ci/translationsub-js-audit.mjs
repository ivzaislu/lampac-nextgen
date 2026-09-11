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
for (const obsoleteFile of [
  'translationsub-watch.js',
  'translationsub-tmdb-ui.js',
  'translationsub-polish.js',
  'translationsub-layout-v3.js',
  'translationsub-mobile.js'
]) {
  if (jsFiles.includes(obsoleteFile)) error(`Obsolete frontend patch returned: ${obsoleteFile}`);
  if (controller.includes(obsoleteFile)) error(`PluginController ships obsolete frontend patch: ${obsoleteFile}`);
}

const expectedOrder = [
  'translationsub-api.js',
  'translationsub-ui.js',
  'translationsub-badge-state.js',
  'translationsub-bell-theme.js',
  'translationsub-source.js',
  'translationsub-page.js',
  'translationsub-notice.js',
  'translationsub-settings-v2.js',
  'translationsub-card-flow.js',
  'translationsub-realtime.js',
  'translationsub-navigation.js'
];
let previousIndex = -1;
for (const name of expectedOrder) {
  const index = appended.indexOf(name);
  if (index < 0) error(`PluginController is missing ${name}`);
  if (index <= previousIndex) error(`PluginController dependency order is wrong around ${name}`);
  previousIndex = index;
}

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
if (/\b(?:enabledSources|refreshSources|TranslationSubPageRefresh|checkUpdates|forceCheckUpdatesUI)\b/.test(bundle))
  error('Obsolete client compatibility hook returned');
if (/TranslationSub\.refresh\b/.test(bundle))
  error('Obsolete cross-layer TranslationSub.refresh facade returned');
if (/translationsub-(?:layout-v3|mobile-button|polish|tmdb-ui)-style/.test(bundle))
  error('Removed presentation patch style owner returned');

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
for (const symbol of [
  'injectFullButton', 'registerComponent', 'SubscriptionComponent', 'schedulePolling',
  'addSettings', 'checkIntervalMinutes', 'refreshUpdates', 'forceCheckUpdatesUI',
  'applySnapshot', 'injectStyles', 'injectHeadButton', 'bellSvg', 'bindLampa'
]) {
  if (core.includes(symbol)) error(`translationsub.js still contains obsolete owner: ${symbol}`);
}
if (/api\.check|TranslationSubApi\.check/.test(core))
  error('Core must not own manual subscription checks');
if (/translationsub-head|translationsub-menu-item|MutationObserver|Lampa\.Listener\.follow/.test(core))
  error('Core must not own TranslationSub DOM or lifecycle presentation');
if (/\brefresh\s*:\s*refresh\b|function\s+refresh\s*\(/.test(core))
  error('Core must not expose a cross-layer refresh facade');
for (const required of ['registerManifest', 'lampacUid', 'openSubscriptionsPage']) {
  if (!core.includes(required)) error(`Core bootstrap facade is missing ${required}`);
}

const ui = read('translationsub-ui.js');
if (!ui.includes('translationsub-layout--mobile') || !ui.includes('translationsub-layout--tv'))
  error('Unified UI must own mobile/TV page layout');
if (!ui.includes('translationsub-full-button--mobile'))
  error('Unified UI must own mobile full-button presentation');
if (!/Lampa\.Listener\.follow\(['"]full['"]/.test(ui))
  error('Unified UI must refresh presentation on Lampa full-card lifecycle');
if (!/function\s+posterUrl\s*\(/.test(ui) || !ui.includes('posterUrl: posterUrl'))
  error('Unified UI must own poster URL presentation');

const page = read('translationsub-page.js');
if (!page.includes('snapshot.subscriptions')) error('Subscriptions page must render backend snapshot data');
if (!page.includes('item.display')) error('Subscriptions page must render backend display projection');
if (!page.includes('display.tmdbFacts') || !page.includes('display.tmdbNext'))
  error('Subscriptions page must render backend TMDB display projection directly');
if (!page.includes('translationsub-page__top')) error('Subscriptions page must build its final top layout directly');
if (/translationsub-page__title|translationsub-page__subtitle/.test(page))
  error('Subscriptions page must not render headings that require a later polish patch');
if (/api\.check\([\s\S]{0,900}?\bload\s*\(/.test(page))
  error('Subscriptions page refetches immediately after v2/check');
if (/api\.snapshot|TranslationSubApi\.snapshot/.test(page))
  error('Subscriptions page must not own snapshot reads');
if (!/TranslationSubBadgeState[\s\S]{0,300}?subscribe/.test(page))
  error('Subscriptions page must subscribe to canonical snapshot state');
if (!/badge\.applyCommand\(result\)/.test(page))
  error('Subscriptions page must delegate manual-check command state to BadgeState');
if (/result\.snapshot|applySnapshot\s*\(/.test(page))
  error('Subscriptions page must not know command snapshot transport details');
if (/image\.tmdb\.org|Lampa\.Api\.img|Lampa\.TMDB\.image/.test(page))
  error('Subscriptions page must use the shared poster presentation helper');
for (const domainField of ['item.watchedEpisode', 'item.availableEpisode', 'item.fromEpisode', 'item.toEpisode']) {
  if (page.includes(domainField)) error(`Subscriptions page reconstructs domain display from ${domainField}`);
}
for (const leakedTmdb of ['targetSeasonEpisodes', 'nextAirDate', 'nextSeason', 'nextEpisode', 'tmdb.status']) {
  if (page.includes(leakedTmdb)) error(`Subscriptions page reconstructs TMDB state from ${leakedTmdb}`);
}
if (/new\s+Date\s*\(/.test(page)) error('Subscriptions page must not format TMDB schedule dates client-side');
if (/function\s+sourceLabels\s*\(/.test(page))
  error('Subscriptions page must not aggregate source labels client-side');

const settings = read('translationsub-settings-v2.js');
if (!settings.includes('api.updateSettings')) error('Settings UI must persist through backend API');
if (!settings.includes('api.settings')) error('Settings UI must load canonical backend settings');
if (!settings.includes('viewBox="0 0 37 37"')) error('Settings bell SVG lost its native-like proportions');
if (/<path\b/i.test(settings)) error('Settings UI must not own bell SVG geometry');
if (!settings.includes('data.schema') || !settings.includes('schemaValues(') || !settings.includes('schemaDefault('))
  error('Settings UI must render server-provided policy schema');
if (/function\s+hourValues\s*\(/.test(settings)) error('Settings UI must not define polling interval policy');
if (/\bSOURCES_KEY\b|translationsub_sources/.test(settings)) error('Settings UI must not persist a local source-of-truth list');
if (/values\s*:\s*\{\s*['"]6['"]\s*:\s*['"]6 часов/.test(settings))
  error('Settings UI hardcodes TMDB refresh policy values');
if (/values\s*:\s*\{\s*['"]7['"]\s*:\s*['"]7 дней/.test(settings))
  error('Settings UI hardcodes ended-series refresh policy values');
if (/values\s*:\s*\{\s*auto\s*:/.test(settings))
  error('Settings UI hardcodes new-season policy modes');
if (/TranslationSub\.refresh\b/.test(settings))
  error('Settings UI must not use the removed cross-layer refresh facade');
if (!/TranslationSubBadgeState[\s\S]{0,180}?\.refresh/.test(settings))
  error('Settings changes must revalidate canonical snapshot state');
if (!/cardFlow[\s\S]{0,180}?refreshButton/.test(settings))
  error('Settings changes must refresh only the current full-card button explicitly');

const navigation = read('translationsub-navigation.js');
if (!navigation.includes('new MutationObserver')) error('Navigation DOM repair observer is missing');
if (/Lampa\.Select\.show\s*=/.test(navigation)) error('Navigation must not monkey-patch global Lampa.Select');
if (/repairTimer|15000/.test(navigation)) error('Navigation must not use periodic DOM repair polling');
if (/function\s+injectStyles\s*\(/.test(navigation)) error('Navigation must not own bell/icon styling');
if (/<path\b/i.test(navigation)) error('Navigation must not own bell SVG geometry');
if (!/function\s+ensureHeadButton\s*\(/.test(navigation) || !/function\s+ensureMenuItem\s*\(/.test(navigation))
  error('Navigation must be the sole head/menu DOM owner');
if (!/function\s+openNotice\s*\(/.test(navigation) || !navigation.includes('TranslationSubBadgeState.open'))
  error('Navigation header action must delegate notices to BadgeState');
if (!navigation.includes('TranslationSub.openSubscriptions'))
  error('Navigation menu must delegate subscriptions opening to core');
if (/TranslationSub\.refresh|contentSummary|refreshButton/.test(navigation))
  error('Navigation DOM repair must never trigger card/network refresh');
if (!navigation.includes('TranslationSubBadgeState.render') || !navigation.includes('TranslationSubBellTheme.refresh'))
  error('Navigation repair must repaint cached badge/bell state after DOM reconstruction');
if (!/if\s*\(text\.text\(\)\s*!==\s*['"]Озвучки['"]\)/.test(navigation))
  error('Navigation must avoid mutation-observer loops when repairing menu text');

const notice = read('translationsub-notice.js');
if (/new\s+MutationObserver/.test(notice)) error('Notice drawer must not own a global MutationObserver');
if (/setInterval\s*\(\s*refresh/.test(notice)) error('Notice drawer must not poll in background');
if (!notice.includes('item.display')) error('Notice drawer must render backend display projection');
for (const domainField of ['item.season', 'item.watchedEpisode', 'item.fromEpisode', 'item.toEpisode', 'item.newCount']) {
  if (notice.includes(domainField)) error(`Notice drawer reconstructs notification semantics from ${domainField}`);
}
if (/function\s+sourceLabels\s*\(/.test(notice)) error('Notice drawer must not aggregate sources client-side');
if (/translationsub_card_source|api\.snapshot|TranslationSubApi\.snapshot/.test(notice))
  error('Notice drawer must use canonical source/state owners');
if (/Lampa\.Activity\.push/.test(notice))
  error('Notice drawer must delegate navigation instead of constructing activities');
if (!notice.includes('TranslationSubCardSource.open'))
  error('Notice drawer must delegate item navigation to CardSource');
if (/image\.tmdb\.org|Lampa\.Api\.img|Lampa\.TMDB\.image/.test(notice))
  error('Notice drawer must use the shared poster presentation helper');
if (/\blastUpdates\b|function\s+loadUpdates\s*\(|function\s+refresh\s*\(|TranslationSubBadgeState\.refresh/.test(notice))
  error('Notice drawer must not own snapshot state or refresh');
if (!/TranslationSubBadgeState[\s\S]{0,180}?updates/.test(notice))
  error('Notice drawer may only read cached updates from BadgeState when opened directly');
if (!/window\.TranslationSubNotice\s*=\s*\{\s*open\s*:\s*openDrawer\s*\}/m.test(notice))
  error('Notice public surface must expose only open()');

const badge = read('translationsub-badge-state.js');
if (/new\s+MutationObserver/.test(badge)) error('Badge state must not own a global MutationObserver');
if (/setInterval\s*\(\s*refresh/.test(badge)) error('Badge state must not poll in background');
if (!badge.includes('api.snapshot')) error('Badge state must consume canonical backend snapshot');
if (!badge.includes('applySnapshot')) error('Badge state must accept authoritative snapshots');
if (!/function\s+applyCommand\s*\(result\)/.test(badge) || !badge.includes('applyCommand: applyCommand'))
  error('Badge state must own command-result snapshot application');
if (!/applyCommand[\s\S]{0,320}?result\.snapshot[\s\S]{0,320}?applySnapshot\(result\.snapshot\)/.test(badge))
  error('Badge state command application must validate and apply the canonical command snapshot');
if (!/function\s+subscribe\s*\(/.test(badge) || !badge.includes('subscribe: subscribe'))
  error('Badge state must expose observable snapshot updates');
if (!/function\s+emit\s*\(/.test(badge) || !/commitSnapshot[\s\S]{0,900}?emit\(\)/.test(badge))
  error('Badge state must notify subscribers when authoritative snapshot changes');
if (!/loading\s*:\s*false/.test(badge) || !/waiters\s*:\s*\[\]/.test(badge) || !/if\s*\(state\.loading\)\s*return/.test(badge))
  error('Badge state must coalesce concurrent snapshot reads');

const bell = read('translationsub-bell-theme.js');
if (/setInterval\s*\(\s*updateHeadState/.test(bell) || /750\s*\)/.test(bell))
  error('Bell theme must not poll badge state');
if (!bell.includes('badge.subscribe(updateHeadState)'))
  error('Bell theme must subscribe to observable badge state');
if (!bell.includes('BELL_BODY') || !bell.includes('BELL_CLAPPER'))
  error('Bell theme must remain the canonical bell geometry owner');
if (!bell.includes('.translationsub-head{position:relative;display:flex;align-items:center;justify-content:center}'))
  error('Bell theme must own structural header-bell presentation');

const source = read('translationsub-source.js');
if (!source.includes('hover:long.translationsubSource')) error('Subscriptions page long-press menu is missing');
if (!source.includes('Lampa.Select.show')) error('Subscriptions long-press menu must use Lampa.Select');
if (!source.includes('function restoreContentController')) error('Subscriptions menu must restore Lampa content controller');
if (source.includes('Lampa.Select.close')) error('Subscriptions client must not call Lampa.Select.close()');
if (/function\s+tmdbId\s*\(/.test(source)) error('Subscriptions client must not resolve navigation IDs itself');
if (!source.includes('item.navigation')) error('Subscriptions client must consume backend navigation target');
if (/item\.isSerial\s*!==\s*false/.test(source)) error('Subscriptions client must not derive tv/movie navigation');
for (const domainField of ['item.season', 'item.watchedEpisode', 'item.availableEpisode', 'item.fromEpisode', 'item.toEpisode', 'item.newCount', 'item.hasNewEpisodes']) {
  if (source.includes(domainField)) error(`Subscriptions actions reconstruct backend display from ${domainField}`);
}
if (!source.includes('item.display') || !source.includes('display.noticeRange'))
  error('Subscriptions actions must render backend display projection');
if (!/badge\.applyCommand\(result\)/.test(source) || /result\.snapshot|badge\.applySnapshot/.test(source))
  error('Subscriptions actions must delegate command snapshot transport to BadgeState');

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
if (/<path\b/i.test(cardFlow)) error('Card flow must not own bell SVG geometry');
if (!cardFlow.includes('window.TranslationSubUi.refresh()'))
  error('Card flow must apply unified presentation after async button render');
if (!/badge\.applyCommand\(result\)/.test(cardFlow) || /result\.snapshot|badge\.applySnapshot/.test(cardFlow))
  error('Card flow must delegate command snapshot transport to BadgeState');

console.log(`TranslationSub JS files checked: ${loaded.length}`);
console.log(`Global MutationObserver count: ${observerCount}`);
console.log(`Startup guards: ${guards.size}`);
if (fail.length) {
  console.error(`TranslationSub JS audit failed with ${fail.length} error(s).`);
  process.exit(1);
}
console.log('TranslationSub thin-client JS audit passed.');
