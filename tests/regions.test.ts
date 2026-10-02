import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { contains, regionBounds, fetchRoads, tileKeys, mergeTiles, loadRegion, decodeTile, supportsOrigin } from '../src/region-data.ts';
import fs from 'node:fs';
const raw = { elements:[{type:'way',id:1,tags:{highway:'footway'},nodes:[1,2],geometry:[{lat:37.54,lon:127.04},{lat:37.541,lon:127.04}]}] };
const index={format:1,version:'test-v1',step:.05,osmTimestamp:'2026-09-29',builtAt:'2026-09-30',tiles:Object.fromEntries(tileKeys(regionBounds([37.5445,127.0374],12),.05).map(key=>[key,{file:key.replace(',','-')+'-abcdef.json.gz',bytes:100}]))};
test('regional coverage includes the maximum possible extent at 1–12 km, and excludes distant places', () => {
  for(const km of [1,5,12]) {
    const p: [number,number]=[37.5445,127.0374], bbox=regionBounds(p,km);
    assert.ok(contains({bbox,raw,terrain:null,fetchedAt:''},p,km));
    assert.ok(!contains({bbox,raw,terrain:null,fetchedAt:''},[36.0135,129.325]));
  }
});
test('adjacent tile overlap keeps shared OSM IDs and tags without duplicate crossings', () => {
  const signal={type:'node',id:2,lat:37.54,lon:127.04,tags:{highway:'crossing','crossing:signals':'yes'}};
  const merged=mergeTiles([{elements:[...raw.elements,signal]},{elements:[signal,...raw.elements]}]);
  assert.equal(merged.elements.length,2); assert.deepEqual(merged.elements.find(x=>x.type==='way'),raw.elements[0]); assert.deepEqual(merged.elements.find(x=>x.type==='node'),signal);
  assert.deepEqual(mergeTiles([{elements:[signal,...raw.elements]},{elements:[...raw.elements,signal]}]),merged);
});
test('missing map tiles fail the region instead of routing on partial data', async () => {
  const originalLocation=globalThis.location;
  Object.assign(globalThis,{location:{origin:'http://localhost'}});
  try {
    let calls=0;
    await assert.rejects(fetchRoads(regionBounds([37.5445,127.0374],5),index,new AbortController().signal,()=>{},async () => ++calls===1 ? new Response('',{status:404}) : new Response(gzipSync(JSON.stringify(raw)))),/주변 지도/);
  } finally {Object.assign(globalThis,{location:originalLocation});}
});
test('already cancelled region requests make no network calls', async () => {
  const c=new AbortController(); c.abort(); let calls=0;
  await assert.rejects(fetchRoads(regionBounds([37.5445,127.0374],5),index,c.signal,()=>{},async () => {calls++;return new Response('');}), {name:'AbortError'});
  assert.equal(calls,0);
});
test('versioned cache survives reload, preserves missing elevation and expands to longer distances', async () => {
  const oldFetch=globalThis.fetch, oldCaches=globalThis.caches, oldLocation=globalThis.location;
  let requests=0; const maps=new Map<string,Map<string,Response>>();
  Object.assign(globalThis,{location:{origin:'http://localhost'},caches:{open:async (name:string)=>{
    if(!maps.has(name)) maps.set(name,new Map()); const m=maps.get(name)!;
    return {keys:async()=>[...m.keys()],match:async(k:string)=>m.get(k)?.clone(),put:async(k:string,r:Response)=>{m.set(k,r.clone());},delete:async(k:string)=>m.delete(k)};
  }},fetch:async(url:string)=>{
    if(String(url).endsWith('manifest.json'))return new Response(JSON.stringify(index));
    requests++;
    return String(url).includes('terrarium') ? new Response('',{status:503}) : new Response(gzipSync(JSON.stringify(raw)));
  }});
  try {
    const c=new AbortController(), p: [number,number]=[37.5445,127.0374];
    const data=await loadRegion(p,5,c.signal,()=>{}), first=requests;
    assert.equal(data.terrain,null); assert.equal(data.version,index.version);
    assert.equal(await loadRegion(p,5,c.signal,()=>{}),data); assert.equal(requests,first);
    const {loadRegion: reloaded}=await import('../src/region-data.ts?fresh-cache');
    assert.deepEqual(await reloaded(p,5,c.signal,()=>{}),data); assert.equal(requests,first);
    await loadRegion(p,12,c.signal,()=>{}); assert.ok(requests>first);
    index.version='test-v2';
    const {loadRegion: updated}=await import('../src/region-data.ts?updated-cache');
    assert.equal((await updated(p,5,c.signal,()=>{})).version,'test-v2');
  } finally { Object.assign(globalThis,{fetch:oldFetch,caches:oldCaches,location:oldLocation}); }
});

test('compact tiles preserve every node ID and 1e-7 degree coordinate, including negative deltas', () => {
  const decoded=decodeTile({format:2,elements:[{type:'way',id:4,tags:{highway:'footway'},refs:[12345678901,-1,55],coords:[375432101,1270332101,13,-52,-20,45]}]});
  const e=decoded.elements[0];
  assert.deepEqual(e.nodes,[12345678901,12345678900,12345678955]);
  assert.deepEqual(e.geometry,[{lat:37.5432101,lon:127.0332101},{lat:37.5432114,lon:127.0332049},{lat:37.5432094,lon:127.0332094}]);
  assert.equal(e.bounds.minlat,37.5432094); assert.equal(e.bounds.maxlon,127.0332101);
  assert.throws(()=>decodeTile({format:2,elements:[{type:'way',refs:[1,2],coords:[1,2]}]}),/잘못된/);
});

test('administrative origin coverage includes the whole metro and Gyeongsang regions, excluding unrelated regions', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/regions-source.json', import.meta.url), 'utf8'));
  assert.ok(manifest.coverage);
  for (const point of [[37.5665,126.978], [37.65,127.056], [37.498,127.028], [37.655,126.773], [37.2636,127.0286], [37.4563,126.7052], [36.019,129.3435], [35.8714,128.6014], [35.5384,129.3114], [35.1796,129.0756], [35.2285,128.6811]]) assert.ok(supportsOrigin(point as [number,number], manifest.coverage), String(point));
  for (const point of [[33.4996,126.5312], [36.3504,127.3845], [35.1595,126.8526], [37.8813,127.73]]) assert.ok(!supportsOrigin(point as [number,number], manifest.coverage), String(point));
});

test('origin mask respects holes and independent island polygons', () => {
  const coverage = {type:'MultiPolygon' as const,coordinates:[[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]],[[[5,5],[6,5],[6,6],[5,6],[5,5]]]]};
  assert.ok(supportsOrigin([.5,.5],coverage));
  assert.ok(!supportsOrigin([1.5,1.5],coverage));
  assert.ok(supportsOrigin([5.5,5.5],coverage));
  assert.ok(supportsOrigin([0,2],coverage));
  assert.ok(!supportsOrigin([7,7],coverage));
});
