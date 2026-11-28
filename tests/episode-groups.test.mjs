import { readFileSync } from 'node:fs';

// Regression tests use a synthetic fixture, not a live TMDB or Lampac instance.

function run(source) {
  let count = 0;
  const check = (label, condition) => {
    if (!condition) throw new Error('FAIL: ' + label);
    count++;
    console.log('PASS: ' + label);
  };
  const extract = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    if (a < 0 || b <= a) throw new Error('Cannot locate plugin functions: ' + start);
    return source.slice(a,b);
  };
  const helpers = extract('  function groupEpisodes', '  var Network =');
  const methods = extract('    this.episodeTmdbId =', '    this.watched =');
  const clone = v => JSON.parse(JSON.stringify(v));
  const store = {};
  let requests = [], fail = false;
  // Synthetic fixture based on the user's observed Digital Order season counts.
  const counts = [9,20,15,12,16,4,13,13,13,13,10,10,10,10];
  const canonical = [1,2,3,4,5,0,6,6,7,7,8,9,10,11];
  const fixture = { groups: counts.map((count,i) => ({
    name: 'Season ' + (i+1), order: i+1,
    episodes: Array.from({length:count},(_,j)=>({
      id: (i+1)*100+j+1, order:j, season_number:canonical[i],
      episode_number:j+1+([7,9].includes(i)?13:0),
      name:'Fixture S'+(i+1)+'E'+(j+1),runtime:22,still_path:'/fixture.jpg'
    }))
  })).reverse() };
  const original = clone(fixture);
  const Lampa = {
    Storage: { cache:(key,limit,def)=>key in store?clone(store[key]):def,
      set:(key,value)=>{store[key]=clone(value);} },
    Api:{sources:{tmdb:{get:(path,params,ok,error)=>{
      requests.push(path);
      if(fail) return error();
      if(path.startsWith('tv/episode_group/')) return ok(fixture);
      return ok({episodes:[{id:1,episode_number:1,season_number:1}]});
    }}}}
  };
  const h = new Function('Lampa',helpers+'; return {groupEpisodes,episodeGroupPreferences,effectiveEpisodeGroup,saveEpisodeGroup};')(Lampa);
  const make = (id,source,card={id,name:'Futurama',source:'tmdb'}) => {
    const instance={};
    new Function('Lampa','object','balanser','comp',helpers+methods).call(instance,Lampa,{movie:card},source,instance);
    return instance;
  };
  const load=(instance,season)=>{let v;instance.getEpisodes(season,x=>v=x);return v;};
  const digital={group_id:'digital',title:'Digital Order'};
  check('canonical default',load(make(615,'video'),1)[0].id===1 && requests.pop()==='tv/615/season/1');
  h.saveEpisodeGroup(615,'video','series',digital);
  for(let i=1;i<=14;i++){
    const eps=load(make(615,'cinemar'),i);
    check('Digital season '+i,eps.length===counts[i-1] && eps.every((x,j)=>x.season_number===i && x.episode_number===j+1 && x.id===i*100+j+1));
  }
  check('metadata preserved',load(make(615,'video'),13)[0].still_path==='/fixture.jpg');
  check('fixture not mutated',JSON.stringify(original)===JSON.stringify(fixture));
  check('missing group',load(make(615,'video'),15).length===0);
  check('new provider inherits',make(615,'new').episodeGroupChoice(615).id==='digital');
  h.saveEpisodeGroup(615,'video','source',{group_id:'dvd',title:'DVD'});
  check('provider override isolated',make(615,'video').episodeGroupChoice(615).id==='dvd' && make(615,'cinemar').episodeGroupChoice(615).id==='digital');
  h.saveEpisodeGroup(615,'video','source',{group_id:''});
  check('explicit canonical override',make(615,'video').episodeGroupChoice(615)===null && load(make(615,'video'),1)[0].id===1);
  h.saveEpisodeGroup(615,'video','source',{inherit:true});
  check('inherit restored',make(615,'video').episodeGroupChoice(615).id==='digital');
  check('unrelated series remains canonical',make(616,'video').episodeGroupChoice(616)===null);
  store.online_episode_groups={'617:video':{id:'digital',name:'Digital'},'618:a':{id:'dvd',name:'DVD'},'618:b':{id:'prod',name:'Production'}};
  check('legacy unanimous migration',make(617,'new').episodeGroupChoice(617).id==='digital');
  check('legacy conflicting migration',make(618,'a').episodeGroupChoice(618).id==='dvd' && make(618,'b').episodeGroupChoice(618).id==='prod' && make(618,'new').episodeGroupChoice(618)===null);
  fail=true;
  check('failed alternate request returns no misleading canonical metadata',load(make(615,'video'),13).length===0 && requests.pop()==='tv/episode_group/digital');
  check('failed canonical request',load(make(616,'video'),1).length===0);
  check('specials group',h.groupEpisodes({groups:[{name:'Specials',order:0,episodes:[{id:1,order:0}]},{name:'Season 1',order:1,episodes:[{id:2,order:0}]}]},0)[0].id===1);
  check('movie bypass',load(make(615,'video',{id:615,title:'Movie'}),1).length===0);

  // Exercise all statically registered sync provider IDs, not just two examples.
  const providers = [...new Set([...source.match(/var balansers_sync = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).concat(['cinemar','videohub','future-provider']))];
  check('provider matrix includes configured and new sources', providers.length>=56);
  fail=false;
  const groupA={group_id:'digital',title:'Digital Order'};
  const groupB={group_id:'dvd',title:'DVD Order'};
  const groupC={group_id:'production',title:'Production Order'};
  const id=715;
  const actualChoice=extract('    this.getChoice =','    this.clearImages =');
  const actualSwitch=extract('    this.changeBalanser =','    this.requestParams =');
  const actualFilter=extract('    this.filter = function','    this.episodeTmdbId =');
  const actualFilterSelect=extract('      filter.onSelect = function','      if (filter.addButtonBack)');
  let active, menu, filterEntries, replacements=0, notices=0, defer=null, lastObject;
  Lampa.Arrays={extend(target,defaults,overwrite){for(const k in defaults)if(overwrite||!(k in target))target[k]=defaults[k];}};
  Lampa.Lang={translate:x=>x};
  Lampa.Activity={active:()=>({activity:active}),replace:()=>{replacements++;}};
  Lampa.Controller={toggle:()=>{}};
  Lampa.Select={show:x=>{menu=x;},close:()=>{}};
  Lampa.Noty={show:()=>{notices++;}};
  const oldGet=Lampa.Api.sources.tmdb.get;
  Lampa.Api.sources.tmdb.get=(path,params,ok,error)=>{
    if(path.endsWith('/episode_groups')){
      if(defer){defer={ok,error};return;}
      if(fail)return error();
      return ok({results:[{id:'digital',name:'Digital Order',group_count:14,episode_count:168},{id:'dvd',name:'DVD Order',group_count:8,episode_count:168},{id:'production',name:'Production Order',group_count:8,episode_count:168}]});
    }
    return oldGet(path,params,ok,error);
  };
  function ui(provider,card={id,name:'Futurama',source:'tmdb'}){
    const c={activity:{}};
    const object={movie:card};
    lastObject=object;
    const filter={set:(type,items)=>{if(type==='filter')filterEntries=items;},chosen:()=>{}};
    const sources=Object.fromEntries(providers.map(p=>[p,{name:p,show:true}]));
    new Function('Lampa','object','balanser','comp','filter','sources','filter_sources','filter_translate','_this','setTimeout',
      helpers+actualChoice+actualSwitch+actualFilter+methods+actualFilterSelect
    ).call(c,Lampa,object,provider,c,filter,sources,providers,{season:'Season',voice:'Voice'},c,fn=>fn());
    c.renderFilter=()=>{c.filter({season:['1','2'],voice:['A','B']},c.getChoice());return filterEntries.find(x=>x.stype==='episode_group');};
    c.open=(scope)=>{const entry=c.renderFilter();menu=null;filter.onSelect('filter',entry,entry.items[scope==='source'?1:0]);return menu;};
    active=c.activity;
    return c;
  }
  function choose(c,scope,groupId){
    const m=c.open(scope);
    const item=m.items.find(x=>groupId==='inherit'?x.inherit:x.group_id===groupId);
    if(!item)throw Error('menu item missing: '+groupId);
    m.onSelect(item);
  }
  // Seed actual per-provider settings and viewing state before touching episode order.
  for(const provider of providers){
    const c=ui(provider);
    c.saveChoice({season:1,voice:1,voice_name:'Voice '+provider,voice_id:3,episodes_view:{13:7},movie_view:'watched'});
  }
  store.online_watched_last={sentinel:{season:13,episode:7}};
  store.online_view=['viewed-sentinel'];
  store.online_last_balanser={[id]:'cinemar'};
  const snapshot=()=>clone(Object.fromEntries(Object.entries(store).filter(([k])=>k.startsWith('online_choice_')||['online_watched_last','online_view','online_last_balanser'].includes(k))));
  const baseline=snapshot();
  let c=ui('cinemar');
  const beforeReplace=replacements;
  choose(c,'series','digital');
  check('global order selected via actual filter callback and menu',replacements===beforeReplace+1&&lastObject.lampac_custom_select==='cinemar');
  for(const provider of providers){
    c=ui(provider);
    const menu=c.open('source');
    check('inherits digital via menu: '+provider,menu.items.find(i=>i.inherit).selected===true&&c.episodeGroupChoice(id).id==='digital');
    const eps=load(c,13);
    check('correct season metadata: '+provider,eps.length===10&&eps[0].id===1301&&requests.pop()==='tv/episode_group/digital');
  }
  check('selecting and reading order does not alter existing viewing data',JSON.stringify(snapshot())===JSON.stringify(baseline));
  for(const provider of providers){
    c=ui(provider);choose(c,'source','dvd');
    check('per-provider override persists after recreation: '+provider,ui(provider).episodeGroupChoice(id).id==='dvd');
  }
  c=ui('cinemar');choose(c,'series','production');
  for(const provider of providers){
    c=ui(provider);
    check('global change preserves explicit override: '+provider,c.episodeGroupChoice(id).id==='dvd');
    choose(c,'source','inherit');
    check('inherit uses changed global order: '+provider,ui(provider).episodeGroupChoice(id).id==='production');
  }
  c=ui('videohub');choose(c,'source','');
  check('explicit standard distinct from inherited choice',ui('videohub').episodeGroupChoice(id)===null&&ui('cinemar').episodeGroupChoice(id).id==='production');
  c=ui('videohub');const canonicalMenu=c.open('source');
  check('standard override indicated in menu',canonicalMenu.items.find(i=>i.group_id==='').selected===true&&!canonicalMenu.items.find(i=>i.inherit).selected);
  choose(c,'source','inherit');
  // Reconstruct the storage adapter from serialized bytes, as after a process/client restart.
  const serialized=JSON.stringify(store);
  for(const k of Object.keys(store))delete store[k];
  Object.assign(store,JSON.parse(serialized));
  check('serialized settings survive reload for every source',providers.every(p=>ui(p).episodeGroupChoice(id).id==='production'));
  check('cross-card TMDB ID resolves identical preferences',ui('cinemar',{id:9999,tmdb_id:id,name:'Futurama',source:'cub'}).episodeGroupChoice(id).id==='production');
  check('movie filter excludes episode group',!ui('cinemar',{id,title:'Movie'}).renderFilter());
  check('missing external TMDB ID excludes episode group',!ui('cinemar',{id,name:'Series',source:'unknown'}).renderFilter());
  c=ui('cinemar');c.changeBalanser('videohub',true);
  check('actual source switch retains series order and requests activity replace',ui('videohub').episodeGroupChoice(id).id==='production');
  check('existing progress and unrelated storage survive source switch',JSON.stringify(store.online_watched_last)===JSON.stringify(baseline.online_watched_last)&&JSON.stringify(store.online_view)===JSON.stringify(baseline.online_view)&&store.online_choice_videohub[id].episodes_view[13]===7);
  c=ui('cinemar');fail=true;const beforeNotices=notices;let failureMenu=c.open('source');
  check('menu handles unavailable group listing',notices===beforeNotices+1&&failureMenu.items.length===2);
  fail=false;
  c=ui('cinemar');defer=true;c.open('series');const stale=defer;defer=null;ui('videohub');menu=null;
  stale.ok({results:[{id:'stale',name:'Stale'}]});
  check('stale API response ignored after activity change',menu===null);
  c=ui('cinemar');choose(c,'series','');
  check('global standard reset applies to every inheriting source',providers.every(p=>ui(p).episodeGroupChoice(id)===null));
  check('other series keeps original setting',ui('cinemar',{id:615,name:'Futurama',source:'tmdb'}).episodeGroupChoice(615).id==='digital');
  check('unordered episode records sorted without mutation',h.groupEpisodes({groups:[{name:'Season 1',order:1,episodes:[{id:2,order:5},{id:1,order:0}]}]},1).map(e=>e.id).join(',')==='1,2');
  check('invalid season values do not map to a group',[-1,1.5,'invalid',Infinity].every(s=>h.groupEpisodes(fixture,s).length===0));
  check('invalid group payload is safe',[null,{}, {groups:null}, {groups:[{name:'Season 1'}]}].every(d=>h.groupEpisodes(d,1).length===0));
  console.log('Provider matrix: '+providers.length+' identifiers (including future provider)');
  console.log(count+' regression checks passed');
  return count;
}

run(readFileSync(new URL('../Online/plugin.js', import.meta.url), 'utf8'));
