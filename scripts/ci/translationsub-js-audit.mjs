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
  const duplicates = loaded.filter((name) => seen.has(name) || !seen.add(name));
  error(`Duplicate JS includes in PluginController: ${[...new Set(duplicates)].join(', ')}`);
}

for (const name of loaded) {
  if (!jsFiles.includes(name)) error(`PluginController references missing JS file: ${name}`);
}

for (const name of jsFiles) {
  if (!loadedSet.has(name)) error(`Orphan TranslationSub JS file is not loaded: ${name}`);
}

const guards = new Map();
let observerCount = 0;
let componentRegistrationCount = 0;
let settingsRootRegistrationCount = 0;
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

  if (!/["']use strict["']/.test(code)) warning(`${name}: missing 'use strict'`);

  const guardMatch = code.match(/window\.(__TranslationSub[A-Za-z0-9_]+Started)\b/);
  if (!guardMatch) {
    warning(`${name}: no TranslationSub startup guard found`);
  } else {
    const guard = guardMatch[1];
    if (guards.has(guard)) error(`Duplicate startup guard ${guard}: ${guards.get(guard)} and ${name}`);
    else guards.set(guard, name);
  }

  observerCount += (code.match(/new\s+MutationObserver\s*\(/g) || []).length;
  componentRegistrationCount += (code.match(/Lampa\.Component\.add\s*\(\s*["']translationsub_list["']/g) || []).length;
  settingsRootRegistrationCount += (code.match(/component\s*:\s*(?:ROOT|["']translationsub_settings["'])/g) || []).length;

  if (code.includes('{time}')) error(`${name}: unresolved {time} template placeholder`);
  if (/function\s+schedulePolling\s*\(/.test(code)) error(`${name}: legacy client force-polling function schedulePolling is present`);
  if (/function\s+checkIntervalMinutes\s*\(/.test(code)) error(`${name}: legacy minute-based polling is present`);
  if (/force\s*:\s*["']true["']/.test(code)) warning(`${name}: force=true request flag found; verify it is manual-only`);
  if (/setTimeout\s*\(\s*function\s*\(\)\s*\{\s*openVoices\s*\(/s.test(code)) {
    warning(`${name}: delayed openVoices() refresh remains; navigation guard currently suppresses accidental reopen`);
  }
}

try {
  new vm.Script(bundle, { filename: 'translationsub.bundle.js' });
} catch (err) {
  error(`Combined TranslationSub bundle syntax error: ${err.message}`);
}

if (observerCount > 1) error(`Too many global MutationObserver instances: ${observerCount}; expected at most 1`);
if (componentRegistrationCount !== 1) error(`translationsub_list must be registered exactly once, found ${componentRegistrationCount}`);

const core = read(path.join(moduleDir, 'translationsub.js'));
const forbiddenCoreSymbols = [
  'injectFullButton',
  'registerComponent',
  'SubscriptionComponent',
  'schedulePolling',
  'addSettings',
  'checkIntervalMinutes'
];
for (const symbol of forbiddenCoreSymbols) {
  if (core.includes(symbol)) error(`translationsub.js still contains obsolete owner: ${symbol}`);
}

const settings = read(path.join(moduleDir, 'translationsub-settings-v2.js'));
if (!settings.includes('viewBox="0 0 37 37"')) warning('Settings icon is not using the native-like 37x37 proportions');
if (!settings.includes('width:2em!important;height:2em!important')) warning('Settings icon does not use the standard 2em Lampa settings size');

const navigation = read(path.join(moduleDir, 'translationsub-navigation.js'));
if (!navigation.includes('new MutationObserver')) error('Navigation no longer repairs Lampa head/menu DOM recreation');

const notice = read(path.join(moduleDir, 'translationsub-notice.js'));
if (/new\s+MutationObserver/.test(notice)) error('Notice drawer must not own a global MutationObserver');
if (/setInterval\s*\(/.test(notice)) warning('Notice drawer contains a periodic timer; verify it is not duplicate polling');

const badge = read(path.join(moduleDir, 'translationsub-badge-state.js'));
if (/new\s+MutationObserver/.test(badge)) error('Badge state must not own a global MutationObserver');

console.log(`TranslationSub JS files checked: ${loaded.length}`);
console.log(`Global MutationObserver count: ${observerCount}`);
console.log(`Startup guards: ${guards.size}`);
console.log(`Warnings: ${warn.length}`);

if (fail.length) {
  console.error(`TranslationSub JS audit failed with ${fail.length} error(s).`);
  process.exit(1);
}

console.log('TranslationSub JS audit passed.');
