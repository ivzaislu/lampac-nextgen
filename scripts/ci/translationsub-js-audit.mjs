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
  if (/function\s+schedulePolling\s*\(/.test(code)) error(`${name}: legacy client force-polling schedulePolling is present`);
  if (/function\s+checkIntervalMinutes\s*\(/.test(code)) error(`${name}: legacy minute-based polling is present`);
  if (/setTimeout\s*\(\s*function\s*\(\)\s*\{\s*openVoices\s*\(/s.test(code)) error(`${name}: delayed openVoices() reopen is present`);
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

const core = read(path.join(moduleDir, 'translationsub.js'));
for (const symbol of ['injectFullButton', 'registerComponent', 'SubscriptionComponent', 'schedulePolling', 'addSettings', 'checkIntervalMinutes']) {
  if (core.includes(symbol)) error(`translationsub.js still contains obsolete owner: ${symbol}`);
}
if (/\.on\(\s*["']hover:enter["']\s*,\s*openSubscriptionsPage/.test(core)) {
  error('Core header bell still binds directly to the full subscriptions page');
}

const page = read(path.join(moduleDir, 'translationsub-page.js'));
if (!page.includes('__TranslationSubPageStarted')) error('Subscriptions page startup guard is missing');
if (/setTimeout\s*\([^)]*load[^)]*,\s*1[0-9]{3}\s*\)/s.test(page)) error('Subscriptions page contains delayed second load');

const settings = read(path.join(moduleDir, 'translationsub-settings-v2.js'));
if (!settings.includes('viewBox="0 0 37 37"')) error('Settings icon must use native-like 37x37 proportions');
if (!settings.includes('width:2em!important;height:2em!important')) error('Settings icon must use the standard 2em Lampa settings size');

const navigation = read(path.join(moduleDir, 'translationsub-navigation.js'));
if (!navigation.includes('new MutationObserver')) error('Navigation no longer repairs Lampa head/menu DOM recreation');
if (/Lampa\.Select\.show\s*=/.test(navigation)) error('Navigation must not monkey-patch global Lampa.Select');

const notice = read(path.join(moduleDir, 'translationsub-notice.js'));
if (/new\s+MutationObserver/.test(notice)) error('Notice drawer must not own a global MutationObserver');
if (/refreshTimer\s*=\s*setInterval|setInterval\s*\(\s*refresh\s*,/s.test(notice)) error('Notice drawer owns duplicate periodic refresh polling');

const badge = read(path.join(moduleDir, 'translationsub-badge-state.js'));
if (/new\s+MutationObserver/.test(badge)) error('Badge state must not own a global MutationObserver');

const ui = read(path.join(moduleDir, 'translationsub-ui.js'));
if (/repeat\(3\s*,/.test(ui)) error('Obsolete three-column TV layout returned to translationsub-ui.js');

const cardFlow = read(path.join(moduleDir, 'translationsub-card-flow.js'));
if (/setTimeout\s*\(\s*function\s*\(\)\s*\{\s*openVoices\s*\(/s.test(cardFlow)) error('Card flow can reopen voice selector after an action');

console.log(`TranslationSub JS files checked: ${loaded.length}`);
console.log(`Global MutationObserver count: ${observerCount}`);
console.log(`Startup guards: ${guards.size}`);
console.log(`Warnings: ${warn.length}`);

if (fail.length) {
  console.error(`TranslationSub JS audit failed with ${fail.length} error(s).`);
  process.exit(1);
}

console.log('TranslationSub JS audit passed.');
