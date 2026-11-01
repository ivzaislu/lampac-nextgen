'use strict';
// Server-side init.conf feature flags must preserve independent client features.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname,
    '../Modules/Quality/plugin.js'),'utf8');

function launch(options) {
    const params=[], components=[], handlers={},local=new Map();
    let parserCalls=0, timerCalls=0, sqlCalls=0, mutationCalls=0;
    const body={contains(){return false;}};
    const doc={
        body, currentScript:{src:'http://localhost:9118/quality.js'},
        head:{appendChild(){}},
        createElement(){return {textContent:''};},
        querySelectorAll(){return [];}
    };
    const L={
        Parser:{get(){parserCalls++;throw Error('No parser request expected in this test');}},
        SettingsApi:{
            addComponent(x){components.push(x);},
            addParam(x){params.push(x);}
        },
        Storage:{
            field(k){return {
                parser_torrent_type:'jackett',
                jackett_url:'http://parser.invalid',
                parser_use_link:'one'
            }[k]||'';},
            get(k,f){return local.has(k)?local.get(k):f;},
            set(k,v){local.set(k,v);},
            listener:{follow(n,fn){handlers['storage:'+n]=fn;}}
        },
        Listener:{follow(n,fn){handlers[n]=fn;}}
    };
    const win={
        Lampa:L,
        __qualityModuleOptions:options,
        fetch(){sqlCalls++;throw Error('SQL calls not expected');},
        crypto:{getRandomValues(bytes){bytes.fill(7);return bytes;}}
    };
    class MutationObserver {
        constructor(){mutationCalls++;}
        observe(){}
    }
    vm.runInNewContext(script,{window:win,document:doc,MutationObserver,
        setInterval(){timerCalls++;return 1;},
        setTimeout(){return 1;},
        clearTimeout(){},clearInterval(){},console,Uint8Array});
    return {
        win,L,params,components,handlers,local,
        parserCalls:()=>parserCalls,timerCalls:()=>timerCalls,
        sqlCalls:()=>sqlCalls,mutationCalls:()=>mutationCalls
    };
}

const off=launch({collect:false,background:false,
    onlinefilter:true,buttons:true,sqlcache:false});
assert.equal(off.win.LampaQuality.status().server_collect,false);
assert.equal(off.win.LampaQuality.status().server_buttons,true);
assert.equal(off.win.LampaQuality.status().server_onlinefilter,true);
assert.equal(off.win.LampaQuality.status().configured,false);
assert.equal(off.win.LampaQuality.status().sql_cache,false);
assert.equal(off.win.LampaQuality.status().background_refresh,false);
assert.deepEqual(off.params.map(p=>p.param.name),['quality_buttons_pencil'],
    'Turning off the collector keeps pencil settings but hides collector controls');
assert.deepEqual(off.components.map(c=>c.component), ['quality_other'],
    'Without collector, only the Other section is registered');
assert.equal(off.params[0].component,'quality_other',
    'Pencil control belongs to Other even when collector is disabled');
assert.equal(off.parserCalls(),0);
assert.equal(off.sqlCalls(),0);
assert.equal(off.timerCalls(),0);
assert.equal(off.mutationCalls(),0,'Disabled collector must not observe every Lampa DOM change');
assert.equal(off.handlers.full,undefined,'Disabled collector must not hook Full loads');

const partial=launch({collect:true,background:false,
    onlinefilter:false,buttons:false,sqlcache:false});
assert.equal(partial.win.LampaQuality.status().configured,true);
assert.equal(partial.win.LampaQuality.status().server_collect,true);
assert.equal(partial.win.LampaQuality.status().server_onlinefilter,false);
assert.equal(partial.win.LampaQuality.status().server_buttons,false);
assert.equal(partial.win.LampaQuality.status().server_sqlcache,false);
assert.equal(partial.win.LampaQuality.status().sql_cache,false);
assert.equal(partial.win.LampaQuality.status().online_source_filter,false);
assert.equal(partial.win.LampaQuality.status().background_refresh,false);
assert.equal(partial.win.LampaQuality.status().refresh_on_visit,true);
assert.deepEqual(partial.components.map(c=>c.component), ['quality'],
    'Collector-only server config must not create an empty Other section');
assert.ok(partial.params.some(p=>p.param.name==='quality_module_enabled'));
assert.ok(!partial.params.some(p=>p.param.name==='quality_buttons_pencil'));
assert.ok(!partial.params.some(p=>p.param.name==='quality_module_periodic_refresh'));
assert.ok(partial.params.some(p=>p.param.name==='quality_module_refresh_on_visit'),
    'On-visit refresh is independent of the periodic collector server flag');
assert.ok(!partial.params.some(p=>p.param.name==='quality_module_refresh_minutes'),
    'No background interval control when server disabled background refresh');
assert.ok(!partial.params.some(p=>p.param.name==='quality_module_batch_size'),
    'No SQL batch option when server disabled SQL');
assert.ok(partial.handlers.full);
assert.equal(partial.timerCalls(),0,'init.conf background=false must disable periodic collector timer');
assert.equal(partial.sqlCalls(),0,'SQL disabled in init.conf must not reach backend');
assert.equal(partial.local.has('quality_module_sql_scope_v1'),false,
    'SQL scope must not be created when SQL cache is server-disabled');

const defaultConfig=launch(undefined);
assert.equal(defaultConfig.win.LampaQuality.status().server_collect,true);
assert.equal(defaultConfig.win.LampaQuality.status().server_buttons,true);
assert.equal(defaultConfig.win.LampaQuality.status().server_onlinefilter,true);
assert.equal(defaultConfig.win.LampaQuality.status().server_sqlcache,true);
assert.equal(defaultConfig.win.LampaQuality.status().configured,true);
assert.deepEqual(defaultConfig.components.map(c=>c.component),
    ['quality','quality_other'],'Quality and Other must appear as separate Settings sections');
assert.equal(defaultConfig.components[0].name,'Quality — качество');
assert.equal(defaultConfig.components[1].name,'Quality — другое');
assert.equal(defaultConfig.components[1].after,'quality');
assert.ok(defaultConfig.params.every(p => p.component ===
    (p.param.name === 'quality_buttons_pencil' ? 'quality_other' : 'quality')),
    'All badge/cache controls stay in Quality while pencil moves to Other');
assert.ok(defaultConfig.params.some(p=>p.param.name==='quality_buttons_pencil'));
assert.ok(defaultConfig.params.some(p=>p.param.name==='quality_module_periodic_refresh'));
assert.ok(defaultConfig.params.some(p=>p.param.name==='quality_module_refresh_on_visit'));
assert.equal(defaultConfig.win.LampaQuality.status().background_refresh,false,
    'Periodic refresh is opt-in even for upgraded installations');
assert.equal(defaultConfig.win.LampaQuality.status().refresh_on_visit,true);
defaultConfig.local.set('quality_module_background',true);
assert.equal(defaultConfig.win.LampaQuality.status().background_refresh,false,
    'Old Lampa background=true must not migrate to the new default-off control');
defaultConfig.local.set('quality_module_periodic_refresh',true);
assert.equal(defaultConfig.win.LampaQuality.status().background_refresh,true,
    'Opting in to the new setting enables periodic refresh');
assert.equal(defaultConfig.timerCalls(),1,'Periodic timer exists but makes no requests until enabled');
assert.equal(defaultConfig.local.has('quality_module_sql_scope_v1'),true);

const buttonsOnly=launch({collect:false,background:false,
    onlinefilter:false,buttons:true,sqlcache:false});
assert.deepEqual(buttonsOnly.components.map(c=>c.component),['quality_other']);
assert.equal(buttonsOnly.components[0].after,'parser');
assert.deepEqual(buttonsOnly.params.map(p=>p.param.name),['quality_buttons_pencil']);

const onlineOnly=launch({collect:false,background:false,
    onlinefilter:true,buttons:false,sqlcache:false});
assert.deepEqual(onlineOnly.components.map(c=>c.component),['quality_other'],
    'Online-only mode has a host for the filter settings provided by online-filter.js');
assert.equal(onlineOnly.params.length,0,
    'Online filter control is separately provided by online-filter.js');

const allOff=launch({collect:false,background:false,
    onlinefilter:false,buttons:false,sqlcache:false});
assert.equal(allOff.components.length,0,'No empty Quality settings panel when every feature is off');
assert.equal(allOff.params.length,0);
assert.equal(allOff.parserCalls(),0);
assert.equal(allOff.timerCalls(),0);
console.log('Quality init flags: collector, background, SQL, Online and pencil isolation OK');
