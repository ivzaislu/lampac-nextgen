'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../Modules/Quality/plugin.js'), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Lampa's Online and Online Prestige both make new Lampa.Filter(object) and
// set('filter', [Reset, Voice, Season]) before set('sort', balancers).
// Their native onSelect('sort', {source: 'rezka'}) changes providers.
function FakeFilter(params) {
    this.params = params;
    this.data = {sort: [], filter: []};
    this.chosenText = {};
}
FakeFilter.prototype.set = function(type, items) {this.data[type] = items;};
FakeFilter.prototype.get = function(type) {return this.data[type];};
FakeFilter.prototype.chosen = function(type, text) {this.chosenText[type] = text;};

const values = new Map(), storageListeners = {}, appListeners = {}, params = [];
let hooks = 0;
const L = {
    Filter: FakeFilter,
    Storage: {
        get(name, fallback) {return values.has(name) ? values.get(name) : fallback;},
        set(name, value) {values.set(name, value);},
        field(name) {
            return name === 'parser_torrent_type' ? 'disabled' : '';
        },
        listener: {follow(name, fn) {storageListeners[name] = fn;}}
    },
    Parser: {get() {throw Error('Source filter must not query JacRed');}},
    Listener: {follow(name,fn) {appListeners[name] = fn;}},
    SettingsApi: {
        addComponent() {},
        addParam(param) {params.push(param);}
    }
};
const document = {
    body: {},
    currentScript: {src: 'https://local.example.invalid/quality.js'},
    querySelectorAll() {return [];},
    createElement() {return {textContent: ''};},
    head: {appendChild() {}}
};
const win = {Lampa:L};
class Mutation {observe() {}}
vm.runInNewContext(script, {window:win,document,MutationObserver:Mutation,
    setTimeout,clearTimeout,
    setInterval() {return {unref(){}};},
    console
}, {filename:'quality-online-filter.js'});
assert.equal(win.LampaQuality.status().online_source_filter,true);
assert.equal(win.LampaQuality.status().online_filter_hook,true);
assert.notEqual(L.Filter,FakeFilter,'Bridge must be installed once');

function menu(component) {
    const filter = new L.Filter({component, movie:{id:77}, search:'Movie'});
    const calls = [], initialFilter = [
        {title:'Сброс',reset:true},
        {title:'Озвучка',stype:'voice',items:[{title:'Оригинал',index:0}]},
        {title:'Сезон',stype:'season',items:[{title:'Сезон 1',index:0}]}
    ];
    const balancers=[
        {title:'Filmix',source:'filmix',selected:true},
        {title:'Rezka',source:'rezka',selected:false},
        {title:'Collaps',source:'collaps',selected:false}
    ];
    filter.onSelect = function(type,item,choice) {
        calls.push({type,item,choice});
        if(type==='sort') {
            values.set('online_balanser',item.source);
            balancers.forEach(src=>{src.selected=src.source===item.source;});
            filter.set('sort',balancers.slice());
        }
    };
    filter.set('filter',initialFilter);
    filter.set('sort',balancers.slice());
    filter.chosen('filter',['Озвучка: Оригинал','Сезон: 1']);
    return {filter,calls,initialFilter,balancers};
}
(async ()=>{
    const legacy=menu('online');
    const select=legacy.filter.get('filter');
    assert.equal(select.length,4,'Source should join Reset / Voice / Season');
    assert.ok(select[0].reset,'Reset remains at the first position');
    assert.equal(select[1].title,'Источник / балансер');
    assert.equal(select[1].subtitle,'Filmix');
    assert.deepEqual(select.slice(2).map(x=>x.stype),['voice','season']);
    assert.deepEqual(select[1].items.map(x=>x.source),['filmix','rezka','collaps']);
    assert.equal(select[1].items.filter(x=>x.selected).length,1);
    assert.equal(select[1].items[0].source,'filmix');
    assert.equal(legacy.filter.get('sort').length,3,'Native sort menu must stay');
    assert.equal(legacy.filter.chosenText.filter.length,3);
    assert.equal(legacy.filter.chosenText.filter[2],'Источник: Filmix');

    // Voice/season still go to provider's original onSelect('filter').
    legacy.filter.onSelect('filter',select[2],{index:0});
    legacy.filter.onSelect('filter',select[3],{index:0});
    assert.deepEqual(legacy.calls.map(x=>x.type),['filter','filter']);

    legacy.filter.onSelect('filter',select[1],select[1].items[1]);
    assert.equal(legacy.calls.length,2,'Switch deferred until native submenu reopens');
    await pause(15);
    assert.equal(legacy.calls[2].type,'sort');
    assert.equal(legacy.calls[2].item.source,'rezka');
    assert.equal(values.get('online_balanser'),'rezka');
    assert.equal(legacy.filter.get('filter')[1].subtitle,'Rezka');
    assert.equal(legacy.filter.chosenText.filter[2],'Источник: Rezka');

    // Online Prestige has the same contract, but may handle per-movie voice
    // history in its onSelect('sort'); the bridge forwards to that handler.
    const prestige=menu('online_prestige');
    const pentry=prestige.filter.get('filter')[1];
    prestige.filter.onSelect('filter',pentry,pentry.items[2]);
    await pause(15);
    assert.equal(prestige.calls[0].type,'sort');
    assert.equal(prestige.calls[0].item.source,'collaps');
    assert.deepEqual(prestige.filter.get('filter').slice(2).map(x=>x.stype),['voice','season']);

    // Off is live, not only on next navigation; existing filters are left
    // structurally intact and their native sort choice remains usable.
    values.set('quality_module_online_source_filter',false);
    storageListeners.change({name:'quality_module_online_source_filter'});
    assert.equal(prestige.filter.get('filter').length,3);
    assert.equal(prestige.filter.get('sort').length,3);
    assert.equal(prestige.filter.chosenText.filter.length,2);
    assert.equal(win.LampaQuality.status().online_source_filter,false);
    const storedCount=prestige.calls.length;
    prestige.filter.onSelect('filter',pentry,pentry.items[0]);
    await pause(10);
    assert.equal(prestige.calls.length,storedCount,'Old shortcut disabled too');

    values.set('quality_module_online_source_filter',true);
    storageListeners.change({name:'quality_module_online_source_filter'});
    assert.equal(prestige.filter.get('filter')[1].title,'Источник / балансер');
    assert.equal(win.LampaQuality.status().online_source_filter,true);
    const setting=params.filter(x=>x.param.name==='quality_module_online_source_filter');
    assert.equal(setting.length,1);
    assert.equal(setting[0].param.default,true);

    // Other Lampa components (torrent/search) are never patched.
    const torrent=menu('torrent');
    assert.equal(torrent.filter.get('filter').length,3);
    assert.equal(torrent.filter.chosenText.filter.length,2);
    const unexpected=menu('other');
    assert.equal(unexpected.filter.get('filter').length,3);
    const unpopulated=new L.Filter({component:'online'});
    unpopulated.set('filter',[{title:'Reset',reset:true}]);
    unpopulated.set('sort',[]);
    assert.equal(unpopulated.get('filter').length,1);
    assert.equal(unpopulated.get('sort').length,0);

    // Existing instance remains idempotent when script is injected twice.
    vm.runInNewContext(script,{window:win,document,MutationObserver:Mutation,
        setTimeout,clearTimeout,setInterval(){return {unref(){}};},console},
        {filename:'quality-online-filter-duplicate.js'});
    assert.equal(L.Filter.__qualityOnlineBridge,true);
    assert.equal(params.filter(x=>x.param.name==='quality_module_online_source_filter').length,1);
    console.log('Quality online: native balancer shortcut, translation/season, toggle, isolation and idempotency OK');
})().catch(err=>{console.error(err);process.exitCode=1;});
