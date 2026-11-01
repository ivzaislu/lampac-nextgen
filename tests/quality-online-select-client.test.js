'use strict';
// Reproduce user's browser state: Lampa.Filter wrapper is present, but the
// actual Online plugin captured the original Filter before Quality loaded.
// Native Lampa.Select listener must add the option when its menu opens.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const plugin=fs.readFileSync(path.join(__dirname,'../Modules/Quality/plugin.js'),'utf8');
const pause=ms=>new Promise(done=>setTimeout(done,ms));

const store=new Map(),selectEvents={},events={},settingsListeners={},params=[];
const counters={sortOpens:0};
const button={
    length:1,
    trigger(type) {
        assert.equal(type,'hover:enter');
        counters.sortOpens++;
    },
    find(selector) {
        assert.equal(selector,'span');
        return {text(){return 'Балансер';}};
    },
    last(){return this;},
    filter(){return this;}
};
const view={find(selector){
    assert.equal(selector,'.filter--sort');
    return button;
}};
let active={component:'online',movie:{id:99},activity:{render(){return view;}}};
function NativeFilter(){
    this.data={filter:[],sort:[]};
}
NativeFilter.prototype.set=function(type,items){this.data[type]=items;};
NativeFilter.prototype.get=function(type){return this.data[type];};
NativeFilter.prototype.chosen=function(){};
const CapturedOldFilter=NativeFilter;
const L={
    Filter:NativeFilter,
    Select:{
        listener:{follow(event,fn){selectEvents[event]=fn;}},
        close(){}
    },
    Lang:{translate(key){
        if(key==='filter_filtred')return 'Фильтрация';
        if(key==='online_balanser')return 'Балансер';
        return key;
    }},
    Activity:{active(){return active;}},
    Listener:{follow(name,fn){events[name]=fn;}},
    Storage:{
        field(name){return name==='parser_torrent_type'?'disabled':'';},
        get(name,def){return store.has(name)?store.get(name):def;},
        set(name,value){store.set(name,value);},
        listener:{follow(name,fn){settingsListeners[name]=fn;}}
    },
    Parser:{get(){throw Error('No quality lookups expected');}},
    SettingsApi:{addComponent(){},addParam(value){params.push(value);}}
};
const win={Lampa:L,$(selector){
    assert.equal(selector,'.filter--sort');
    return button;
}};
const doc={
    body:{},
    querySelectorAll(){return[];},
    head:{appendChild(){}},
    createElement(){return{className:'',textContent:''};}
};
class Mutation{observe(){}}
vm.runInNewContext(plugin,{window:win,document:doc,console,
    setTimeout,clearTimeout,
    setInterval(){return{unref(){}};},
    MutationObserver:Mutation,
}, {filename:'quality-native-select.js'});

(async()=>{
    const initial=win.LampaQuality.status();
    assert.equal(initial.online_filter_hook,true);
    assert.equal(initial.online_filters_detected,0,
        'Constructors created before Quality cannot be seen by the wrapper');
    assert.equal(initial.online_select_hook,true);
    assert.equal(initial.online_select_inserted,0);
    assert.equal(typeof selectEvents.preshow,'function');

    // This instance is deliberately created using the original reference.
    const old=new CapturedOldFilter({component:'online',movie:{id:99}});
    const reset={title:'Сброс',reset:true},voice={title:'Озвучка',stype:'voice',
        items:[{title:'Первый',index:0}]},season={title:'Сезон',stype:'season',
        items:[{title:'1',index:0}]};
    old.set('filter',[reset,voice,season]);
    old.set('sort',[
        {title:'Filmix',source:'filmix'},
        {title:'Rezka',source:'rezka'}
    ]);
    const menu={
        title:'Фильтрация',
        items:old.get('filter'),
        onSelect(){throw Error('Fallback shortcut must not invoke the voice filter');}
    };
    selectEvents.preshow({active:menu});
    assert.deepEqual(menu.items.map(x=>x.title),
        ['Сброс','Источник','Озвучка','Сезон']);
    assert.equal(menu.items[1].qualityOnlineSelectShortcut,true);
    assert.equal(menu.items[1].bal,true,'Shortcut follows the supplied standalone plugin contract');
    assert.equal(typeof menu.items[1].onSelect,'function');
    assert.equal(win.LampaQuality.status().online_select_inserted,1);
    assert.equal(win.LampaQuality.status().online_filters_detected,1);
    assert.equal(counters.sortOpens,0);
    menu.items[1].onSelect();
    await pause(10);
    assert.equal(counters.sortOpens,1,
        'The shortcut must invoke the existing native balancer menu');

    // Opening the same filter again must not duplicate entries.
    selectEvents.preshow({active:menu});
    assert.equal(menu.items.filter(x=>x.qualityOnlineSelectShortcut).length,1);
    assert.equal(menu.items.length,4);

    store.set('quality_module_online_source_filter',false);
    selectEvents.preshow({active:menu});
    assert.deepEqual(menu.items.map(x=>x.title),['Сброс','Озвучка','Сезон']);
    assert.equal(counters.sortOpens,1);
    store.set('quality_module_online_source_filter',true);

    // Filter menu isn't a torrent/setting/search selection.
    active={component:'torrents',movie:{id:99},activity:{render(){return view;}}};
    selectEvents.preshow({active:menu});
    assert.equal(menu.items.length,3);
    active={component:'online',movie:{id:99},activity:{render(){return view;}}};
    const unrelated={title:'Sort',items:[reset,voice,season]};
    selectEvents.preshow({active:unrelated});
    assert.equal(unrelated.items.length,3);
    const balancerPopup={title:'Балансер',items:[
        {title:'Filmix',source:'filmix'},{title:'Rezka',source:'rezka'}]};
    selectEvents.preshow({active:balancerPopup});
    assert.equal(balancerPopup.items.length,2);

    // Native constructor interception and Select fallback may both work.
    const normal=new L.Filter({component:'online',movie:{id:99}});
    normal.set('filter',[reset,voice,season]);
    normal.set('sort',[
        {title:'Filmix',source:'filmix',selected:true},
        {title:'Rezka',source:'rezka',selected:false}
    ]);
    const already={title:'Фильтрация',items:normal.get('filter')};
    assert.equal(already.items.filter(x=>x.qualityOnlineSource).length,1);
    assert.equal(already.items[1].bal,true);
    selectEvents.preshow({active:already});
    assert.equal(already.items.filter(x=>x.qualityOnlineSource).length,1);
    assert.equal(already.items.filter(x=>x.qualityOnlineSelectShortcut).length,0);

    // Asynchronous switch is cancelled after navigating away.
    const asyncMenu={title:'Фильтрация',items:[reset,voice,season]};
    selectEvents.preshow({active:asyncMenu});
    const late=asyncMenu.items[1];
    late.onSelect();
    active={component:'full',movie:{id:99},activity:{render(){return view;}}};
    await pause(10);
    assert.equal(counters.sortOpens,1,'No balancer switch after navigation');
    console.log('Quality: real Select.preshow fallback for preloaded Online filters OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
