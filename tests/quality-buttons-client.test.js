'use strict';
// Native Lampa Full/Controller regression: real Source folder and pencil-only editor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../Modules/Quality/buttons.js'),'utf8');
const quality=fs.readFileSync(path.join(__dirname,'../Modules/Quality/plugin.js'),'utf8');
assert.match(quality,/add\('quality_buttons_pencil', 'trigger', 'Показывать карандаш'/);
assert.ok(!script.includes("component:'quality_buttons'"),
    'The separate Quality Buttons settings component must be gone');
assert.ok(!script.includes('quality_buttons_enabled'),
    'The editor cannot be disabled by an old persisted buttons switch');
assert.ok(!script.includes('quality_buttons_open'),
    'Editor must not be accessible via Settings');

function node(classes='',children=[]){
    const e={classes:new Set(classes.split(/\s+/).filter(Boolean)),attrs:{},
        children,style:{order:''},events:{},textValue:'',parent:null,
        contains(child){
            if(this===child)return true;
            return this.children.some(x=>x.contains(child));
        }};
    children.forEach(x=>x.parent=e);
    return e;
}
function matches(n,selector){
    if(selector==='span')return n.tag==='span';
    if(selector.charAt(0)!=='.')return false;
    return selector.slice(1).split('.').every(c=>n.classes.has(c));
}
class Q{
    constructor(nodes){this.nodes=nodes.filter(Boolean);this.length=this.nodes.length;
        this.nodes.forEach((x,i)=>{this[i]=x;});}
    first(){return new Q(this.nodes.slice(0,1));}
    parent(){return new Q(this.nodes.map(x=>x.parent));}
    hasClass(c){return !!this[0]&&this[0].classes.has(c);}
    addClass(cs){return this.each(function(){cs.split(' ').forEach(c=>this.classes.add(c));});}
    removeClass(cs){return this.each(function(){cs.split(' ').forEach(c=>this.classes.delete(c));});}
    toggleClass(c,on){return this.each(function(){
        if(on===undefined? !this.classes.has(c):on)this.classes.add(c);
        else this.classes.delete(c);
    });}
    find(selector){
        const terms=selector.split(/\s+/),leaf=terms[terms.length-1],hits=[];
        function walk(el){el.children.forEach(c=>{if(matches(c,leaf))hits.push(c);walk(c);});}
        this.nodes.forEach(walk);return new Q(hits);
    }
    children(selector){
        const arr=this.nodes.flatMap(x=>x.children);
        return new Q(selector?arr.filter(x=>selector.split(',').some(c=>matches(x,c.trim()))):arr);
    }
    not(selectors){return new Q(this.nodes.filter(x=>
        !selectors.split(',').some(s=>matches(x,s.trim()))));}
    each(fn){this.nodes.forEach((x,i)=>fn.call(x,i,x));return this;}
    attr(k,v){if(v===undefined){
        if(k==='class')return this[0]?Array.from(this[0].classes).join(' '):'';
        return this[0]?.attrs[k]||'';
    }return this.each(function(){this.attrs[k]=String(v);});}
    text(v){if(v===undefined)return this.nodes.map(x=>x.textValue).join('');
        return this.each(function(){this.textValue=v;});}
    css(k,v){if(v===undefined)return this[0]?.style[k]||'';
        return this.each(function(){this.style[k]=String(v);});}
    on(names,fn){return this.each(function(){names.split(/\s+/).forEach(k=>this.events[k]=fn);});}
    off(namespace){return this.each(function(){Object.keys(this.events).forEach(k=>{
        if(k.endsWith(namespace))delete this.events[k];
    });});}
    trigger(name){return this.each(function(){Object.keys(this.events).forEach(k=>{
        if(k===name||k.startsWith(name+'.'))
            this.events[k].call(this,{target:this,type:name});
    });});}
    append(items){const nodes=items instanceof Q?items.nodes:[items];
        return this.each(function(){const parent=this;
            nodes.forEach(child=>{
                if(child.parent)child.parent.children=child.parent.children.filter(x=>x!==child);
                parent.children.push(child);child.parent=parent;
            });
        });}
    remove(){return this.each(function(){
        if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);
        this.parent=null;
    });}
}
function $(arg){
    if(arg instanceof Q)return arg;
    if(typeof arg==='string'){
        if(!arg.startsWith('<'))return new Q([]);
        const m=arg.match(/class="([^"]*)"/),e=node(m?m[1]:'');
        if(arg.includes('<span')){
            const span=node();span.tag='span';span.parent=e;e.children.push(span);
        }
        return new Q([e]);
    }
    return new Q(Array.isArray(arg)?arg:[arg]);
}
function button(classes,title){
    const e=node(classes),span=node();span.tag='span';span.textValue=title;
    e.children.push(span);span.parent=e;
    e.events['hover:enter']=function(){this.clicks=(this.clicks||0)+1;};
    return e;
}
const play=button('full-start__button selector button--play','Смотреть');
const book=button('full-start__button selector button--book','Избранное');
const sourceHolder=node('buttons--container hide',[
    button('full-start__button view--torrent','Торренты'), // native torrent LACKS selector
    button('full-start__button selector lampac--button','Онлайн'),
    button('full-start__button selector view--trailer','Трейлеры')
]);
const nativeTorrent=sourceHolder.children[0],nativeOnline=sourceHolder.children[1];
const line=node('full-start-new__buttons',[play,book]);
let page=node('full-page',[line,sourceHolder]),slide=node('activity-slide',[page]);
function nativeStart(last, nativePlay){
    return {
        last:last,
        modules:[],
        use(module){this.modules.push(module);},
        emit(name){
            if(name!=='groupButtons')return;
            // Mirrors Lampa Start's native Buttons.onGroupButtons: this
            // resets native Play before the registered extension runs.
            nativePlay.classes.delete('hide');
            this.modules.forEach(mod=>{
                if(typeof mod.onGroupButtons==='function')
                    mod.onGroupButtons.call(this);
            });
        }
    };
}
let start=nativeStart(play,play),component={items:[start]};
const settingsComponents=[],settingsParams=[],events={},storage=new Map(),selects=[],parents=[];
let focus='content',selectOpen=false,invalidToggle=0,nav=[],selected=null,navBuilds=0;
let activity={component:'full',activity:{component,render(){return $(slide);}}};
function eligible(e){
    for(let n=e;n;n=n.parent){
        if(n.classes.has('hide')||n.classes.has('quality-buttons-hidden')
            ||n.classes.has('quality-buttons-in-folder')
            ||n.classes.has('quality-buttons-play-hidden'))return false;
    }
    return true;
}
function buildNavigation(){
    nav=[];
    function visit(e){if(e.classes.has('selector')&&eligible(e))nav.push(e);
        e.children.forEach(visit);}
    visit(page);
    selected=nav.includes(start.last)?start.last:nav[0]||null;
    if(selected)$(selected).trigger('hover:focus');
    navBuilds++;
}
const L={
    Activity:{active(){return activity;}},
    Storage:{
        get(k,def){return storage.has(k)?storage.get(k):def;},
        set(k,v){storage.set(k,v);},
        listener:{follow(n,fn){events['storage:'+n]=fn;}}
    },
    Listener:{follow(n,fn){events[n]=fn;}},
    SettingsApi:{
        addComponent(x){settingsComponents.push(x);},
        addParam(x){settingsParams.push(x);}
    },
    Controller:{
        enabled(){return {name:focus,controller:focus==='full_start'?{link:start}:null};},
        toggle(name){
            if(name!=='full_start'&&name!=='settings_component'){
                invalidToggle++;throw Error('Unexpected controller '+name);
            }
            focus=name;
            if(name==='full_start'){
                // Lampa Start.toggle() emits groupButtons just BEFORE it
                // rebuilds Controller.collectionSet and collectionFocus.
                start.emit('groupButtons');
                buildNavigation();
            }
        }
    },
    Select:{
        opened(){return selectOpen;},
        show(x){
            assert.equal(selectOpen,false,'Cannot stack over a live Select');
            assert.notEqual(focus,'select','No orphan Select as a parent');
            parents.push(focus);
            selects.push({
                ...x,
                onSelect(item){selectOpen=false;if(x.onSelect)x.onSelect(item);},
                onBack(){selectOpen=false;if(x.onBack)x.onBack();}
            });
            focus='select';selectOpen=true;
        }
    },
    Input:{edit(opts,cb){
        // Native Lampa.Settings.Input backs out into Settings, then calls back.
        focus='settings_component';cb('Моя папка');
    }},
    Noty:{show(){}}
};
const document={body:{},head:{appendChild(){}},createElement(){return {};}};
const win={Lampa:L,$};const mutations=[],deferred=[];
class Mutation{
    constructor(cb){this.cb=cb;mutations.push(this);this.targets=[];}
    observe(el,opts){this.targets.push(el);}
    disconnect(){this.targets=[];}
}
vm.runInNewContext(script,{window:win,document,console,MutationObserver:Mutation,
    setTimeout(fn,ms){if(ms===100)deferred.push(fn);return 1;},
    clearTimeout(){}});
function latest(){return selects[selects.length-1];}
function pencil(){
    // The pencil belongs to the ACTIVE Full card; the original card's
    // toolbar is intentionally destroyed when navigating to a new title.
    return $(page).find('.quality-buttons-pencil')[0];
}
function open(){
    assert.ok(pencil(),'Pencil must exist to open editor');
    $(pencil()).trigger('hover:enter');
    assert.equal(focus,'select');
    assert.equal(latest().title,'Настройка кнопок');
    assert.equal(parents[parents.length-1],'full_start');
}
function close(){assert.equal(selectOpen,true);latest().onBack();
    assert.equal(focus,'full_start');assert.equal(selectOpen,false);}
function setPencil(v){
    storage.set('quality_buttons_pencil',v);
    events['storage:change']({name:'quality_buttons_pencil'});
}

// Full.complite arrives BEFORE the native Full.start.toggle().
events.full({type:'complite',body:[page],link:component});
assert.ok(nativeTorrent.classes.has('selector'),
    'Lampa native torrent is not a selector until Quality exposes it');
assert.ok(!play.classes.has('selector'),
    'Hidden native Play must be removed from Controller collection');
assert.equal(sourceHolder.parent,line);
assert.equal(start.last===play,false,'Saved focus must not point to hidden Play');
L.Controller.toggle('full_start');
assert.ok(nav.includes(nativeTorrent)&&nav.includes(nativeOnline)&&nav.includes(book),
    'Native keyboard navigation collection must include every visible source');
assert.ok(!nav.includes(play),'Hidden Source picker cannot trap keyboard focus');
assert.ok(nav.includes(start.last),'Initial focus target must be navigable');
assert.equal(pencil(),undefined,'Pencil defaults to hidden');
assert.equal(settingsParams.length,0,'No Quality Buttons settings component or controls');
assert.equal(settingsComponents.length,0);
assert.equal(win.LampaQualityButtons.status().pencil,false);

// Live toggle on current card immediately rebuilds native Full nav.
const buildsBefore=navBuilds;
setPencil(true);
assert.ok(pencil(),'Pencil must be shown when enabled in Quality settings');
assert.ok(nav.includes(pencil()),'Keyboard must be able to navigate to pencil');
assert.ok(navBuilds>buildsBefore,'Native Full controller rebuilt for pencil');
const stablePencil=pencil();
const late=button('selector external-stream','Сторонний сервис');
line.children.push(late);late.parent=line;
mutations[0].cb();assert.equal(deferred.length,1);
deferred.shift()();
assert.ok(nav.includes(late),'Late third-party button must join keyboard collection');
assert.strictEqual(pencil(),stablePencil,'Refresh cannot delete the focused pencil');
$(late).trigger('hover:enter');assert.equal(late.clicks,1);

// Editor only via pencil, with native Select transitions.
open();
assert.ok(latest().items.some(x=>x.title==='Сторонний сервис'));
let menu=latest();
menu.onSelect(menu.items.find(x=>x.title==='Избранное'));
let actions=latest();
actions.onSelect(actions.items.find(x=>x.action==='visibility'));
assert.ok(book.classes.has('quality-buttons-hidden'));
assert.ok(!book.classes.has('selector'),'Hidden button cannot trap keyboard focus');
assert.ok(!nav.includes(book));
close();
// Move a button. CSS order is persisted; original click handlers survive.
open();menu=latest();
menu.onSelect(menu.items.find(x=>x.title==='Торренты'));
actions=latest();actions.onSelect(actions.items.find(x=>x.action==='up'));
assert.equal(nativeTorrent.style.order,'1',
    'Moving native Torrent up advances one position in the combined plugin/source catalog');
assert.ok(nav.includes(nativeTorrent));
close();
$(nativeTorrent).trigger('hover:enter');assert.equal(nativeTorrent.clicks,1);

// Create folder using native Input and assign a source to it.
open();menu=latest();
menu.onSelect(menu.items.find(x=>x.action==='newFolder'));
assert.equal(win.LampaQualityButtons.status().folders,1);
assert.equal(parents[parents.length-1],'full_start');
close();
open();menu=latest();
menu.onSelect(menu.items.find(x=>x.title==='Торренты'));
actions=latest();actions.onSelect(actions.items.find(x=>x.action==='folder'));
let groups=latest();
groups.onSelect(groups.items.find(x=>x.title==='Моя папка'));
assert.ok(nativeTorrent.classes.has('quality-buttons-in-folder'));
assert.ok(!nativeTorrent.classes.has('selector'),
    'A source inside a custom folder must not remain keyboard-selectable');
assert.ok(!nav.includes(nativeTorrent));
close();
const folder= line.children.find(x=>x.classes.has('quality-buttons-folder'));
assert.ok(folder && folder.classes.has('selector'));
$(folder).trigger('hover:focus');
assert.strictEqual(start.last,folder,'Native Start remembers focused custom folder');
win.LampaQualityButtons.refresh();
assert.strictEqual(line.children.find(x=>x.classes.has('quality-buttons-folder')),folder,
    'Layout refresh must not replace the focused folder DOM node');
assert.ok(nav.includes(folder),'Folder stays keyboard-selectable after layout refresh');

// Hide pencil from Quality settings: layout remains, editor goes away.
start.last=pencil();
focus='settings_component';
setPencil(false);
assert.equal(pencil(),undefined,'Disabling pencil must remove editor button');
assert.equal(start.last===stablePencil,false,'Full.last must not point to removed pencil');
assert.ok(nativeTorrent.classes.has('quality-buttons-in-folder'),
    'Hiding pencil does not discard saved button layout');
assert.equal(focus,'settings_component',
    'Changing setting cannot steal focus from Settings');
L.Controller.toggle('full_start');
assert.ok(!nav.includes(stablePencil));
setPencil(true);
assert.ok(pencil()&&nav.includes(pencil()),'Pencil must be able to reopen');
open();close();
assert.equal(invalidToggle,0,'No alien controller was toggled');
assert.ok(parents.every(x=>x==='full_start'),
    'Editor must only open from pencil while Full controller is active');
// A saved layout applies to EVERY subsequent movie card, even if a third
// party adds sources later or some source buttons are absent. Series have a
// separate profile: editing a series must not modify the movie preferences.
function anotherCard(kind, options={}){
    const nextPlay=button('full-start__button selector button--play','Смотреть');
    const nextBook=button('full-start__button selector button--book','Избранное');
    const nextTorrent=button('full-start__button view--torrent','Торренты');
    const nextOnline=button('full-start__button selector lampac--button','Онлайн');
    const nextTrailer=button('full-start__button selector view--trailer','Трейлеры');
    if(options.noTorrent)nextTorrent.classes.add('hide');
    if(options.lateOnline)nextOnline.classes.add('hide');
    const nextHolder=node('buttons--container hide',[nextTorrent,nextOnline,nextTrailer]);
    const thirdA=node('selector third-party-a');
    thirdA.attrs['aria-label']='Дополнение А';
    const thirdB=node('selector third-party-b');
    thirdB.attrs['aria-label']='Дополнение Б';
    const extras=options.reversePlugins ? [thirdB,thirdA] : [thirdA,thirdB];
    const nextLine=node('full-start-new__buttons',[nextPlay,nextBook].concat(extras));
    const nextPage=node('full-page',[nextLine,nextHolder]);
    const nextSlide=node('activity-slide',[nextPage]);
    const nextStart=nativeStart(nextBook,nextPlay); // native focus likes Bookmarks
    const nextComponent={items:[nextStart],render(){return $(nextPage);}};
    page=nextPage;start=nextStart;component=nextComponent;slide=nextSlide;
    const newActivity={component:'full',method:kind,
        activity:{component:nextComponent,render(){return $(nextSlide);}}};
    activity=options.backgroundCompletion
        ?{component:'lampac',activity:{render(){return $(node('online'));}}}
        :newActivity;
    focus='content';
    events.full({type:'complite',body:[nextPage],link:nextComponent,
        data:{movie:kind==='tv'
            ?(options.noDate
                ?{name:'Сериал',number_of_seasons:2}
                :{name:'Сериал',first_air_date:'2025-03-20'})
            :{title:'Фильм',release_date:'2025-03-20'}}});
    if(!options.backgroundCompletion)L.Controller.toggle('full_start');
    return {activityObject:newActivity,
        play:nextPlay,book:nextBook,torrent:nextTorrent,online:nextOnline,
        trailer:nextTrailer,thirdA,thirdB,holder:nextHolder,line:nextLine,
        page:nextPage,slide:nextSlide,component:nextComponent,start:nextStart};
}
const movieSaved=storage.get('quality_module_buttons_v2_movie');
assert.ok(movieSaved,'Movie layout must persist in its own key');
for(let i=0;i<4;i++){
    const c=anotherCard('movie',{
        noTorrent:i%2===1,lateOnline:i===2,reversePlugins:i%2===1
    });
    assert.equal(c.thirdA.attrs['data-quality-buttons-id'],'b:attr:Дополнение А');
    assert.equal(c.thirdB.attrs['data-quality-buttons-id'],'b:attr:Дополнение Б');
    assert.notEqual(c.thirdA.attrs['data-quality-buttons-id'],
        c.thirdB.attrs['data-quality-buttons-id'],
        'Plugin button identity stays stable even when asynchronous insertion order swaps');
    assert.strictEqual(c.holder.parent,c.line,
        'Native source holder stays ungrouped on every movie, including while sources load');
    assert.ok(!c.play.classes.has('selector'),
        'Native Source picker must never reappear between movies');
    assert.ok(c.book.classes.has('quality-buttons-hidden'),
        'Saved hidden state must survive each movie transition');
    if(i!==2){
        assert.strictEqual(c.start.last,c.online,
            'New movie initial focus must be the first VISIBLE saved-order button');
    }else{
        assert.notStrictEqual(c.start.last,c.book,
            'Late-loading source must not force focus onto hidden Bookmarks');
        c.online.classes.delete('hide');
        mutations[mutations.length-1].cb();
        assert.equal(deferred.length,1);
        deferred.shift()();
        assert.ok(c.online.classes.has('selector'));
        assert.strictEqual(c.start.last,c.online,
            'Once the preferred Online source arrives, untouched fallback focus follows the saved visual first button');
        assert.strictEqual(c.holder.parent,c.line);
        assert.ok(!c.play.classes.has('selector'));
    }
    assert.equal(storage.get('quality_module_buttons_v2_movie'),movieSaved,
        'Browsing cards must never mutate saved movie layout');
}
let tv=anotherCard('tv');
assert.equal(win.LampaQualityButtons.status().profile,'tv');
assert.strictEqual(tv.start.last,tv.book,
    'An unconfigured TV profile starts with its first visible native button');
// Configure TV independently: move Torrents to the FIRST visual position.
// There are two dynamically added plugin buttons between Bookmarks and Torrent,
// so three native editor moves are needed, not one.
for(let step=0;step<3;step++){
    open();menu=latest();
    menu.onSelect(menu.items.find(x=>x.title==='Торренты'));
    actions=latest();
    actions.onSelect(actions.items.find(x=>x.action==='up'));
    close();
}
const tvSaved=storage.get('quality_module_buttons_v2_tv');
assert.ok(tvSaved,'Series must save to their own profile');
assert.notStrictEqual(tvSaved,movieSaved);
tv=anotherCard('tv',{lateOnline:true,noDate:true});
assert.equal(win.LampaQualityButtons.status().profile,'tv',
    'A series with missing first-air date keeps its TV layout');
assert.strictEqual(tv.start.last,tv.torrent,
    'Each new TV card focuses the first button in its saved layout');
assert.ok(!tv.book.classes.has('quality-buttons-hidden'),
    'The movie hidden state must not leak into a TV layout');
assert.equal(storage.get('quality_module_buttons_v2_tv'),tvSaved);
const movieAgain=anotherCard('movie');
assert.strictEqual(movieAgain.start.last,movieAgain.online,
    'Returning from a series must restore movie visual order and focus');
assert.ok(movieAgain.book.classes.has('quality-buttons-hidden'));
assert.equal(storage.get('quality_module_buttons_v2_movie'),movieSaved);
assert.equal(storage.get('quality_module_buttons_v2_tv'),tvSaved);

// TranslationSub direct route: it pushes a Full series card immediately
// underneath Lampac Online. Returning from Online sends activity:start,
// NOT full:complite. Its Lampa Start.onGroupButtons may have already changed
// the native picker while the series card was inactive.
const cachedTv=tv;
const cachedTvActivity={component:'full',method:'tv',
    activity:{component:cachedTv.component,render(){return $(cachedTv.slide);}}};
// We last visited a movie; first restore the cached series the same way
// Lampa does before TranslationSub opens Online above that series.
activity=cachedTvActivity;
focus='full_start';
events.activity({component:'full',type:'start',object:cachedTvActivity});
activity={component:'lampac',activity:{render(){return $(node('online'));}}};
focus='content';
const savedTvBeforeBack=storage.get('quality_module_buttons_v2_tv');
assert.ok(cachedTv.holder.parent===cachedTv.line);
assert.ok(cachedTv.start.modules.some(mod=>typeof mod.onGroupButtons==='function'),
    'Quality must install native Start.use(onGroupButtons) before cached Back');
// Simulate native source grouping / externally reinitialized button DOM.
$(cachedTv.page).append($(cachedTv.holder));
cachedTv.holder.classes.add('hide');
cachedTv.holder.classes.delete('quality-buttons-native-sources');
cachedTv.line.classes.delete('quality-buttons-ungrouped');
cachedTv.play.classes.delete('quality-buttons-play-hidden');
cachedTv.play.classes.add('selector');
cachedTv.torrent.style.order='';
cachedTv.book.style.order='';
assert.strictEqual(cachedTv.holder.parent,cachedTv.page,
    'The online-return test must begin from a grouped factory DOM');
// Back to the SAME cached Full: no second full:complite event happens.
activity=cachedTvActivity;
focus='full_start';
events.activity({component:'full',type:'start',object:cachedTvActivity});
assert.strictEqual(cachedTv.holder.parent,cachedTv.line,
    'activity:start after Online must re-extract native source buttons');
assert.ok(!cachedTv.holder.classes.has('hide'));
assert.ok(!cachedTv.play.classes.has('selector'));
assert.ok(cachedTv.torrent.classes.has('selector'));
assert.equal(cachedTv.torrent.style.order,'0',
    'activity:start restores the original TV user order');
assert.strictEqual(cachedTv.start.last,cachedTv.torrent);
// Simulate Lampa calling Start.toggle AGAIN later (e.g. after a Select,
// switching row focus or re-entering Full). Native GroupButtons executes
// before Quality's module and before controller's selector collection.
cachedTv.play.classes.delete('quality-buttons-play-hidden');
cachedTv.play.classes.add('selector');
cachedTv.start.emit('groupButtons');
assert.ok(cachedTv.play.classes.has('quality-buttons-play-hidden'),
    'Native GroupButtons re-grouping must not resurrect factory Source picker');
assert.ok(!cachedTv.play.classes.has('selector'));
assert.strictEqual(cachedTv.holder.parent,cachedTv.line);
assert.equal(cachedTv.torrent.style.order,'0');
assert.equal(storage.get('quality_module_buttons_v2_tv'),savedTvBeforeBack,
    'Native group reapplication must never write saved user layout');
assert.strictEqual(storage.get('quality_module_buttons_v2_tv'),savedTvBeforeBack,
    'Reapplying the cached Full must not modify persisted TV preferences');

// Another important path: while another Full is active, Quality restores the
// older Full to its native DOM. Returning to it must adopt its component,
// re-extract sources, and load the correct media profile without full:complite.
const newerMovie=anotherCard('movie');
assert.equal(cachedTv.holder.parent,cachedTv.page,
    'Switching to a different Full restores the inactive TV DOM');
activity=cachedTvActivity;
focus='full_start';
events.activity({component:'full',type:'start',object:cachedTvActivity});
assert.equal(win.LampaQualityButtons.status().profile,'tv',
    'Cached Full return must recover TV profile from Lampa activity.method');
assert.strictEqual(cachedTv.holder.parent,cachedTv.line);
assert.equal(cachedTv.torrent.style.order,'0');
assert.strictEqual(storage.get('quality_module_buttons_v2_movie'),movieSaved);
assert.strictEqual(storage.get('quality_module_buttons_v2_tv'),tvSaved);
// A background Online activation should NOT touch the cached card.
activity={component:'lampac',activity:{render(){return $(node('online'));}}};
focus='content';
const origin=cachedTv.holder.parent;
events.activity({component:'lampac',type:'start',object:activity});
assert.strictEqual(cachedTv.holder.parent,origin,
    'Quality must never hijack a non-Full activity');

// TranslationSub's real sequence pushes Full and immediately Lampac Online.
// Api.full may send "full:complite" only AFTER Online has become active.
const backgroundCard=anotherCard('tv',{backgroundCompletion:true});
assert.equal(win.LampaQualityButtons.status().profile,'tv',
    'An inactive Full completion cannot overwrite the saved layout profile');
assert.strictEqual(backgroundCard.holder.parent,backgroundCard.page,
    'A Full completed beneath Online must be deferred, not laid out in the background');
assert.ok(backgroundCard.holder.classes.has('hide'));
assert.ok(backgroundCard.play.classes.has('selector'));
const beforeInactiveNav=navBuilds;
events.activity({component:'full',type:'start',object:backgroundCard.activityObject});
assert.equal(navBuilds,beforeInactiveNav,
    'A start event for an INACTIVE cached Full must not steal Online focus');
assert.equal(focus,'content');
// Lampa Activity.backward() makes that cached Full active; no full:complite.
activity=backgroundCard.activityObject;
focus='full_start';
events.activity({component:'full',type:'start',object:backgroundCard.activityObject});
assert.strictEqual(backgroundCard.holder.parent,backgroundCard.line,
    'First activation of a deferred Full applies its saved layout');
assert.ok(!backgroundCard.play.classes.has('selector'));
assert.strictEqual(backgroundCard.start.last,backgroundCard.torrent);
assert.equal(backgroundCard.torrent.style.order,'0',
    'Direct TranslationSub route restores saved series order on Back');
assert.equal(storage.get('quality_module_buttons_v2_tv'),tvSaved,
    'Background completion and return must never overwrite TV settings');

// Real user log 15:36:06.369: active Full A (component 21) was correctly
// ungrouped, then a different Full B (component 24) emitted full:complite.
// Quality previously called restore(owner) on A and switched its observer to
// B, leaving A with the native Play/Source folder even though A was visible.
const activeA = backgroundCard;
const activeAComponent = activeA.component;
const beforeRaceNav = navBuilds;
const beforeRaceSaved = storage.get('quality_module_buttons_v2_tv');
const beforeRaceOrder = activeA.torrent.style.order;
const delayedPlay = button('full-start__button selector button--play','Смотреть');
const delayedBook = button('full-start__button selector button--book','Избранное');
const delayedTorrent = button('full-start__button view--torrent','Торренты');
const delayedOnline = button('full-start__button selector lampac--button','Онлайн');
const delayedHolder = node('buttons--container hide',[delayedTorrent,delayedOnline]);
const delayedLine = node('full-start-new__buttons',[delayedPlay,delayedBook]);
const delayedPage = node('full-page',[delayedLine,delayedHolder]);
const delayedSlide = node('activity-slide',[delayedPage]);
const delayedStart = nativeStart(delayedPlay,delayedPlay);
const delayedComponent = {items:[delayedStart],render(){return $(delayedPage);}};
const delayedActivity = {
    component:'full',method:'movie',
    activity:{component:delayedComponent,render(){return $(delayedSlide);}}
};
// B finishes late, but A remains the active Full throughout this event.
events.full({type:'complite',body:[delayedPage],link:delayedComponent,
    data:{movie:{title:'Фильм Б',release_date:'2026-01-01'}}});
assert.strictEqual(activity.activity.component,activeAComponent);
assert.strictEqual(activeA.holder.parent,activeA.line,
    'Foreign full:complite must never restore active Full A to native Source folder');
assert.ok(!activeA.play.classes.has('selector'),
    'Foreign full:complite cannot make native Play focusable on active A');
assert.ok(activeA.play.classes.has('quality-buttons-play-hidden'));
assert.equal(activeA.torrent.style.order,beforeRaceOrder);
assert.strictEqual(activeA.start.last,activeA.torrent,
    'Foreign full:complite cannot reset the active controller focus');
assert.equal(win.LampaQualityButtons.status().profile,'tv',
    'Foreign full:complite must not switch the active layout profile');
assert.strictEqual(delayedHolder.parent,delayedPage,
    'The background Full B must remain untouched until it becomes active');
assert.equal(delayedStart.modules.length,0,
    'Do not attach grouping handlers to a nonactive Full');
assert.equal(navBuilds,beforeRaceNav,
    'No remote navigation rebuild for a foreign completion');
assert.strictEqual(storage.get('quality_module_buttons_v2_tv'),beforeRaceSaved);
// Later B becomes active via activity:start; now it receives its movie layout.
activity=delayedActivity;
focus='full_start';
events.activity({component:'full',type:'start',object:delayedActivity});
assert.strictEqual(delayedHolder.parent,delayedLine,
    'Deferred Full B gets layout on its actual activation');
assert.ok(!delayedPlay.classes.has('selector'));
assert.equal(delayedOnline.style.order,
    String(movieSaved.order.indexOf('b:lampac--button')),
    'Deferred Full uses the saved position of the same Lampac button');
assert.strictEqual(delayedStart.last,delayedOnline,
    'First activation focuses the first available visible action');
assert.equal(win.LampaQualityButtons.status().profile,'movie');
assert.strictEqual(storage.get('quality_module_buttons_v2_tv'),tvSaved);
assert.strictEqual(storage.get('quality_module_buttons_v2_movie'),movieSaved);

// No stale toggle or unexpected controller activation is allowed.
activity={component:'online',activity:{render(){return $(node('online'));}}};
focus='online';const previous=navBuilds;
win.LampaQualityButtons.refresh();
assert.equal(navBuilds,previous,'Never rebuild navigation for unrelated screens');
console.log('Quality Buttons: keyboard source focus, pencil show/hide and native editor lifecycle OK');
