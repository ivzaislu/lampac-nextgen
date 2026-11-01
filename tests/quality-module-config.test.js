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
assert.equal(off.components.length,1);
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
assert.ok(partial.params.some(p=>p.param.name==='quality_module_enabled'));
assert.ok(!partial.params.some(p=>p.param.name==='quality_buttons_pencil'));
assert.ok(!partial.params.some(p=>p.param.name==='quality_module_background'));
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
assert.ok(defaultConfig.params.some(p=>p.param.name==='quality_buttons_pencil'));
assert.ok(defaultConfig.params.some(p=>p.param.name==='quality_module_background'));
assert.equal(defaultConfig.timerCalls(),1,'Legacy install retains background refresh timer');
assert.equal(defaultConfig.local.has('quality_module_sql_scope_v1'),true);

const allOff=launch({collect:false,background:false,
    onlinefilter:false,buttons:false,sqlcache:false});
assert.equal(allOff.components.length,0,'No empty Quality settings panel when every feature is off');
assert.equal(allOff.params.length,0);
assert.equal(allOff.parserCalls(),0);
assert.equal(allOff.timerCalls(),0);
console.log('Quality init flags: collector, background, SQL, Online and pencil isolation OK');
