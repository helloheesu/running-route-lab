import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {sanitizeOSM, assertCleanOSM, privacyPolicy} from './sanitize-osm.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function cleanTile(bytes, expected) {
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw Error('Source tile size/hash mismatch; source snapshot must not be substituted');
  const raw = sanitizeOSM(JSON.parse(gunzipSync(bytes)));
  assertCleanOSM(raw);
  return gzipSync(JSON.stringify(raw), {level:7});
}
async function readJSON(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
function safeFile(name) {
  if (!/^\d+-\d+-[a-f0-9]{16}\.json\.gz$/.test(name)) throw Error('Invalid tile filename');
  return name;
}
export async function prepareRegions({index, output, cacheDir, localSource, fetcher=fetch, onProgress=()=>{}}) {
  if (!index.tiles || index.format !== 2 || !index.version || !Object.keys(index.tiles).length) throw Error('Invalid source index');
  for (const tile of Object.values(index.tiles)) {
    safeFile(tile.file);
    if (!/^[a-f0-9]{64}$/.test(tile.sha256) || !(tile.bytes > 0)) throw Error('Source hashes required');
  }
  const sourceID=sha256(Buffer.from(JSON.stringify(index)));
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.mkdir(cacheDir,{recursive:true});
  const lock = output + '.lock';
  await fs.mkdir(lock).catch(()=>{throw Error('Preparation is already active, or an interrupted lock remains. See docs/SETUP.md.');});
  let stage;
  try {
    const existing=await readJSON(path.join(output,'manifest.json')).catch(()=>null);
    if(existing?.sourceIndexHash === sourceID && existing?.privacyPolicy === privacyPolicy.version) {
      let valid=true;
      if(Object.keys(existing.tiles||{}).length!==Object.keys(index.tiles).length) valid=false;
      for (const [key, tile] of Object.entries(existing.tiles||{})) {
        const bytes=await fs.readFile(path.join(output,safeFile(tile.file))).catch(()=>null);
        if(!index.tiles[key] || !bytes || bytes.length!==tile.bytes || sha256(bytes)!==tile.sha256) {valid=false;break;}
        assertCleanOSM(JSON.parse(gunzipSync(bytes)));
      }
      if(valid) {onProgress('All regional tiles already prepared and verified.');return existing;}
    }
    stage=await fs.mkdtemp(path.join(path.dirname(output),'.regions-staging-'));
    const controller=new AbortController();
    const entries=Object.entries(index.tiles), tiles={};let cursor=0,completed=0;
    async function worker() {
      while(cursor<entries.length) {
        controller.signal.throwIfAborted();
        const [key, source]=entries[cursor++];
        const cacheFile=path.join(cacheDir,source.sha256+'.json.gz');
        const cacheHash=cacheFile+'.sha256';
        let packed=await fs.readFile(cacheFile).catch(()=>null);
        const digest=await fs.readFile(cacheHash,'utf8').catch(()=>null);
        if(packed && digest===sha256(packed)) {
          try {assertCleanOSM(JSON.parse(gunzipSync(packed)));} catch {packed=null;}
        } else packed=null;
        if(!packed) {
          let raw;
          if(localSource) raw=await fs.readFile(path.join(localSource,source.file));
          else {
            const url=new URL(source.file,index.baseUrl);
            if(url.protocol!=='https:') throw Error('HTTPS source required');
            const res=await fetcher(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
            if(!res.ok) throw Error(`Source tile unavailable (${res.status}). Retry or rebuild the recorded snapshot; see docs/DATA.md.`);
            raw=Buffer.from(await res.arrayBuffer());
          }
          packed=cleanTile(raw,source);
          await fs.writeFile(cacheFile,packed);
          await fs.writeFile(cacheHash,sha256(packed));
        }
        const hash=sha256(packed), file=key.replace(',','-')+'-'+hash.slice(0,16)+'.json.gz';
        safeFile(file);
        await fs.writeFile(path.join(stage,file),packed);
        tiles[key]={file,bytes:packed.length,sha256:hash};
        if(++completed%100===0 || completed===entries.length) onProgress(`Prepared ${completed}/${entries.length} tiles`);
      }
    }
    let firstFailure;
    await Promise.allSettled(Array.from({length:3},()=>worker().catch(e=>{firstFailure ||= e;controller.abort();throw e;})));
    if(firstFailure)throw firstFailure;
    const {baseUrl,...metadata}=index;
    const manifest={...metadata,version:index.version+'-'+privacyPolicy.version,privacyPolicy:privacyPolicy.version,sourceIndexHash:sourceID,tiles:Object.fromEntries(Object.entries(tiles).sort(([a],[b])=>a.localeCompare(b)))};
    await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest)+'\n');
    await fs.copyFile(new URL('../data/ATTRIBUTION.md',import.meta.url),path.join(stage,'README.md'));
    // Only a complete pack becomes visible to the app; preserve the old one until then.
    const backup=output+'.previous';
    try {await fs.access(backup);throw Error('Previous pack backup exists; see docs/SETUP.md before retrying.');}catch(e){if(e.code!=='ENOENT')throw e;}
    let moved=false;
    try {await fs.rename(output,backup);moved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    try {await fs.rename(stage,output);stage=null;}catch(e){if(moved)await fs.rename(backup,output);throw e;}
    if(moved)await fs.rm(backup,{recursive:true});
    return manifest;
  } finally {
    if(stage)await fs.rm(stage,{recursive:true,force:true});
    await fs.rm(lock,{recursive:true,force:true});
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const args=process.argv.slice(2);
  if(args.length && (args.length!==2 || args[0]!=='--from'))throw Error('Usage: npm run data:regions [-- --from DIRECTORY]');
  try {
    const result=await prepareRegions({index:await readJSON(path.join(root,'data/regions-source.json')),output:path.join(root,'public/map-regions'),cacheDir:path.join(root,'work/clean-tiles/'+privacyPolicy.version),localSource:args[0]?path.resolve(args[1]):undefined,onProgress:console.log});
    console.log(`Ready: ${Object.keys(result.tiles).length} tiles. Restart dev server / rebuild static output.`);
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
