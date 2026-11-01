'use strict';
// Regression for the separate button editor: settings, safe DOM changes and remote focus.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../Modules/Quality/buttons.js'),'utf8');

function node(classes,children){
    const o={classes:new Set(classes.split(' ').filter(Boolean)),attrs:{},
        children:children||[],style:{order:''},events:{},textValue:''};
    o.children.forEach(x=>{x.parent=o;}); return o;
}
function matches(n,s){return s.charAt(0)==='.' && n.classes.has(s.slice(1));}
class Q {
    constructor(nodes){this.nodes=nodes.filter(Boolean);this.length=this.nodes.length;
        for(let i=0;i<this.nodes.length;i++)this[i]=this.nodes[i];}
    first(){return new Q(this.nodes.slice(0,1));}
    parent(){return new Q([this.nodes[0] && this.nodes[0].parent]);}
    hasClass(name){return !!this.nodes[0] && this.nodes[0].classes.has(name);}
    addClass(names){this.nodes.forEach(n=>names.split(' ').forEach(x=>n.classes.add(x)));return this;}
    find(selector){
        const s=selector.split(/\s+/).pop(),results=[];
        function walk(n){n.children.forEach(x=>{if(matches(x,s)||s==='span'&&x.tag==='span')results.push(x);walk(x);});}
        this.nodes.forEach(walk);return new Q(results);
    }
    children(selector){
        const list=this.nodes.flatMap(x=>x.children);
        return new Q(selector?list.filter(x=>selector.split(',').some(part=>matches(x,part.trim()))):list);
    }
    not(selectors){const excluded=selectors.split(',').map(s=>s.trim());
        return new Q(this.nodes.filter(x=>!excluded.some(s=>matches(x,s))));}
    each(fn){this.nodes.forEach((n,i)=>fn.call(n,i,n));return this;}
    attr(k,v){if(v===undefined){
            if(k==='class')return this[0]?Array.from(this[0].classes).join(' '):'';
            return this[0]?.attrs[k]||'';
        }
        this.nodes.forEach(n=>n.attrs[k]=String(v));return this;}
    css(k,v){if(v===undefined)return this[0]?.style[k]||'';
        this.nodes.forEach(n=>n.style[k]=String(v));return this;}
    text(v){if(v===undefined)return this.nodes.map(n=>n.textValue).join('');
        this.nodes.forEach(n=>n.textValue=v);return this;}
    toggleClass(c,enabled){this.nodes.forEach(n=>{if(enabled)n.classes.add(c);else n.classes.delete(c);});return this;}
    removeClass(names){this.nodes.forEach(n=>names.split(' ').forEach(s=>n.classes.delete(s)));return this;}
    on(events,fn){this.nodes.forEach(n=>events.split(/\s+/).forEach(k=>n.events[k]=fn));return this;}
    off(namespace){this.nodes.forEach(n=>Object.keys(n.events).forEach(k=>{
        if(k.endsWith(namespace))delete n.events[k];
    }));return this;}
    trigger(event){this.nodes.forEach(n=>Object.keys(n.events).forEach(k=>{
        if(k===event||k.startsWith(event+'.'))n.events[k].call(n,{target:n,type:event});
    }));return this;}
    append(item){this.nodes.forEach(n=>(item instanceof Q?item.nodes:[item]).forEach(x=>{
        if(x.parent)x.parent.children=x.parent.children.filter(a=>a!==x);
        n.children.push(x);x.parent=n;}));return this;}
    remove(){this.nodes.forEach(n=>{if(n.parent)n.parent.children=n.parent.children.filter(x=>x!==n);
        n.parent=null;});return this;}
}
function $(value){
    if(value instanceof Q)return value;
    if(typeof value==='string'){
        if(value.startsWith('<')){
            const m=value.match(/class="([^"]+)"/);
            const e=node(m?m[1]:'',[]);
            const span=value.includes('<span')?node('',[]):null;
            if(span){span.tag='span';span.parent=e;e.children.push(span);}
            return new Q([e]);
        }
        return new Q([]);
    }
    return new Q(Array.isArray(value)?value:[value]);
}
const movieButton=node('full-start__button view--online',[]);
const movieSpan=node('',[]);movieSpan.tag='span';movieSpan.textValue='Онлайн';
movieButton.children.push(movieSpan);movieSpan.parent=movieButton;
const torrentButton=node('full-start__button view--torrents',[]);
const torrentSpan=node('',[]);torrentSpan.tag='span';torrentSpan.textValue='Торренты';
torrentButton.children.push(torrentSpan);torrentSpan.parent=torrentButton;
const playButton=node('full-start__button button--play',[]);
const playSpan=node('',[]);playSpan.tag='span';playSpan.textValue='Воспроизвести';
playButton.children.push(playSpan);playSpan.parent=playButton;
const line=node('full-start-new__buttons',[movieButton,torrentButton,playButton]);
function nativeSource(type,title){
    const b=node('full-start__button selector '+type,[]);
    const label=node('',[]);label.tag='span';label.textValue=title;
    b.children.push(label);label.parent=b;
    b.events['hover:enter']=()=>{b.clicked=(b.clicked||0)+1;};
    return b;
}
const nativeTorrent=nativeSource('view--torrent','Торренты');
const nativeOnline=nativeSource('lampac--button','Онлайн');
const nativeTrailer=nativeSource('view--trailer','Трейлеры');
const sourceHolder=node('hide buttons--container',[nativeTorrent,nativeOnline,nativeTrailer]);
const page=node('full-page',[line,sourceHolder]);
// In actual Lampa, ActivitySlide.render() is an OUTER slide; the event.body
// of Full.complite is the nested Full component root, not that slide.
const slide=node('activity-slide',[page]);
const nativeStart={last:playButton}, fullComponent={items:[nativeStart]};
const storage=new Map(),events={},params=[],selected=[],selectParents=[];
let active={component:'full',activity:{component:fullComponent,render(){return $(slide);}}},
    focus='full_start',badToggles=0,nativeRestorations=0,selectOpened=false;
const L={Storage:{get(k,def){return storage.has(k)?storage.get(k):def;},set(k,v){storage.set(k,v);},
    listener:{follow(n,fn){events['storage:'+n]=fn;}}},
    Listener:{follow(n,fn){events[n]=fn;}},
    Activity:{active(){return active;}},
    Controller:{
        enabled(){return {name:focus};},
        toggle(name){
            if(name!=='settings_component' && name!=='full_start'){
                badToggles++;
                throw Error('Unexpected controller hijack: '+name);
            }
            nativeRestorations++;
            focus=name;
        }
    },
    SettingsApi:{addComponent(){},addParam(x){params.push(x);}},
    Select:{
        show(x){
            if(selectOpened)throw Error('Unexpected nested Select window');
            if(focus==='select')throw Error('Orphaned Select controller became parent');
            selectParents.push(focus);
            selected.push(Object.assign({},x,{
                // Native Select.bind() calls hide() BEFORE onSelect,
                // but the controller remains "select".
                onSelect(item){selectOpened=false;if(x.onSelect)x.onSelect(item);},
                onBack(){selectOpened=false;if(x.onBack)x.onBack();}
            }));
            selectOpened=true;
            focus='select';
        },
        opened(){return selectOpened;}
    },
    Input:{edit(x,cb){
        // Native Settings.Input.back() toggles settings_component first,
        // then runs the callback, even if Input was opened from Full.
        L.Controller.toggle('settings_component');
        cb('Избранное');
    }},
    Noty:{show(){}}
};
const document={body:{},head:{appendChild(){}},createElement(){return {};}};
const window={Lampa:L,$};
const mutations=[],deferred=[];
class Mutation{
    constructor(cb){this.cb=cb;this.targets=[];mutations.push(this);}
    observe(target,opts){this.targets.push(target);}
    disconnect(){this.targets=[];}
}
vm.runInNewContext(script,{window,document,console,
    setTimeout:(fn,ms)=>{
        if(ms===100){deferred.push(fn);return deferred.length;}
        return setTimeout(fn,ms);
    },clearTimeout,MutationObserver:Mutation});
const setting=(name)=>params.find(x=>x.param.name===name);
function openFromSettings(){
    // Real settings cannot click the button again while its Select is open.
    if(selectOpened)selected[selected.length-1].onBack();
    focus='settings_component';
    setting('quality_buttons_open').onChange();
    assert.equal(focus,'select');
    assert.equal(selectParents[selectParents.length-1],'settings_component',
        'The editor must open from native Settings, not a stale Select');
}
assert.equal(window.LampaQualityButtons.status().loaded,true);
assert.ok(setting('quality_buttons_open'));
assert.ok(setting('quality_buttons_pencil'));
assert.equal(setting('quality_buttons_pencil').param.default,false);
events.full({type:'complite',body:[page],link:fullComponent});
assert.equal(mutations.length,1,'The real Lampa full card must be observed for late plugins');
assert.strictEqual(nativeStart.last,nativeTorrent,
    'Native remembered focus cannot target Play after exposing sources');
assert.strictEqual(sourceHolder.parent,line,
    'Native Source folder must be unfolded on the full-card toolbar');
assert.equal(sourceHolder.classes.has('hide'),false);
assert.ok(line.classes.has('quality-buttons-ungrouped'));
assert.ok(playButton.classes.has('quality-buttons-play-hidden'),
    'Native Play source picker is hidden when source actions are visible');
assert.equal(nativeTorrent.attrs['data-quality-buttons-id'],'b:view--torrent');
assert.equal(nativeOnline.attrs['data-quality-buttons-id'],'b:lampac--button');
assert.equal(nativeTrailer.attrs['data-quality-buttons-id'],'b:view--trailer');
assert.strictEqual(sourceHolder.children[0],nativeTorrent,
    'Unfold uses original plugin nodes rather than clones');
$(nativeOnline).trigger('hover:enter');
assert.equal(nativeOnline.clicked,1,'Original Online click handler survives unfolding');
assert.strictEqual(nativeStart.last,nativeOnline,
    'Existing action focus is remembered without a Controller.toggle');
$(nativeTrailer).trigger('hover:focus');
assert.strictEqual(nativeStart.last,nativeTrailer,
    'TV remote navigation tracks focus for extracted native buttons');
assert.equal(badToggles,0,'Unfolding must not switch the TV controller');
const lateSource=nativeSource('view--added-plugin','Доп. источник');
sourceHolder.children.push(lateSource);lateSource.parent=sourceHolder;
const thirdParty=node('selector foreign-button',[]);
thirdParty.attrs['aria-label']='Сторонний плагин';
thirdParty.events['hover:enter']=()=>{thirdParty.clicked=(thirdParty.clicked||0)+1;};
line.children.push(thirdParty);thirdParty.parent=line;
// No explicit refresh: the MutationObserver must discover BOTH late sources.
mutations[0].cb();
assert.equal(deferred.length,1,'Late plugin insertion must schedule one refresh');
deferred.shift()();
assert.equal(lateSource.attrs['data-quality-buttons-id'],'b:view--added-plugin',
    'A source added after initial full render is also extracted');
$(lateSource).trigger('hover:enter');
assert.equal(lateSource.clicked,1,'Late plugin handler must remain bound');
assert.strictEqual(nativeStart.last,lateSource);
assert.ok(thirdParty.attrs['data-quality-buttons-id'],
    'Plugin-only .selector button must be discovered even without .full-start__button');
openFromSettings();
assert.ok(selected[selected.length-1].items.some(item=>item.title==='Сторонний плагин'),
    'Editor reflects buttons from other plugins added after full:complite');
$(thirdParty).trigger('hover:enter');
assert.equal(thirdParty.clicked,1,'Never replace a third-party click handler');
assert.equal(Object.keys(nativeOnline.events)
    .filter(k=>k.endsWith('.qualityButtonsFocus')).length,4,
    'Repeated refresh must never duplicate custom focus hooks');
assert.equal(movieButton.style.order,'');
assert.equal(torrentButton.style.order,'',
    'Native order must remain untouched before the user customizes it');
assert.equal(playButton.attrs['data-quality-buttons-id'],undefined,
    'Protected native Play button cannot be reordered or hidden');
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-pencil')).length,0,
    'Pencil should not take remote focus by default');
openFromSettings();
let editor=selected[selected.length-1];
assert.equal(editor.title,'Настройка кнопок');
editor.onSelect(editor.items[0]);
let actions=selected[selected.length-1];
actions.onSelect(actions.items.find(x=>x.action==='visibility'));
assert.ok(movieButton.classes.has('quality-buttons-hidden'),
    'Only selected button should become hidden');
assert.equal(badToggles,0,'No global Controller.toggle during editing');
// Order is stored without detaching existing plugin button nodes.
openFromSettings();
editor=selected[selected.length-1];
editor.onSelect(editor.items[1]);
actions=selected[selected.length-1];
actions.onSelect(actions.items.find(x=>x.action==='up'));
assert.equal(torrentButton.style.order,'0');
assert.equal(movieButton.style.order,'1');
// Folder management is separate from the native buttons' click handlers.
openFromSettings();
editor=selected[selected.length-1];
editor.onSelect(editor.items.find(x=>x.action==='newFolder'));
assert.equal(window.LampaQualityButtons.status().folders,1);
openFromSettings();
editor=selected[selected.length-1];
editor.onSelect(editor.items.find(x=>x.id===editor.items[1].id));
actions=selected[selected.length-1];
actions.onSelect(actions.items.find(x=>x.action==='folder'));
const folders=selected[selected.length-1];
folders.onSelect(folders.items.find(x=>x.title==='Избранное'));
assert.ok(torrentButton.classes.has('quality-buttons-in-folder'));
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-folder')).length,1);
assert.equal(badToggles,0);
storage.set('quality_buttons_pencil',true);
setting('quality_buttons_pencil').onChange();
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-pencil')).length,1);
// Real Lampa pencil opens a Select from Full, not from Settings. Both
// the folder Select and the native name Input must return Full's focus.
if(selectOpened)selected[selected.length-1].onBack();
focus='full_start';
const folderNode=line.children.find(n=>n.classes.has('quality-buttons-folder'));
$(folderNode).trigger('hover:enter');
assert.equal(selectParents[selectParents.length-1],'full_start');
selected[selected.length-1].onBack();
assert.equal(focus,'full_start','Back from a custom folder restores Full');
const pencilNode=line.children.find(n=>n.classes.has('quality-buttons-pencil'));
$(pencilNode).trigger('hover:enter');
assert.equal(selectParents[selectParents.length-1],'full_start');
const pencilMenu=selected[selected.length-1];
pencilMenu.onSelect(pencilMenu.items.find(x=>x.action==='newFolder'));
assert.equal(focus,'select');
assert.equal(selectParents[selectParents.length-1],'full_start',
    'Native Input completion must return to Full before reopening the editor');
selected[selected.length-1].onBack();
assert.equal(focus,'full_start','Back from pencil editor returns to Full');
nativeStart.last=nativeOnline;
storage.set('quality_buttons_enabled',false);
setting('quality_buttons_enabled').onChange();
assert.strictEqual(nativeStart.last,playButton,
    'Collapsing sources restores safe native Play focus instead of a hidden source');
assert.strictEqual(sourceHolder.parent,page,
    'Disabling layout restores the original hidden source container');
assert.ok(sourceHolder.classes.has('hide'));
assert.equal(Object.keys(nativeOnline.events).some(k=>k.endsWith('.qualityButtonsFocus')),false,
    'Source focus handlers must be unbound when native folder is restored');
assert.ok(!playButton.classes.has('quality-buttons-play-hidden'),
    'Disabling Quality restores native Play source picker');
assert.ok(!movieButton.classes.has('quality-buttons-hidden'));
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-pencil')).length,0);
storage.set('quality_buttons_enabled',true);
setting('quality_buttons_enabled').onChange();
assert.strictEqual(sourceHolder.parent,line,'Re-enable expands native folder again');
assert.ok(movieButton.classes.has('quality-buttons-hidden'));

active={component:'lampac',activity:{render(){return $(node('other',[]));}}};
focus='online';
window.LampaQualityButtons.refresh();
assert.equal(badToggles,0,'Stale full-card work cannot steal Online remote focus');
openFromSettings();
assert.equal(selected[selected.length-1].title,'Настройка кнопок',
    'Settings editor still works when Online is active');
assert.equal(badToggles,0);
selected[selected.length-1].onBack();
assert.equal(focus,'settings_component',
    'Back from editor returns focus to native Settings component');
assert.equal(selectOpened,false);
assert.ok(nativeRestorations>=4,
    'Native controller must be restored before subsequent Select menus');
assert.ok(selectParents.every(x=>x==='settings_component' || x==='full_start'),
    'No Select window may use a hidden Select as its parent');
// Simulate the two standard Settings Back transitions after our editor.
if(focus==='settings_component')focus='settings';
if(focus==='settings')focus='head';
assert.equal(focus,'head','Settings must be escapable after editing buttons');
// Do not seize a Select which is already open for an unrelated plugin.
focus='select';
selectOpened=true;
const oldMenuCount=selected.length;
const oldRestorations=nativeRestorations;
window.LampaQualityButtons.open();
assert.equal(focus,'select','Unrelated plugin Select keeps its focus');
assert.equal(selectOpened,true,'Unrelated plugin Select stays open');
assert.equal(selected.length,oldMenuCount,'Editor must not stack over another Select');
assert.equal(nativeRestorations,oldRestorations,
    'Editor must not toggle Controller while an unrelated Select owns it');
console.log('Quality Buttons: native Select/Settings back, order, folders and remote focus OK');
