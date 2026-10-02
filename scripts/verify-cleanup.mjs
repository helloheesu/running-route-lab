// Optional one-time comparison against a separately supplied original, never committed here.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildGraph,generateRoutes,mergeExploration,EXPLORATION_STRATEGIES} from '../src/engine/routing.js';
import {adaptLiveRoutes} from '../src/live-adapter.js';
import {recommend} from '../src/domain.ts';
import {sanitizeOSM} from './sanitize-osm.mjs';
if(process.argv.length!==3)throw Error('Usage: node scripts/verify-cleanup.mjs ORIGINAL_SAMPLE_JSON');
const original=JSON.parse(fs.readFileSync(process.argv[2]));
const released=JSON.parse(fs.readFileSync(new URL('../public/map-data/pohang.json',import.meta.url)));
assert.deepEqual(sanitizeOSM(original),released);
const terrain=JSON.parse(fs.readFileSync(new URL('../public/map-data/terrain.json',import.meta.url)));
const before=buildGraph(original.raw,original.bbox,terrain),after=buildGraph(released.raw,released.bbox,terrain);
assert.deepEqual(before,after);
function run(graph){
 const options={point:[36.0135,129.325],distance:5000,avoidSteps:true},batches=[];
 for(let variant=0;variant<2;variant++)for(const profile of EXPLORATION_STRATEGIES)batches.push({...generateRoutes(graph,{...options,variant,profile,collect:true}),strategy:profile,variant});
 const pool=mergeExploration(batches,options); const routes=adaptLiveRoutes(pool.routes,graph);
 return {routes,recommendation:recommend(routes)};
}
const a=run(before),b=run(after);assert.deepEqual(a,b);
console.log(JSON.stringify({equalGraph:true,equalCandidates:true,equalRecommendations:true,candidates:a.routes.length}));
