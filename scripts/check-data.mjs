import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {assertCleanOSM} from './sanitize-osm.mjs';
import {sha256} from './prepare-regions.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function checkPack(dir) {
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
  if(manifest.privacyPolicy!=='public-v1' || !Object.keys(manifest.tiles||{}).length)throw Error('A complete sanitized regional manifest is required');
  for(const tile of Object.values(manifest.tiles)) {
    if(!/^\d+-\d+-[a-f0-9]{16}\.json\.gz$/.test(tile.file))throw Error('Invalid tile path');
    const bytes=await fs.readFile(path.join(dir,tile.file));
    const hash=sha256(bytes);
    if(bytes.length!==tile.bytes || hash!==tile.sha256 || !tile.file.endsWith(hash.slice(0,16)+'.json.gz'))throw Error('Regional tile checksum mismatch');
    assertCleanOSM(JSON.parse(gunzipSync(bytes)));
  }
  return Object.keys(manifest.tiles).length;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const sample=JSON.parse(await fs.readFile(path.join(root,'public/map-data/pohang.json'),'utf8'));assertCleanOSM(sample);
    const terrain=JSON.parse(await fs.readFile(path.join(root,'public/map-data/terrain.json'),'utf8'));
    const demo=JSON.parse(await fs.readFile(path.join(root,'public/demo/postech-5k.json'),'utf8'));
    if(!terrain.values?.length || !demo.routes?.length)throw Error('Sample terrain/demo missing');
    console.log(`Sample clean: ${sample.raw.elements.length} OSM elements, terrain and demo present.`);
    const args=process.argv.slice(2);
    if(args.length && (args.length!==2 || args[0]!=='--regions'))throw Error('Usage: npm run data:check [-- --regions DIRECTORY]');
    const dir=args.length?path.resolve(args[1]):path.join(root,'public/map-regions');
    const present=await fs.stat(path.join(dir,'manifest.json')).catch(()=>null);
    if(present)console.log(`Regional pack verified: ${await checkPack(dir)} tiles.`);
    else if(args.length)throw Error('Requested regional pack does not exist');
    else console.log('Sample-only mode. Regional pack is optional: npm run data:regions');
  } catch(e) {console.error(e.message);process.exitCode=1;}
}
