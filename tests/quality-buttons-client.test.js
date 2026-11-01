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
    find(selector){
        const s=selector.split(/\s+/).pop(),results=[];
        function walk(n){n.children.forEach(x=>{if(matches(x,s)||s==='span'&&x.tag==='span')results.push(x);walk(x);});}
        this.nodes.forEach(walk);return new Q(results);
    }
    children(selector){
        const list=this.nodes.flatMap(x=>x.children);
        return new Q(selector?list.filter(x=>matches(x,selector)):list);
    }
    not(selectors){const excluded=selectors.split(',').map(s=>s.trim());
        return new Q(this.nodes.filter(x=>!excluded.some(s=>matches(x,s))));}
    each(fn){this.nodes.forEach((n,i)=>fn.call(n,i,n));return this;}
    attr(k,v){if(v===undefined)return this[0]?.attrs[k]||'';
        this.nodes.forEach(n=>n.attrs[k]=String(v));return this;}
    css(k,v){if(v===undefined)return this[0]?.style[k]||'';
        this.nodes.forEach(n=>n.style[k]=String(v));return this;}
    text(v){if(v===undefined)return this.nodes.map(n=>n.textValue).join('');
        this.nodes.forEach(n=>n.textValue=v);return this;}
    toggleClass(c,enabled){this.nodes.forEach(n=>{if(enabled)n.classes.add(c);else n.classes.delete(c);});return this;}
    removeClass(names){this.nodes.forEach(n=>names.split(' ').forEach(s=>n.classes.delete(s)));return this;}
    on(event,fn){this.nodes.forEach(n=>n.events[event]=fn);return this;}
    trigger(event){this.nodes.forEach(n=>{if(n.events[event])n.events[event]();});return this;}
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
const line=node('full-start-new__buttons',[movieButton,torrentButton]);
const page=node('full-page',[line]);
const storage=new Map(),events={},params=[],selected=[];
let active={component:'full',activity:{render(){return $(page);}}},focus='full_start',toggles=0;
const L={Storage:{get(k,def){return storage.has(k)?storage.get(k):def;},set(k,v){storage.set(k,v);},
    listener:{follow(n,fn){events['storage:'+n]=fn;}}},
    Listener:{follow(n,fn){events[n]=fn;}},
    Activity:{active(){return active;}},
    Controller:{enabled(){return {name:focus};},toggle(){toggles++;throw Error('Navigation hijacked');}},
    SettingsApi:{addComponent(){},addParam(x){params.push(x);}},
    Select:{show(x){selected.push(x);},close(){}},
    Input:{edit(x,cb){cb('Избранное');}},
    Noty:{show(){}}
};
const document={body:{},head:{appendChild(){}},createElement(){return {};}};
const window={Lampa:L,$};
class Mutation{constructor(cb){this.cb=cb;}observe(){}disconnect(){}}
vm.runInNewContext(script,{window,document,console,setTimeout,clearTimeout,MutationObserver:Mutation});
const setting=(name)=>params.find(x=>x.param.name===name);
assert.equal(window.LampaQualityButtons.status().loaded,true);
assert.ok(setting('quality_buttons_open'));
assert.ok(setting('quality_buttons_pencil'));
assert.equal(setting('quality_buttons_pencil').param.default,false);
events.full({type:'complite',body:[page]});
assert.equal(movieButton.style.order,'');
assert.equal(torrentButton.style.order,'',
    'Native order must remain untouched before the user customizes it');
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-pencil')).length,0,
    'Pencil should not take remote focus by default');
setting('quality_buttons_open').onChange();
let editor=selected[selected.length-1];
assert.equal(editor.title,'Настройка кнопок');
editor.onSelect(editor.items[0]);
let actions=selected[selected.length-1];
actions.onSelect(actions.items.find(x=>x.action==='visibility'));
assert.ok(movieButton.classes.has('quality-buttons-hidden'),
    'Only selected button should become hidden');
assert.equal(toggles,0,'No global Controller.toggle during editing');
// Order is stored without detaching existing plugin button nodes.
setting('quality_buttons_open').onChange();
editor=selected[selected.length-1];
editor.onSelect(editor.items[1]);
actions=selected[selected.length-1];
actions.onSelect(actions.items.find(x=>x.action==='up'));
assert.equal(torrentButton.style.order,'0');
assert.equal(movieButton.style.order,'1');
// Folder management is separate from the native buttons' click handlers.
setting('quality_buttons_open').onChange();
editor=selected[selected.length-1];
editor.onSelect(editor.items.find(x=>x.action==='newFolder'));
assert.equal(window.LampaQualityButtons.status().folders,1);
setting('quality_buttons_open').onChange();
editor=selected[selected.length-1];
editor.onSelect(editor.items.find(x=>x.id===editor.items[1].id));
actions=selected[selected.length-1];
actions.onSelect(actions.items.find(x=>x.action==='folder'));
const folders=selected[selected.length-1];
folders.onSelect(folders.items.find(x=>x.title==='Избранное'));
assert.ok(torrentButton.classes.has('quality-buttons-in-folder'));
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-folder')).length,1);
assert.equal(toggles,0);
storage.set('quality_buttons_pencil',true);
setting('quality_buttons_pencil').onChange();
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-pencil')).length,1);
storage.set('quality_buttons_enabled',false);
setting('quality_buttons_enabled').onChange();
assert.ok(!movieButton.classes.has('quality-buttons-hidden'));
assert.equal(line.children.filter(n=>n.classes.has('quality-buttons-pencil')).length,0);
storage.set('quality_buttons_enabled',true);
setting('quality_buttons_enabled').onChange();
assert.ok(movieButton.classes.has('quality-buttons-hidden'));

active={component:'lampac',activity:{render(){return $(node('other',[]));}}};
focus='online';
window.LampaQualityButtons.refresh();
assert.equal(toggles,0,'Stale full-card work cannot steal Online remote focus');
setting('quality_buttons_open').onChange();
assert.equal(selected[selected.length-1].title,'Настройка кнопок',
    'Settings editor still works when Online is active');
assert.equal(toggles,0);
console.log('Quality Buttons: settings, visibility, optional pencil and remote focus isolation OK');
