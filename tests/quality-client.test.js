'use strict';
const assert = require('node:assert/strict');
const {qualityOf, bestOf, normalize, parserRequest} = require('../Modules/Quality/plugin.js');
const row = (Title, extra) => Object.assign({Title, Seeders: 5}, extra || {});
const movie = {type: 'movie', year: 2025, title: 'Example', original: 'Example', genres: []};
const labels = [
    ['Example 2025 HDCAM 1080p', 'CAM'],
    ['Example 2025 TS 720p', 'TS'],
    ['Example 2025 TSRip 720p', 'TS'],
    ['Example 2025 HDTS 720p', 'TS'],
    ['Example 2025 TC 1080p', 'TC'],
    ['Example 2025 HDRip', 'SD'],
    ['Example 2025 WEB-DL 720p', 'HD'],
    ['Example 2025 WEB-DL 1080p', 'FHD'],
    ['Example 2025 WEB-DL UHD 2160p', '4K'],
    ['Example 2025 [звук с TS] 1080p', 'FHD'],
    ['Example 2025 [audio from TS] 1080p', 'FHD'],
    ['Example 2025 [sound from TS] 1080p', 'FHD']
];
labels.forEach(([title, label]) => assert.equal(qualityOf(row(title)), label, title));
assert.equal(qualityOf(row('Example SD', {Info: {quality: 480}})), 'SD');
assert.equal(bestOf([row('Example Trailer 2025 4K'), row('Example 2025 1080p')], movie), 'FHD');
assert.equal(bestOf([row('Example 2010 4K')], movie), null);
assert.equal(bestOf([row('Example 2025 4K', {Info: {types: ['serial']}})], movie), null);
assert.equal(bestOf([row('Example CAM 1080p'), row('Example 2025 4K')], movie), '4K');
assert.equal(bestOf([], movie), null);
assert.equal(bestOf([row('Unrelated Movie 2025 4K'), row('Example 2025 1080p')], movie), 'FHD');
assert.equal(bestOf([row('Unrelated Movie 2025 4K')], movie), null);
const tv = normalize({id: 55, name: 'Show', original_name: 'Series', first_air_date: '2023-02-01'});
assert.equal(tv.type, 'tv');
assert.equal(tv.year, 2023);
assert.equal(parserRequest(tv).movie.original_name, 'Series');
assert.equal(parserRequest(tv).movie.number_of_seasons, 1);
assert.ok(Array.isArray(parserRequest(tv).movie.genres));
assert.equal(parserRequest(tv).global, false);
console.log('Quality plugin: scoring and Lampa Parser adapter OK');


// Simulate the existing Lampa Parser contract: Quality must not construct a
// JacRed URL or pass API credentials to any Quality server.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const client = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const badges = [];
const view = {
    querySelector(selector) { return selector === '.quality-module-badge' ? badges[0] || null : null; },
    appendChild(node) { badges.push(node); node.remove = () => { const at = badges.indexOf(node); if (at >= 0) badges.splice(at, 1); }; }
};
const card = {
    card_data: {id: 77, title: 'Example', original_title: 'Example', release_date: '2025-01-01'},
    querySelector(selector) { return selector === '.card__view' ? view : selector === '.quality-module-badge' ? view.querySelector(selector) : null; }
};
const fullBadges = [];
const fullRate = {
    querySelector(selector) { return selector === '.quality-module-badge' ? fullBadges[0] || null : null; },
    appendChild(node) { fullBadges.push(node); }
};
const detachedFullNode = {
    querySelector(selector) { return selector === '.full-start-new__rate-line' ? fullRate : null; }
};
const listenerHandlers = {};
const fakeDocument = {
    body: {contains(node) { return node === card; }},
    head: {appendChild() {}},
    createElement() { return {textContent: '', className: ''}; },
    querySelectorAll(selector) { return selector === '.card' ? [card] : []; }
};
const settings = {
    parser_torrent_type: 'jackett', parser_use_link: 'one',
    jackett_url: 'https://example.invalid', jackett_key: 'test-secret-only-in-lampa',
    jackett_url_two: '', jackett_key_two: ''
};
let parserCalls = 0;
const storageEvents = {};
let capturedParserRequest = null;
const fakeWindow = {Lampa: {
    Storage: {field(name) { return settings[name] || ''; }, listener: {follow(name, callback) { storageEvents[name] = callback; }}},
    Parser: {get(request, done) {
        parserCalls++;
        capturedParserRequest = request;
        done({Results: [row('Example (2025) 1080p')]});
    }},
    Listener: {follow(name, callback) { listenerHandlers[name] = callback; }}
}};
class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe(node) { this.callback([{isIntersecting: true, target: node}]); }
    unobserve() {}
}
class FakeMutationObserver { observe() {} }
const env = {
    window: fakeWindow, document: fakeDocument,
    IntersectionObserver: FakeIntersectionObserver, MutationObserver: FakeMutationObserver,
    setTimeout, clearTimeout, setInterval, console
};
vm.runInNewContext(client, env, {filename: 'plugin.js'});
assert.equal(parserCalls, 1);
assert.equal(capturedParserRequest.search, 'Example');
assert.equal(capturedParserRequest.movie.release_date, '2025-01-01');
assert.equal(badges.length, 1);
assert.equal(badges[0].textContent, 'FHD');
assert.ok(!JSON.stringify(capturedParserRequest).includes('test-secret-only-in-lampa'));
vm.runInNewContext(client, env, {filename: 'plugin.js'});
assert.equal(parserCalls, 1, 'Plugin must ignore duplicate injection');
listenerHandlers.full({
    type: 'complite',
    data: {movie: {id: 77, title: 'Example', original_title: 'Example', release_date: '2025-01-01'}},
    body: [detachedFullNode]
});
assert.equal(parserCalls, 1, 'Full page should reuse the film cache');
assert.equal(fullBadges.length, 1);
assert.equal(fullBadges[0].textContent, 'FHD');
settings.jackett_url = 'https://another.example.invalid';
storageEvents.change({name: 'jackett_url'});
assert.equal(parserCalls, 2, 'Changing JacRed endpoint must requery the card');
assert.equal(badges.length, 1);
assert.equal(badges[0].textContent, 'FHD');
settings.parser_torrent_type = 'prowlarr';
storageEvents.change({name: 'parser_torrent_type'});
assert.equal(badges.length, 0, 'Quality badge must disappear when JacRed parser is disabled');
console.log('Quality plugin: source changes and disabling JacRed OK.');

console.log('Quality plugin: mocked Lampa Parser and badge integration OK.');
