'use strict';
// A repeat viewport encounter revalidates stale quality without periodic polling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = 86400000;
let offset = 0;
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.now() + offset])); }
    static now() { return Date.now() + offset; }
}

(async () => {
    let visible = false, intersection, parserCalls = 0, requests = [];
    const callbacks = [], timers = [], data = new Map(), badges = [];
    const stale = {label:'TS', checkedAt:Clock.now()-3*day, until:Clock.now()+100*day};
    const view = {
        querySelector(s) { return s === '.quality-module-badge' ? badges[0] || null : null; },
        appendChild(el) {
            badges.push(el);
            el.remove = () => {
                const index = badges.indexOf(el);
                if (index >= 0) badges.splice(index,1);
            };
        }
    };
    const card = {
        card_data:{id:54,title:'Sample Film',original_title:'Sample Film',release_date:'2025-01-01'},
        querySelector(s) {
            return s === '.card__view' ? view
                : s === '.quality-module-badge' ? view.querySelector(s) : null;
        }
    };
    const document = {
        currentScript:{src:'https://lampac.invalid/quality.js'},
        hidden:false,
        body:{contains(node){return node===card;}},
        head:{appendChild(){}},
        createElement(){return {textContent:'',className:''};},
        querySelectorAll(s){return s === '.card' ? [card] : [];}
    };
    const window = {
        crypto:{getRandomValues(bytes){bytes.fill(42);return bytes;}},
        fetch(url,options) {
            const request=JSON.parse(options.body);
            requests.push(request);
            if (request.op === 'get_batch') {
                const results = {};
                for (const entry of request.items) results[entry.movie]=stale;
                return Promise.resolve({ok:true,json:()=>Promise.resolve({results})});
            }
            return Promise.resolve({ok:true,json:()=>Promise.resolve({saved:request.items.length})});
        },
        Lampa:{
            Storage:{
                field(name) {
                    if (name==='parser_torrent_type') return 'jackett';
                    if (name==='jackett_url') return 'https://parser.invalid';
                    return '';
                },
                get(name,fallback){return data.has(name)?data.get(name):fallback;},
                set(name,value){data.set(name,value);},
                listener:{follow(){}}
            },
            Parser:{get(request,callback) {
                parserCalls++;
                callbacks.push({request,callback});
            }},
            Listener:{follow(){}},
            SettingsApi:{addComponent(){},addParam(){}}
        }
    };
    class VisibilityObserver {
        constructor(callback){this.callback=callback;intersection=this;this.active=new Set();}
        observe(node) {
            this.active.add(node);
            if (visible) this.callback([{target:node,isIntersecting:true}]);
        }
        unobserve(node){this.active.delete(node);}
        trigger(state) {
            visible=state;
            for (const node of this.active)
                this.callback([{target:node,isIntersecting:state}]);
        }
    }
    class Mutation {observe(){}}
    vm.runInNewContext(code,{window,document,Date:Clock,console,
        setTimeout,clearTimeout,clearInterval,
        setInterval(fn,interval){timers.push({fn,interval});return {unref(){}};},
        MutationObserver:Mutation,IntersectionObserver:VisibilityObserver
    },{filename:'quality-visit-refresh.js'});
    assert.equal(window.LampaQuality.status().background_refresh,false);
    assert.equal(window.LampaQuality.status().refresh_on_visit,true);
    assert.equal(parserCalls,0,'Hidden films must not trigger JacRed searches');
    assert.equal(requests.length,0,'Hidden films must not request even SQL');

    intersection.trigger(true);
    await pause(250);
    assert.equal(badges[0].textContent,'TS','Show old cached TS immediately');
    assert.equal(parserCalls,1,'Visible stale movie rechecks via JacRed');

    intersection.trigger(false);
    intersection.trigger(true);
    assert.equal(parserCalls,1,'Repeated rendering must deduplicate in-flight work');
    timers.find(t=>t.interval===60000).fn();
    assert.equal(parserCalls,1,'Default-off periodic sweep does nothing');

    callbacks[0].callback({Results:[{Title:'Sample Film 2025 WEB-DL 1080p'}]});
    assert.equal(badges[0].textContent,'FHD','Update the visible badge without reload');
    await pause(360);
    assert.ok(requests.some(r=>r.op==='put_batch'),'Save fresh quality to SQL');

    intersection.trigger(false);
    offset=6*day;
    timers.find(t=>t.interval===60000).fn();
    assert.equal(parserCalls,1,'After TTL, an off-screen film is still not queried');
    intersection.trigger(true);
    assert.equal(badges[0].textContent,'FHD','Stale FHD remains until the next result');
    assert.equal(parserCalls,2,'Returning after the soft TTL triggers an immediate recheck');
    callbacks[1].callback({Results:[{Title:'Sample Film 2025 WEB-DL 2160p'}]});
    assert.equal(badges[0].textContent,'4K','Replace FHD with 4K when available');

    intersection.trigger(false);
    offset=17*day;
    intersection.trigger(true);
    assert.equal(badges[0].textContent,'4K','4K remains visible during an overdue recheck');
    assert.equal(parserCalls,3);
    // A parser failure must not erase the old confirmed badge.
    callbacks[2].callback(null);
    assert.equal(badges[0].textContent,'4K','Failed JacRed lookup retains 4K');

    console.log('Quality: default-off periodic, viewport return, SWR upgrades and failure retention OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
