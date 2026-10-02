import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {sanitizeOSM,assertCleanOSM} from '../scripts/sanitize-osm.mjs';
import {prepareRegions,cleanTile,sha256} from '../scripts/prepare-regions.mjs';
const raw={format:2,version:'dataset-version',osmTimestamp:'source-date',elements:[{type:'node',id:7,lat:0,lon:0,user:'sample',uid:8,timestamp:'edit-date',changeset:9,version:2,tags:{highway:'crossing','crossing:signals':'no',phone:'test-contact','contact:email':'test-contact'}}]};
const bytes=gzipSync(JSON.stringify(raw));
const tile={file:'700-2500-'+sha256(bytes).slice(0,16)+'.json.gz',bytes:bytes.length,sha256:sha256(bytes)};
const index={format:2,version:'source-v1',baseUrl:'https://example.test/',tiles:{'700,2500':tile}};
test('cleanup preserves geometry, IDs, tags, and dataset provenance; is idempotent',()=>{
 const clean=sanitizeOSM({fetchedAt:'snapshot',raw});assertCleanOSM(clean);
 assert.equal(clean.raw.version,'dataset-version');assert.equal(clean.raw.osmTimestamp,'source-date');
 assert.deepEqual(clean.raw.elements,[{type:'node',id:7,lat:0,lon:0,tags:{highway:'crossing','crossing:signals':'no'}}]);
 assert.deepEqual(sanitizeOSM(clean),clean);assert.throws(()=>assertCleanOSM(raw));
});
test('source validation happens before sanitization; transformed bytes have a new hash',()=>{
 assert.throws(()=>cleanTile(Buffer.from('changed'),tile),/mismatch/);
 const out=cleanTile(bytes,tile);assert.notEqual(sha256(out),tile.sha256);assertCleanOSM(JSON.parse(gunzipSync(out)));
});
test('successful preparation publishes a complete new manifest and can run again without fetching',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'route-data-'));
 try {
  let calls=0;const output=path.join(dir,'public','map-regions');const cacheDir=path.join(dir,'cache');
  const options={index,output,cacheDir,fetcher:async()=>{calls++;return new Response(bytes);}};
  const result=await prepareRegions(options);
  assert.equal(calls,1);assert.equal(result.version,'source-v1-public-v1');assert.notEqual(result.tiles['700,2500'].file,tile.file);
  assertCleanOSM(JSON.parse(gunzipSync(await fs.readFile(path.join(output,result.tiles['700,2500'].file)))));
  assert.deepEqual(await prepareRegions(options),result);assert.equal(calls,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('a failed tile never publishes partial data and leaves the previous pack intact; retry reuses clean cache',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'route-data-'));
 try {
  const output=path.join(dir,'pack'), cacheDir=path.join(dir,'cache');await fs.mkdir(output);
  await fs.writeFile(path.join(output,'manifest.json'),'{"version":"old"}');
  const other=gzipSync(JSON.stringify({...raw,elements:[]}));
  const t2={file:'700-2501-'+sha256(other).slice(0,16)+'.json.gz',bytes:other.length,sha256:sha256(other)};
  const both={...index,tiles:{...index.tiles,'700,2501':t2}};
  const opts={index:both,output,cacheDir,fetcher:async(url)=>String(url).endsWith(tile.file)?new Response(bytes):new Response('',{status:404})};
  await assert.rejects(prepareRegions(opts),/unavailable|abort/i);
  assert.equal((await fs.readFile(path.join(output,'manifest.json'),'utf8')),'{"version":"old"}');
  const cleanCache=await fs.readdir(cacheDir);assert.ok(cleanCache.every(x=>!x.includes(tile.file)));
  const result=await prepareRegions({...opts,fetcher:async(url)=>new Response(String(url).endsWith(tile.file)?bytes:other)});
  assert.equal(Object.keys(result.tiles).length,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('local restore follows identical source verification and cleanup; traversal filenames are rejected',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'route-data-'));
 try {
  await fs.writeFile(path.join(dir,tile.file),bytes);
  const opts={index,output:path.join(dir,'out'),cacheDir:path.join(dir,'cache'),localSource:dir};
  const result=await prepareRegions(opts);assert.equal(result.privacyPolicy,'public-v1');
  await assert.rejects(prepareRegions({...opts,index:{...index,tiles:{bad:{...tile,file:'../bad'}}}}),/filename/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
