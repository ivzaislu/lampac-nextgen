'use strict';
// Browser-only Lampa.PARSER: SQL is batched, JacRed is deliberately per-title.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const sleep = n => new Promise(resolve => setTimeout(resolve, n));

function boot(movies, sqlHits, delayParser) {
    const calls = [];
    const parserCallbacks = [];
    const settingsParams = [], settingsComponents = [];
    const listeners = {};
    let parserCount = 0;
    const local = new Map();
    const cards = movies.map(movie => {
        const badges = [];
        const view = {
            querySelector(selector) {
                return selector === '.quality-module-badge' ? badges[0] || null : null;
            },
            appendChild(el) {
                badges.push(el);
                el.remove = () => {
                    const at = badges.indexOf(el);
                    if (at >= 0) badges.splice(at, 1);
                };
            }
        };
        const node = {
            card_data: {id: movie.id, title: movie.title, original_title: movie.title, release_date: '2025-01-01'},
            querySelector(selector) {
                if (selector === '.card__view') return view;
                return selector === '.quality-module-badge' ? view.querySelector(selector) : null;
            }
        };
        return {node, badges, movie};
    });
    const document = {
        currentScript: {src: 'https://quality.lampac.invalid/quality.js'},
        body: {contains(node) { return cards.some(card => card.node === node); }},
        head: {appendChild() {}},
        createElement() { return {className: '', textContent: ''}; },
        querySelectorAll(selector) { return selector === '.card' ? cards.map(c => c.node) : []; }
    };
    const w = {
        crypto: {getRandomValues(bytes) { bytes.fill(31); return bytes; }},
        fetch(url, options) {
            assert.equal(url, 'https://quality.lampac.invalid/quality/cache');
            const body = JSON.parse(options.body);
            calls.push(body);
            assert.ok(body.items.length <= 30);
            assert.ok(body.items.length > 0);
            assert.ok(!options.body.includes('jacred-key'));
            assert.ok(!options.body.includes('outside.jacred.invalid'));
            if (body.op === 'get_batch') {
                const results = {};
                body.items.forEach(entry => {
                    if (sqlHits[entry.movie]) results[entry.movie] = sqlHits[entry.movie];
                });
                // SQL simulation permits marker 'all' to resolve all entries.
                if (sqlHits.all) {
                    body.items.forEach(entry => {
                        results[entry.movie] = sqlHits.all;
                    });
                }
                return Promise.resolve({ok: true, json: () => Promise.resolve({results})});
            }
            assert.equal(body.op, 'put_batch');
            body.items.forEach(entry => {
                assert.ok(entry.ttlDays >= 1 && entry.ttlDays <= 60);
            });
            return Promise.resolve({ok: true, json: () => Promise.resolve({saved: body.items.length})});
        },
        Lampa: {
            Storage: {
                field(name) {
                    if (name === 'parser_torrent_type') return 'jackett';
                    if (name === 'jackett_url') return 'https://outside.jacred.invalid';
                    if (name === 'jackett_key') return 'jacred-key';
                    return '';
                },
                get(name, fallback) { return local.has(name) ? local.get(name) : fallback; },
                set(name, value) { local.set(name, value); },
                listener: {follow() {}}
            },
            Parser: {get(request, callback) {
                parserCount++;
                if (delayParser) parserCallbacks.push({request, callback});
                else callback({Results: [{Title: request.movie.title + ' 2025 WEB-DL 1080p'}]});
            }},
            Listener: {follow(name, callback) { listeners[name] = callback; }},
            SettingsApi: {
                addComponent(value) { settingsComponents.push(value); },
                addParam(value) { settingsParams.push(value); }
            }
        }
    };
    class Intersection {
        constructor(callback) { this.callback = callback; }
        observe(node) { this.callback([{isIntersecting: true, target: node}]); }
        unobserve() {}
    }
    class Mutation { observe() {} }
    vm.runInNewContext(code, {window: w, document, console, setTimeout, clearTimeout,
        setInterval, IntersectionObserver: Intersection, MutationObserver: Mutation},
    {filename: 'quality-batch-plugin.js'});
    return {calls, cards, parserCallbacks, parserCount: () => parserCount,
        settingsComponents, settingsParams, listeners, status: () => w.LampaQuality.status()};
}

(async () => {
    const movies = Array.from({length: 12}, (_, i) => ({id: 100+i, title: 'Film ' + (i+1)}));
    const batch = boot(movies, {}, false);
    await sleep(530);
    const get = batch.calls.filter(x => x.op === 'get_batch');
    const put = batch.calls.filter(x => x.op === 'put_batch');
    assert.equal(get.length, 1, '12 posters must use one SQL GET batch');
    assert.equal(get[0].items.length, 12);
    assert.equal(put.length, 1, '12 parser responses must use one SQL PUT batch');
    assert.equal(put[0].items.length, 12);
    assert.equal(batch.parserCount(), 12, 'Lampa.Parser.get is per movie; no imaginary JacRed batch');
    batch.cards.forEach(card => assert.equal(card.badges[0].textContent, 'FHD'));
    assert.equal(batch.settingsComponents[0].component, 'quality');
    const p = batch.settingsParams.map(x => x.param.name);
    for (const name of ['quality_module_enabled', 'quality_module_background',
        'quality_module_days_low', 'quality_module_days_hd',
        'quality_module_days_4k_new', 'quality_module_days_4k_old',
        'quality_module_days_empty', 'quality_module_batch_size',
        'quality_module_refresh_minutes', 'quality_module_refresh_now']) {
        assert.ok(p.includes(name), 'Lampa SettingsApi must register ' + name);
    }
    assert.equal(batch.status().batch_size, 30);
    // Existing card nodes can be reused after Lampa replaces their poster DOM.
    batch.cards[0].badges[0].remove();
    assert.equal(batch.cards[0].badges.length, 0);
    batch.listeners.app({type: 'ready'});
    assert.equal(batch.cards[0].badges[0].textContent, 'FHD');
    assert.equal(batch.parserCount(), 12, 'Poster repaint must reuse cached result');

    // Background refresh must keep an expired soft-TTL badge visible until
    // Lampa.Parser resolves a replacement; the SQL hit itself is not recomputed.
    const stale = {
        label: 'CAM', checkedAt: Date.now() - 2*86400000,
        until: Date.now() + 86400000
    };
    const refresh = boot([{id: 200, title: 'Background Movie'}], {all: stale}, true);
    await sleep(250);
    assert.equal(refresh.cards[0].badges[0].textContent, 'CAM');
    assert.equal(refresh.parserCount(), 1, 'Background refresh must query JacRed once');
    assert.equal(refresh.parserCallbacks.length, 1);
    refresh.parserCallbacks[0].callback({Results: [{Title: 'Background Movie 2025 4K 2160p'}]});
    assert.equal(refresh.cards[0].badges[0].textContent, '4K');
    await sleep(260);
    assert.equal(refresh.calls.filter(x => x.op === 'put_batch').length, 1);
    assert.equal(refresh.calls.filter(x => x.op === 'put_batch')[0].items[0].label, '4K');
    assert.equal(refresh.cards[0].badges.length, 1, 'Badge must not disappear while refreshing');

    // Eight stale records must not produce eight simultaneous background
    // JacRed lookups. Exactly three are admitted per minute, at most two active.
    const many = boot(Array.from({length: 8}, (_, i) =>
        ({id: 300+i, title: 'Stale Film ' + (i+1)})), {all: stale}, true);
    await sleep(240);
    assert.equal(many.parserCount(), 2, 'Background concurrency is capped at two');
    assert.equal(many.status().queued_requests, 1, 'Background throttle admits only three');
    many.parserCallbacks[0].callback({Results: [{Title: 'Stale Film 1 2025 1080p'}]});
    assert.equal(many.parserCount(), 3);
    many.parserCallbacks[1].callback({Results: [{Title: 'Stale Film 2 2025 1080p'}]});
    many.parserCallbacks[2].callback({Results: [{Title: 'Stale Film 3 2025 1080p'}]});
    await sleep(30);
    assert.equal(many.parserCount(), 3, 'Remaining stale entries must wait for a later refresh window');
    console.log('Quality SQL: 12-card batch, SettingsApi, SWR and background throttle OK');
})().catch(error => {console.error(error); process.exitCode = 1;});
