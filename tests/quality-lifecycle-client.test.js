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
    const badges=[],classes=new Set();
    // CUB's own quality label must survive the Quality overlay lifecycle.
    const nativeBadge={className:'card__quality',textContent:'DL'};
    const node={
        classList:{
            add(name){classes.add(name);},
            remove(name){classes.delete(name);},
            contains(name){return classes.has(name);}
        },
        querySelector(selector){
            if(selector==='.quality-module-badge')return badges[0]||null;
            if(selector==='.card__quality')return nativeBadge;
            return null;
        },
        appendChild(el){
            badges.push(el);
            el.remove=()=>{
                const i=badges.indexOf(el);
                if(i>=0)badges.splice(i,1);
            };
        }
    };
    return {node,badges,nativeBadge};
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
assert.equal(poster.node.classList.contains('quality-module-replaces-native'),false,
    'Disabling Quality restores the native/CUB quality label');
assert.equal(poster.node.querySelector('.card__quality'),poster.nativeBadge,
    'The native quality element must never be removed');
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
assert.equal(poster.node.classList.contains('quality-module-replaces-native'),true,
    'Quality's own FHD badge must replace the overlapping native label');
assert.equal(poster.node.querySelector('.card__quality'),poster.nativeBadge,
    'Keep the native badge available for later restoration');
assert.ok(source.includes(
    '.card__view.quality-module-replaces-native .card__quality:not(.quality-module-badge){display:none!important;}'),
    'Scoped CSS must hide only other quality badges while Quality is present');

config.jackett_url='https://second.example.invalid';
storageListeners.change({name:'jackett_url'});
assert.equal(requests.length,3,'Source change requires a fresh parser result');
assert.equal(poster.badges.length,0,'Stale poster label removed on source change');
assert.equal(full.badges.length,0,'Stale full-page label removed on source change');
assert.equal(poster.node.classList.contains('quality-module-replaces-native'),false,
    'Source changes restore native quality until the new result arrives');
requests[2].done({Results:[{Title:'Example (2025) 4K 2160p'}]});
assert.equal(poster.badges[0].textContent,'4K');
assert.equal(full.badges[0].textContent,'4K');
assert.equal(poster.node.classList.contains('quality-module-replaces-native'),true,
    'Replacement resumes after the new source returns quality');

config.parser_torrent_type='prowlarr';
storageListeners.change({name:'parser_torrent_type'});
assert.equal(poster.badges.length,0,'Turning off JacRed removes poster badge');
assert.equal(full.badges.length,0,'Turning off JacRed removes full-page badge');
assert.equal(poster.node.classList.contains('quality-module-replaces-native'),false,
    'Turning off JacRed must reveal the original native label');
assert.equal(requests.length,3);
assert.equal(w.LampaQuality.status().configured,false);

// When no acceptable release exists, CUB remains visible: only a Quality
// result is allowed to suppress an existing native quality mark.
config.parser_torrent_type='jackett';
config.jackett_url='https://third.example.invalid';
storageListeners.change({name:'parser_torrent_type'});
assert.equal(requests.length,4);
requests[3].done({Results:[]});
assert.equal(poster.badges.length,0,'No Quality match means no custom badge');
assert.equal(poster.node.classList.contains('quality-module-replaces-native'),false,
    'No matching quality must leave the native CUB label available');
assert.equal(poster.node.querySelector('.card__quality'),poster.nativeBadge);
console.log('Quality: poster/full lifecycle, native badge replacement and restoration OK');
