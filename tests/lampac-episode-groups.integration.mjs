import assert from 'node:assert/strict';
import vm from 'node:vm';
const base = (process.env.LAMPAC_URL || 'http://127.0.0.1:19118').replace(/\/+$/, '');
const key = process.env.TMDB_API_KEY;
let checks = 0;
const pass = message => { checks++; console.log('PASS: ' + message); };
async function get(path) {
  try { return await fetch(base + path, {signal: AbortSignal.timeout(25000)}); }
  catch { throw new Error('HTTP request to Lampac failed'); }
}
const version = await get('/version?type=hash');
assert.ok(version.ok && (await version.text()).trim(), 'Lampac must be running');
pass('real Lampac version endpoint');
const response = await get('/online.js');
assert.ok(response.ok);
const source = await response.text();
assert.ok(source.includes('function episodeGroupPreferences'));
new vm.Script(source, {filename:'served-online.js'});
pass('real server-generated online.js parses');
const proxy = await get('/tmdbproxy.js');
assert.ok(proxy.ok && (await proxy.text()).includes('/tmdb/api/3/'));
pass('real TMDB proxy module');
if (!key) throw new Error('Server smoke checks passed; live tests require Actions secret TMDB_API_KEY');
async function api(path, params={}, status=200) {
  const q=new URLSearchParams({api_key:key,language:'ru-RU',...params});
  const r=await get('/tmdb/api/3/'+path+'?'+q);
  assert.equal(r.status,status,path+': unexpected HTTP status');
  return r.json();
}
function extract(a,b) {
  const i=source.indexOf(a),j=source.indexOf(b,i);
  assert.ok(i>=0&&j>i,'Missing served plugin functions');
  return source.slice(i,j);
}
const helpers=extract('  function groupEpisodes','  var Network =');
const methods=extract('    this.episodeTmdbId =','    this.watched =');
const store={};
let requestPath, error;
const Lampa={
  Storage:{cache:(k,t,d)=>k in store?structuredClone(store[k]):d,set:(k,v)=>{store[k]=structuredClone(v);}},
  Api:{sources:{tmdb:{get(path,params,ok,fail){
    requestPath=path;
    api(path,params).then(ok,e=>{error=e;fail();});
  }}}}
};
const H=new Function('Lampa',helpers+'; return {saveEpisodeGroup};')(Lampa);
function component(id,provider){
  const c={};
  new Function('Lampa','object','balanser','comp',helpers+methods).call(c,Lampa,{movie:{id,name:'Series',source:'tmdb'}},provider,c);
  return c;
}
async function load(id,provider,season){
  error=null;
  const episodes=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Plugin callback timeout')),35000);
    component(id,provider).getEpisodes(season,x=>{clearTimeout(timer);resolve(x);});
  });
  if(error) throw error;
  return episodes;
}
const groupId='5ad25f9b0e0a266c3101674b';
const show=await api('tv/615');
const listing=await api('tv/615/episode_groups');
assert.ok(listing.results.some(g=>g.id===groupId));
pass('Futurama Digital Order available through actual Lampac proxy');
if(show.number_of_seasons<13){
  const unavailable=await api('tv/615/season/13',{},404);
  assert.equal(unavailable.success,false);
  pass('original canonical season 13 returns 404');
}
const canonical=await api('tv/615/season/1');
assert.deepEqual((await load(615,'cinemar',1)).map(e=>e.id),canonical.episodes.map(e=>e.id));
assert.equal(requestPath,'tv/615/season/1');
pass('standard metadata path');
const detail=await api('tv/episode_group/'+groupId);
const ordered=d=>d.groups.slice().sort((a,b)=>a.order-b.order);
const sorted=g=>g.episodes.slice().sort((a,b)=>a.order-b.order);
const groups=ordered(detail);
assert.ok(groups.length>=14);
H.saveEpisodeGroup(615,'cinemar','series',{group_id:groupId,title:detail.name});
async function checkGroup(id,provider,season,group,selectedId){
  const episodes=await load(id,provider,season),expected=sorted(group);
  assert.equal(requestPath,'tv/episode_group/'+selectedId);
  assert.ok(expected.length);
  assert.equal(episodes.length,expected.length);
  for(let i=0;i<expected.length;i++){
    assert.equal(episodes[i].id,expected[i].id);
    assert.equal(episodes[i].episode_number,i+1);
    assert.equal(episodes[i].season_number,season);
    for(const field of ['name','overview','runtime','still_path','air_date','vote_average'])
      assert.equal(episodes[i][field],expected[i][field],field+' metadata mismatch');
  }
  return episodes;
}
for(let s=1;s<=14;s++){
  const eps=await checkGroup(615,'cinemar',s,groups[s-1],groupId);
  pass('Futurama Digital Order S'+s+' ('+eps.length+' live episodes)');
  if(s>=11){
    const first=sorted(groups[s-1])[0];
    const original=await api('tv/615/season/'+first.season_number+'/episode/'+first.episode_number);
    assert.equal(eps[0].id,original.id);
    assert.equal(eps[0].name,original.name);
    pass('Futurama S'+s+' identity agrees with canonical episode');
  }
}
await checkGroup(615,'videohub',13,groups[12],groupId);
pass('new provider inherits series setting');
H.saveEpisodeGroup(615,'videohub','source',{group_id:''});
assert.deepEqual((await load(615,'videohub',1)).map(e=>e.id),canonical.episodes.map(e=>e.id));
assert.equal(component(615,'cinemar').episodeGroupChoice(615).id,groupId);
pass('canonical override isolated');
H.saveEpisodeGroup(615,'videohub','source',{inherit:true});
await checkGroup(615,'videohub',14,groups[13],groupId);
pass('inheritance restored');
assert.equal(component(1668,'cinemar').episodeGroupChoice(1668),null);
pass('unrelated series remains canonical');


const syncList=source.match(/var balansers_sync = \[([\s\S]*?)\];/);
assert.ok(syncList,'provider registry missing from served plugin');
const providers=[...new Set([...syncList[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).concat(['cinemar','videohub','future-provider']))];
assert.ok(providers.length>=56);
const digitalChoice={group_id:groupId,title:detail.name};
const canonicalChoice={group_id:''};
const preferenceKey='online_episode_group_preferences';
function reloadStorage() {
  const persisted=JSON.stringify(store);
  for(const k of Object.keys(store))delete store[k];
  Object.assign(store,JSON.parse(persisted));
}
function hasOverride(provider){
  return Object.prototype.hasOwnProperty.call(store[preferenceKey]['615'].overrides,provider);
}
async function checkCanonical(provider){
  const episodes=await load(615,provider,1);
  assert.equal(requestPath,'tv/615/season/1');
  assert.deepEqual(episodes.map(e=>e.id),canonical.episodes.map(e=>e.id));
}
// Global Digital Order: every provider must resolve the live alternative data.
for(const provider of providers){
  await checkGroup(615,provider,13,groups[12],groupId);
  pass('live inherited Digital S13: '+provider);
}
// Explicit standard TMDB is a distinct override, not an absent setting.
for(const provider of providers){
  H.saveEpisodeGroup(615,provider,'source',canonicalChoice);
  assert.ok(hasOverride(provider));
  assert.equal(component(615,provider).episodeGroupChoice(615),null);
  await checkCanonical(provider);
  pass('live canonical override of Digital default: '+provider);
}
reloadStorage();
for(const provider of providers){
  assert.ok(hasOverride(provider));
  assert.equal(component(615,provider).episodeGroupChoice(615),null);
  H.saveEpisodeGroup(615,provider,'source',{inherit:true});
  assert.ok(!hasOverride(provider));
  assert.equal(component(615,provider).episodeGroupChoice(615).id,groupId);
  pass('canonical override survives reload and inherit restores Digital: '+provider);
}
// Reverse direction: individual Digital orders must outlive a change to the global default.
for(const provider of providers){
  H.saveEpisodeGroup(615,provider,'source',digitalChoice);
}
H.saveEpisodeGroup(615,'cinemar','series',canonicalChoice);
reloadStorage();
for(const provider of providers){
  assert.ok(hasOverride(provider));
  assert.equal(component(615,provider).episodeGroupChoice(615).id,groupId);
  await checkGroup(615,provider,13,groups[12],groupId);
  pass('live Digital override survives global reset and reload: '+provider);
}
for(const provider of providers){
  H.saveEpisodeGroup(615,provider,'source',{inherit:true});
  assert.ok(!hasOverride(provider));
  assert.equal(component(615,provider).episodeGroupChoice(615),null);
  await checkCanonical(provider);
  pass('live inherited standard after removing override: '+provider);
}
H.saveEpisodeGroup(615,'cinemar','series',digitalChoice);
assert.ok(providers.every(p=>component(615,p).episodeGroupChoice(615).id===groupId&&!hasOverride(p)));
pass('all '+providers.length+' provider IDs adopt restored global order');
// A second alternate group is optional catalog data. Test it if usable,
// but never abort the provider matrix solely because TMDB lacks one.
let secondAlternate=false;
for(const g of listing.results.filter(g=>g.id!==groupId)){
  const d=await api('tv/episode_group/'+g.id);
  const gs=ordered(d);
  if(!gs.length)continue;
  const specials=/^(?:specials?|(?:season|сезон)\s*0|спецвыпуски|специальные выпуски)$/i.test((gs[0].name||'').trim());
  const i=gs.findIndex(x=>x.episodes?.length);
  if(i<0)continue;
  H.saveEpisodeGroup(615,'videohub','source',{group_id:d.id,title:d.name});
  await checkGroup(615,'videohub',i+(specials?0:1),gs[i],d.id);
  assert.equal(component(615,'cinemar').episodeGroupChoice(615).id,groupId);
  H.saveEpisodeGroup(615,'videohub','source',{inherit:true});
  secondAlternate=true;
  pass('second alternate group: '+d.name);
  break;
}
if(!secondAlternate) console.log('INFO: no usable second Futurama alternate group; canonical versus Digital matrix completed');

const candidates=['American Dad!','Money Heist','Chilling Adventures of Sabrina','Firefly','Star Wars: The Clone Wars','Miraculous: Tales of Ladybug & Cat Noir','One Piece','Pokémon','Dragon Ball Super','Friends'];
const normalize=s=>s?.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
let found=0;
for(const title of candidates){
  const search=await api('search/tv',{query:title,language:'en-US'});
  const match=search.results.filter(t=>normalize(t.name)===normalize(title)||normalize(t.original_name)===normalize(title)).sort((a,b)=>b.popularity-a.popularity)[0];
  if(!match){console.log('INFO: '+title+': exact match not found');continue;}
  const list=await api('tv/'+match.id+'/episode_groups');
  let alt;
  for(const item of list.results.slice(0,12)){
    const d=await api('tv/episode_group/'+item.id);
    const gs=ordered(d);
    if(!gs.length||/^(?:specials?|(?:season|сезон)\s*0|спецвыпуски|специальные выпуски)$/i.test((gs[0].name||'').trim()))continue;
    const i=gs.findIndex((g,i)=>sorted(g).some((e,j)=>e.season_number!==i+1||e.episode_number!==j+1));
    if(i>=0){alt={d,i,group:gs[i]};break;}
  }
  if(!alt){console.log('INFO: '+title+' (TMDB '+match.id+'): no divergent group confirmed in inspected results');continue;}
  H.saveEpisodeGroup(match.id,'ci','series',{group_id:alt.d.id,title:alt.d.name});
  await checkGroup(match.id,'second-provider',alt.i+1,alt.group,alt.d.id);
  found++;
  pass(title+' (TMDB '+match.id+'): '+alt.d.name+', group '+(alt.i+1));
}
console.log('Candidate series with verified divergent group: '+found+'/'+candidates.length);
assert.equal(found,candidates.length,'All ten previously confirmed candidate series must pass');
console.log(checks+' live integration checks passed. Provider playback and Lampa UI are not covered.');
