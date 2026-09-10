import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const productionRoots = ['Core', 'Modules', 'Shared'];
const extensions = new Set(['.cs', '.js']);
const ignoredDirectories = new Set(['bin', 'obj', 'node_modules', '.git']);

function normalize(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function walk(directory, result = []) {
  if (!fs.existsSync(directory)) return result;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, result);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(file);
  }
  return result;
}

const files = productionRoots.flatMap((directory) => walk(path.join(root, directory)));
const texts = new Map(files.map((file) => [normalize(file), fs.readFileSync(file, 'utf8')]));

const timeCodeControllerPath = 'Modules/Sync/TimeCode/Controller.cs';
const timeCodeSqlContextPath = 'Modules/Sync/TimeCode/SqlContext.cs';
const timeCodePluginPath = 'Modules/Sync/TimeCode/plugin.js';
const translationProgressPath = 'Modules/TranslationSub/Services/TimeCodeProgressService.cs';
const translationModInitPath = 'Modules/TranslationSub/ModInit.cs';

for (const required of [
  timeCodeControllerPath,
  timeCodeSqlContextPath,
  timeCodePluginPath,
  translationProgressPath,
  translationModInitPath
]) {
  assert.ok(texts.has(required), `Required TimeCode integration file is missing: ${required}`);
}

// The physical TimeCode database is allowed to be opened only by the TimeCode
// owner itself and by TranslationSub's explicitly read-only projection reader.
const databaseReferences = [];
for (const [file, code] of texts) {
  if (/database[\\/]TimeCode\.sql/i.test(code)) databaseReferences.push(file);
}

const allowedDatabaseReferences = new Set([
  timeCodeSqlContextPath,
  translationProgressPath
]);
const unexpectedDatabaseReferences = databaseReferences.filter((file) => !allowedDatabaseReferences.has(file));
assert.deepEqual(unexpectedDatabaseReferences, [],
  `Unexpected direct TimeCode database access: ${unexpectedDatabaseReferences.join(', ')}`);

// Detect EF mutations against the TimeCode table anywhere in production source.
// Any new writer must either remain inside TimeCodeController or deliberately
// extend the TranslationSub server hook before this allowlist is changed.
const mutationPatterns = [
  /\.timecodes\s*\.\s*Add(?:Async)?\s*\(/g,
  /\.timecodes\s*\.\s*AddRange(?:Async)?\s*\(/g,
  /\.timecodes\s*\.\s*Remove(?:Range)?\s*\(/g,
  /\.timecodes[\s\S]{0,500}?ExecuteDelete(?:Async)?\s*\(/g,
  /\.timecodes[\s\S]{0,500}?ExecuteUpdate(?:Async)?\s*\(/g,
  /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?timecodes\b/gi
];

const mutationOwners = new Set();
for (const [file, code] of texts) {
  if (mutationPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(code);
  })) mutationOwners.add(file);
}

assert.deepEqual([...mutationOwners].sort(), [timeCodeControllerPath],
  `TimeCode mutations must be owned only by ${timeCodeControllerPath}; found: ${[...mutationOwners].sort().join(', ')}`);

const timeCodeController = texts.get(timeCodeControllerPath);
const routes = [...timeCodeController.matchAll(/\[Route\("(\/timecode\/[^"?]+)"\)\]/g)].map((match) => match[1]);
assert.deepEqual([...new Set(routes)].sort(), ['/timecode/add', '/timecode/all'],
  `Unexpected TimeCode routes found: ${[...new Set(routes)].sort().join(', ')}`);
assert.match(timeCodeController, /\[HttpPost\][\s\S]*?\[Route\("\/timecode\/add"\)\][\s\S]*?ExecuteDelete\(\)[\s\S]*?timecodes\.Add\([\s\S]*?SaveChangesAsync\(\)/,
  '/timecode/add must remain the single TimeCode mutation transaction');

const timeCodePlugin = texts.get(timeCodePluginPath);
const pluginMethods = [...timeCodePlugin.matchAll(/this\.url\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
assert.deepEqual([...new Set(pluginMethods)].sort(), ['add', 'all'],
  `TimeCode client uses unexpected server methods: ${[...new Set(pluginMethods)].sort().join(', ')}`);
assert.match(timeCodePlugin, /Timeline\.listener\.follow\(['"]update['"],\s*this\.add\.bind\(this\)\)/,
  'Lampa Timeline updates must flow through the TimeCode add method');
assert.match(timeCodePlugin, /this\.network\.silent\(url,\s*false,\s*false,\s*\{[\s\S]*?id:\s*e\.data\.hash[\s\S]*?data:\s*JSON\.stringify\(e\.data\.road\)/,
  'TimeCode add must post the timeline hash and road state to /timecode/add');

const progressReader = texts.get(translationProgressPath);
assert.match(progressReader, /SqliteOpenMode\.ReadOnly/,
  'TranslationSub TimeCode database access must remain read-only');
assert.match(progressReader, /SELECT card, item, data FROM timecodes WHERE user = \$user/,
  'TranslationSub must read watched state from the authoritative TimeCode table');
assert.doesNotMatch(progressReader, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?timecodes\b/i,
  'TranslationSub progress reader must never mutate TimeCode');

const modInit = texts.get(translationModInitPath);
assert.match(modInit, /HttpMethods\.IsPost\(request\.Method\)[\s\S]*?"\/timecode\/add"/,
  'TranslationSub must observe the authoritative TimeCode mutation endpoint');
assert.match(modInit, /Response\.OnCompleted/,
  'TranslationSub must reconcile only after the TimeCode request completes');
assert.match(modInit, /TimeCodeProgressService\.SyncUser\(uid, profileId\)/,
  'TranslationSub must reconcile the exact uid/profile after TimeCode writes');
assert.match(modInit, /PublishProfile\(uid, profileId, "timecode"\)/,
  'TranslationSub must invalidate only the changed profile after TimeCode writes');

console.log('TimeCode database references:', databaseReferences.join(', '));
console.log('TimeCode mutation owner:', [...mutationOwners].join(', '));
console.log('TimeCode routes:', [...new Set(routes)].sort().join(', '));
console.log('TranslationSub TimeCode writer audit passed.');
