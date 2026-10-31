'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const plugin = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const saved = new Map();
const settings = {
    parser_torrent_type: 'jackett', parser_use_link: 'one',
    jackett_url: 'https://jacred.example.invalid', jackett_key: 'private-token',
    jackett_url_two: '', jackett_key_two: ''
};

function boot(remoteGet) {
    const badges = [];
    const requests = [];
    let parserCalls = 0;
    const view = {
        querySelector(s) { return s === '.quality-module-badge' ? badges[0] || null : null; },
        appendChild(node) {
            badges.push(node);
            node.remove = () => { const index = badges.indexOf(node); if (index >= 0) badges.splice(index, 1); };
        }
    };
    const card = {
        card_data: {id: 22, title: 'Example', original_title: 'Example', release_date: '2025-01-01'},
        querySelector(s) {
            return s === '.card__view' ? view : s === '.quality-module-badge' ? view.querySelector(s) : null;
        }
    };
    const document = {
        currentScript: {src: 'https://lampac.example.invalid/quality.js'},
        body: {contains(node) { return node === card; }},
        head: {appendChild() {}},
        createElement() { return {className: '', textContent: ''}; },
        querySelectorAll(s) { return s === '.card' ? [card] : []; }
    };
    const mockWindow = {
        crypto: {getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1; return bytes; }},
        fetch(url, params) {
            assert.equal(url, 'https://lampac.example.invalid/quality/cache');
            const req = JSON.parse(params.body);
            requests.push(req);
            assert.equal(req.scope.length, 32);
            assert.equal(req.source.length, 16);
            assert.equal(req.movie.length, 16);
            assert.equal(typeof req.scope, 'string');
            assert.equal(params.credentials, 'same-origin');
            const serialized = JSON.stringify(req);
            assert.equal(serialized.includes('private-token'), false);
            assert.equal(serialized.includes('jacred.example.invalid'), false);
            if (req.op === 'get')
                return Promise.resolve({ok: true, json: () => Promise.resolve(remoteGet)});
            return Promise.resolve({ok: true, json: () => Promise.resolve({saved: true})});
        },
        Lampa: {
            Storage: {
                field(name) { return settings[name] || ''; },
                get(name) { return saved.get(name) || ''; },
                set(name, value) { saved.set(name, value); },
                listener: {follow() {}}
            },
            Parser: {get(request, done) {
                parserCalls++;
                done({Results: [{Title: 'Example 2025 WEB-DL 1080p', Seeders: 5}]});
            }},
            Listener: {follow() {}}
        }
    };
    class ImmediateIntersection {
        constructor(cb) { this.cb = cb; }
        observe(target) { this.cb([{isIntersecting: true, target}]); }
        unobserve() {}
    }
    class PassiveMutations { observe() {} }
    vm.runInNewContext(plugin, {
        window: mockWindow, document, console, setTimeout, clearTimeout,
        IntersectionObserver: ImmediateIntersection,
        MutationObserver: PassiveMutations
    }, {filename: 'quality-plugin-sql.js'});
    return {badges, requests, parserCalls: () => parserCalls, status: () => mockWindow.LampaQuality.status()};
}

(async () => {
    const first = boot({hit: true, label: '4K', until: Date.now() + 86400000});
    await pause(40);
    assert.equal(first.parserCalls(), 0, 'SQLite hit must skip JacRed');
    assert.equal(first.badges[0].textContent, '4K');
    assert.match(first.badges[0].className, /card__quality/);
    assert.match(first.badges[0].className, /quality-module-4k/);
    assert.equal(first.requests.length, 1);
    assert.equal(first.requests[0].op, 'get');
    assert.equal(first.status().sql_cache, true);

    await pause(400);
    const disk = saved.get('quality_module_cache_v2');
    assert.equal(disk.version, 2);
    assert.equal(Object.keys(disk.entries).length, 1, 'Lampa cache should be persisted');

    const second = boot({hit: false});
    assert.equal(second.badges[0].textContent, '4K');
    assert.equal(second.parserCalls(), 0);
    assert.equal(second.requests.length, 0, 'Lampa persistent cache must skip remote cache and parser');

    settings.jackett_url = 'https://different.example.invalid';
    const third = boot({hit: false});
    await pause(40);
    assert.equal(third.parserCalls(), 1, 'Changing JacRed source must invalidate old caches');
    assert.equal(third.badges[0].textContent, 'FHD');
    assert.deepEqual(third.requests.map(r => r.op), ['get', 'put']);
    assert.notEqual(third.requests[0].source, first.requests[0].source);
    console.log('Quality: SQL hit, Lampa persistence, source isolation and visual classes OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
