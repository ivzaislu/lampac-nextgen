'use strict';
// Lifecycle of the same title on poster and full page while asynchronous
// JacRed responses arrive after disabling/re-enabling Quality.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../Modules/Quality/plugin.js'),'utf8');

const requests=[],listeners={},storageListeners={},store=new Map();
const config={
    parser_torrent_type:'jackett',
    parser_use_link:'one',
    jackett_url:'https://first.example.invalid'
};
function makeView(){
    const badges=[];
    const node={
        querySelector(selector){return selector==='.quality-module-badge' ? badges[0]||null : null;},
        appendChild(el){
            badges.push(el);
            el.remove=()=>{
                const i=badges.indexOf(el);
                if(i>=0)badges.splice(i,1);
            };
        }
    };
    return {node,badges};
}
const poster=makeView(),full=makeView();
const movie={id:10,title:'Example',original_title:'Example',release_date:'2025-01-01'};
const card={
    card_data:movie,
    querySelector(s){
        if(s==='.card__view')return poster.node;
        return s==='.quality-module-badge' ? poster.node.querySelector(s) : null;
    }
};
const fullPage={querySelector(s){return s==='.full-start-new__rate-line'?full.node:null;}};
const document={
    body:{contains(node){return node===card||node===fullPage;}},
    head:{appendChild(){}},
    querySelectorAll(s){return s==='.card'?[card]:[];},
    createElement(){return {className:'',textContent:''};}
};
const w={Lampa:{
    Storage:{
        field(name){return config[name]||'';},
        get(name,def){return store.has(name)?store.get(name):def;},
        set(name,v){store.set(name,v);},
        listener:{follow(name,fn){storageListeners[name]=fn;}}
    },
    Parser:{get(request,done,fail){requests.push({request,done,fail});}},
    Listener:{follow(name,fn){listeners[name]=fn;}}
}};
class Visible{
    constructor(cb){this.cb=cb;}
    observe(n){this.cb([{isIntersecting:true,target:n}]);}
    unobserve(){}
}
class Mutation{observe(){}}
vm.runInNewContext(source,{window:w,document,console,setTimeout,clearTimeout,
    setInterval(){return{unref(){}};},
    IntersectionObserver:Visible,MutationObserver:Mutation},
    {filename:'quality-lifecycle.js'});

assert.equal(requests.length,1,'Initial poster schedules a parser request');
listeners.full({type:'complite',data:{movie},body:[fullPage]});
assert.equal(requests.length,1,'The full page shares the pending request');
store.set('quality_module_enabled',false);
storageListeners.change({name:'quality_module_enabled'});
assert.equal(poster.badges.length,0);
assert.equal(full.badges.length,0);
assert.equal(w.LampaQuality.status().configured,false);

store.set('quality_module_enabled',true);
storageListeners.change({name:'quality_module_enabled'});
assert.equal(requests.length,2,'Re-enable resumes detection without navigating away');
assert.equal(poster.badges.length,0,'Old badge is hidden until fresh result');
assert.equal(full.badges.length,0);
requests[0].done({Results:[{Title:'Example (2025) 4K 2160p'}]});
assert.equal(poster.badges.length,0,'Disabled source response cannot redraw poster');
assert.equal(full.badges.length,0,'Disabled source response cannot redraw full page');

requests[1].done({Results:[{Title:'Example (2025) 1080p'}]});
assert.equal(poster.badges[0].textContent,'FHD');
assert.equal(full.badges[0].textContent,'FHD');

config.jackett_url='https://second.example.invalid';
storageListeners.change({name:'jackett_url'});
assert.equal(requests.length,3,'Source change requires a fresh parser result');
assert.equal(poster.badges.length,0,'Stale poster label removed on source change');
assert.equal(full.badges.length,0,'Stale full-page label removed on source change');
requests[2].done({Results:[{Title:'Example (2025) 4K 2160p'}]});
assert.equal(poster.badges[0].textContent,'4K');
assert.equal(full.badges[0].textContent,'4K');

config.parser_torrent_type='prowlarr';
storageListeners.change({name:'parser_torrent_type'});
assert.equal(poster.badges.length,0,'Turning off JacRed removes poster badge');
assert.equal(full.badges.length,0,'Turning off JacRed removes full-page badge');
assert.equal(requests.length,3);
assert.equal(w.LampaQuality.status().configured,false);
console.log('Quality: poster/full lifecycle, disable/re-enable, stale response and source switch OK');
