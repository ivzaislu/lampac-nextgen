'use strict';

// Deterministic browser-level stress checks. No external JacRed keys or URLs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let clockShift = 0;
class Clock extends Date {
    constructor(...args) {
        if (args.length) super(...args);
        else super(Date.now() + clockShift);
    }
    static now() { return Date.now() + clockShift; }
}
function makeCard(id, title) {
    const badges = [];
    const view = {
        querySelector(selector) { return selector === '.quality-module-badge' ? badges[0] || null : null; },
        appendChild(node) {
            badges.push(node);
            node.remove = () => {
                const i = badges.indexOf(node);
                if (i >= 0) badges.splice(i, 1);
            };
        }
    };
    const node = {
        card_data: {id, title, original_title: title, release_date: '2025-01-01'},
        querySelector(selector) {
            return selector === '.card__view' ? view
                : selector === '.quality-module-badge' ? view.querySelector(selector) : null;
        }
    };
    return {node, badges};
}
function boot(count, storage, behavior) {
    const cards = Array.from({length: count}, (_, n) => makeCard(n+1000, 'Film ' + (n+1000)));
    const sqlCalls = [], periodic = [], listeners = {};
    let inflight = 0, peak = 0, parsers = 0, pendingParsers = [];
    const document = {
        currentScript: {src: 'https://lampac.example.invalid/quality.js'},
        hidden: false,
        body: {contains(node) {return cards.some(c => c.node === node);}},
        head: {appendChild() {}},
        createElement() {return {className:'', textContent:''};},
        querySelectorAll(selector) {
            return selector === '.card' ? cards.map(x => x.node) : [];
        }
    };
    const w = {
        crypto: {getRandomValues(bytes) {bytes.fill(12); return bytes;}},
        fetch(url, options) {
            assert.equal(url, 'https://lampac.example.invalid/quality/cache');
            const body = JSON.parse(options.body);
            assert.ok(body.items.length > 0 && body.items.length <= 30);
            assert.equal(typeof body.scope, 'string');
            sqlCalls.push(body);
            inflight++;
            peak = Math.max(peak, inflight);
            return new Promise(resolve => setTimeout(() => {
                inflight--;
                if (behavior.failOnce && !behavior.failed) {
                    behavior.failed = true;
                    resolve({ok:false, json:()=>Promise.resolve({})});
                    return;
                }
                if (body.op === 'get_batch') {
                    const result = {};
                    body.items.forEach(item => {
                        result[item.movie] = behavior.stale
                            ? {label: 'CAM', checkedAt: Clock.now()-2*86400000,
                                until: Clock.now()+86400000}
                            : {label: 'FHD', checkedAt: Clock.now(),
                                until: Clock.now()+7*86400000};
                    });
                    resolve({ok:true, json:()=>Promise.resolve({results:result})});
                } else {
                    resolve({ok:true, json:()=>Promise.resolve({saved:body.items.length})});
                }
            }, behavior.delay || 35));
        },
        Lampa: {
            Storage: {
                field(name) {
                    if (name === 'parser_torrent_type') return 'jackett';
                    if (name === 'jackett_url') return 'https://external.example.invalid';
                    return '';
                },
                get(name) {return storage.get(name);},
                set(name,value) {storage.set(name,value);},
                listener: {follow() {}}
            },
            Parser: {get(request,done) {
                parsers++;
                if (behavior.holdParser) pendingParsers.push({request,done});
                else done({Results: [{Title:request.movie.title+' 2025 WEB-DL 1080p'}]});
            }},
            Listener: {follow(name,fn) {listeners[name]=fn;}},
            SettingsApi: {addComponent() {}, addParam() {}}
        }
    };
    class ImmediateObserver {
        constructor(fn) {this.fn=fn;}
        observe(node) {this.fn([{isIntersecting:true,target:node}]);}
        unobserve() {}
    }
    class PassiveMutations {observe() {}}
    vm.runInNewContext(source, {
        window:w, document, console, Date:Clock,
        setTimeout, clearTimeout,
        setInterval(fn,interval) {
            periodic.push({fn,interval});
            return {unref() {}};
        },
        IntersectionObserver:ImmediateObserver,
        MutationObserver:PassiveMutations
    },{filename:'quality-stress.js'});
    return {
        cards, storage, behavior, sqlCalls, listeners, periodic, pendingParsers,
        status:()=>w.LampaQuality.status(),
        parserCalls:()=>parsers, peakSql:()=>peak
    };
}

(async()=>{
    // A >100-poster screen must not saturate SQLite with unbounded requests.
    const storage=new Map();
    const catalogue=boot(150,storage,{delay:45});
    assert.ok(catalogue.status().sql_active_requests<=2);
    await wait(850);
    const gets=catalogue.sqlCalls.filter(x=>x.op==='get_batch');
    assert.equal(gets.length,5, '150 cards must use five groups of 30');
    assert.equal(gets.reduce((n,x)=>n+x.items.length,0),150);
    assert.ok(catalogue.peakSql()<=2, 'At most two concurrent HTTP cache reads');
    assert.equal(catalogue.parserCalls(),0, 'Warm SQLite prevents JacRed queries');
    assert.ok(catalogue.cards.every(c=>c.badges.length===1 && c.badges[0].textContent==='FHD'));
    assert.equal(storage.get('quality_module_cache_v6').version,6);
    assert.equal(Object.keys(storage.get('quality_module_cache_v6').entries).length,150);

    // Simulate a full Lampa restart with the same persistent storage.
    const reloaded=boot(150,storage,{delay:45});
    await wait(80);
    assert.equal(reloaded.sqlCalls.length,0, 'Restored cache must skip SQL');
    assert.equal(reloaded.parserCalls(),0, 'Restored cache must skip JacRed');
    assert.ok(reloaded.cards.every(c=>c.badges.length===1 && c.badges[0].textContent==='FHD'));
    assert.equal(reloaded.status().persistent_entries,150);

    // A transient HTTP error should bypass SQL temporarily, not permanently.
    clockShift=0;
    const retry=boot(1,new Map(),{delay:20,failOnce:true});
    await wait(230);
    assert.equal(retry.parserCalls(),1, 'Unreachable SQL uses Lampa.Parser fallback');
    assert.equal(retry.status().sql_cache,false);
    assert.ok(retry.status().sql_retry_in_ms>0);
    clockShift=61000;
    retry.cards.push(makeCard(1902,'New Movie'));
    retry.listeners.app({type:'ready'});
    await wait(230);
    assert.equal(retry.sqlCalls.filter(x=>x.op==='get_batch').length,2,
        'A new card retries SQL after the 60-second backoff');
    assert.equal(retry.parserCalls(),1,'Recovered SQLite avoids another JacRed query');
    assert.equal(retry.status().sql_cache,true);

    // Many stale SQL entries remain visible; only three background searches
    // may be admitted each minute, with two parser calls in flight.
    clockShift=0;
    const stale=boot(100,new Map(),{delay:35,stale:true,holdParser:true});
    await wait(380);
    assert.ok(stale.cards.every(c=>c.badges.length===1 && c.badges[0].textContent==='CAM'));
    assert.equal(stale.parserCalls(),2);
    assert.equal(stale.status().queued_requests,1);
    assert.equal(stale.pendingParsers.length,2);
    assert.ok(stale.peakSql()<=2);
    clockShift=61000;
    stale.periodic.find(x=>x.interval===60000).fn();
    assert.equal(stale.parserCalls(),2,'Additional background work waits for slots');
    assert.ok(stale.status().queued_requests>=1);
    stale.pendingParsers[0].done({Results:[{Title:'Film 1000 2025 2160p'}]});
    assert.equal(stale.parserCalls(),3);
    assert.equal(stale.cards[0].badges[0].textContent,'4K');
    assert.ok(stale.cards.slice(1).every(c=>c.badges[0].textContent==='CAM'));
    console.log('Quality stress: 150 cards, bounded SQL, restart, retry and background refresh OK');
})().catch(e=>{console.error(e); process.exitCode=1;});
