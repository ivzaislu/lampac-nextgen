'use strict';
const assert = require('node:assert/strict');
const {qualityOf, bestOf, normalize, parserRequest} = require('../Modules/Quality/plugin.js');
const row = (Title, extra) => Object.assign({Title, Seeders: 5}, extra || {});
const movie = {type: 'movie', year: 2025, title: 'Example', original: 'Example', genres: []};
const labels = [
    ['Example 2025 HDCAM 1080p', 'CAM'],
    ['Example 2025 TS 720p', 'TS'],
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
