import fs from 'node:fs';
import os from 'node:os';
import {buildGraph,generateRoutes,mergeExploration,EXPLORATION_STRATEGIES,meters,snapStart} from '../src/engine/routing.js';
import {adaptLiveRoutes} from '../src/live-adapter.js';
import {recommend} from '../src/domain.ts';
const cases=JSON.parse(fs.readFileSync(new URL('../data/cases.json',import.meta.url)));
let caseID='postech-5k',runs=3;
for(let i=2;i<process.argv.length;i+=2){if(process.argv[i]==='--case')caseID=process.argv[i+1];else if(process.argv[i]==='--runs')runs=Number(process.argv[i+1]);else throw Error('Usage: npm run bench -- --case postech-5k --runs 3');}
const input=cases.find(c=>c.id===caseID);if(!input||!Number.isInteger(runs)||runs<1||runs>20)throw Error('Unknown case or invalid runs (1–20)');
const results=[];
for(let run=0;run<runs;run++){
 const started=performance.now();
 const data=JSON.parse(fs.readFileSync(new URL('../public/map-data/pohang.json',import.meta.url)));
 const terrain=input.terrain?JSON.parse(fs.readFileSync(new URL('../public/map-data/terrain.json',import.meta.url))):null;
 const read=performance.now(),graph=buildGraph(data.raw,data.bbox,terrain),snap=snapStart(graph,input.point),ready=performance.now();
 const batches=[];
 for(let variant=0;variant<2;variant++)for(const profile of EXPLORATION_STRATEGIES)batches.push({...generateRoutes(graph,{...input,variant,profile,collect:true}),strategy:profile,variant});
 const generated=performance.now(),merged=mergeExploration(batches,input),routes=adaptLiveRoutes(merged.routes,graph),evaluated=performance.now();
 const recommendation=recommend(routes),end=performance.now();
 const invalid=routes.filter(r=>r.length<input.distance*.8-1e-7||r.length>input.distance*1.2+1e-7||meters(r.points[0],snap.point)>1||meters(r.points[0],r.points.at(-1))>.1).length;
 if(invalid)throw Error('Closure/start/distance invariant failed');
 results.push({run:run+1,candidates:routes.length,pending:recommendation.pending,cards:recommendation.cards.map(c=>({id:c.route.id,length:c.route.length,reasons:c.reasons})),ms:{readAndParse:read-started,graphAndSnap:ready-read,generateWithInlineEvidence:generated-ready,mergeAndAdapt:evaluated-generated,select:end-evaluated,total:end-started}});
}
console.log(JSON.stringify({case:input,node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,networkMeasured:false,browserWorkerMeasured:false,cache:'process-local repeated execution; OS file cache uncontrolled',results},null,2));
