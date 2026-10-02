import { snapStart, shortestTree, pathTo, evaluateRoute, generateRoutes, mergeExploration, meters } from './routing.js';
import { compareRecommendations, physicalOverlap, recommendationScore } from './route-comparison.js';
import { edgeBonus } from './route-evidence.js';

export const NEARBY_POLICY={minAccess:80,maxAccess:300,maxStarts:4,maxRunError:.05,minScoreGain:10,minEvidenceGain:.20,walkingCostPer100m:1,maxProposals:2};
// Both directions must follow connected, permitted graph edges. A map-near
// location or a snap offset alone is never an access route.
export function nearbyAccess(base,options) {
  const snapped=snapStart(base,options.point),{graph,start}=snapped;
  const tree=shortestTree(graph,start,{profile:'distance',avoidSteps:options.avoidSteps,maxLength:NEARBY_POLICY.maxAccess});
  const nodes=graph.nodes.map((n,i)=>({i,point:n.p,distance:tree.lengths[i],bonus:Math.max(0,...graph.adj[i].map(a=>edgeBonus(graph.edges[a.ei])))}))
    .filter(n=>n.distance>=NEARBY_POLICY.minAccess&&n.distance<=NEARBY_POLICY.maxAccess&&n.bonus>0)
    .sort((a,b)=>b.bonus-a.bonus||b.distance-a.distance||a.i-b.i);
  const selected=[];
  for(const node of nodes) {
    if(selected.some(s=>meters(s.point,node.point)<100))continue;
    const resnapped=snapStart(base,node.point);
    if(resnapped.graph.nodes[resnapped.start].id!==graph.nodes[node.i].id)continue;
    const backTree=shortestTree(graph,node.i,{profile:'distance',avoidSteps:options.avoidSteps,target:start,maxLength:NEARBY_POLICY.maxAccess});
    const outbound=pathTo(graph,tree,node.i),inbound=pathTo(graph,backTree,start);
    if(!outbound?.length||!inbound?.length)continue;
    // Only access facts are needed, so avoid terrain sampling for these short walks.
    const accessGraph={...graph,terrain:null};
    selected.push({point:node.point,nodeId:graph.nodes[node.i].id,access:{outbound:evaluateRoute(accessGraph,outbound,tree.lengths[node.i]),inbound:evaluateRoute(accessGraph,inbound,backTree.lengths[start])}});
    if(selected.length>=NEARBY_POLICY.maxStarts)break;
  }
  return selected;
}

export function qualifyNearby(route,baseline,access,targetDistance) {
  if(!baseline||!route.evidence||!baseline.evidence||Math.abs(route.length-targetDistance)/targetDistance>NEARBY_POLICY.maxRunError+1e-8)return null;
  const walking=access.outbound.length+access.inbound.length;
  if(access.outbound.length>NEARBY_POLICY.maxAccess||access.inbound.length>NEARBY_POLICY.maxAccess)return null;
  // A positive-only score must not hide new documented interruptions or stairs.
  if(route.steps+access.outbound.steps+access.inbound.steps>baseline.steps+.1)return null;
  if(route.crossings.length+access.outbound.crossings.length+access.inbound.crossings.length>baseline.crossings.length)return null;
  const walkingPenalty=walking/100*NEARBY_POLICY.walkingCostPer100m;
  const scoreGain=recommendationScore(route)-recommendationScore(baseline)-walkingPenalty;
  if(scoreGain<NEARBY_POLICY.minScoreGain)return null;
  const reasons=[];
  for(const [field,label] of [['pavedWalkRatio','포장 노면이 기록된 보행로'],['litWalkRatio','조명 있음으로 기록된 보행로'],['wideWalkRatio','폭 3m 이상으로 기록된 보행로']]) {
    const a=route.evidence[field],b=baseline.evidence[field];
    if(!Number.isFinite(a)||!Number.isFinite(b))continue;
    if(a-b>=NEARBY_POLICY.minEvidenceGain-1e-8)reasons.push(`${label} ${Math.round(b*100)}% → ${Math.round(a*100)}% (+${Math.round((a-b)*100)}%p)`);
  }
  if(!reasons.length)return null;
  return {scoreGain,walkingPenalty,reasons,baselineId:baseline.id,totalDistance:route.length+walking};
}

export async function findNearbyStarts(base,options,result,{cancelled=()=>false,onProgress=()=>{}}={}) {
  const representatives=new Set(result.families?.map(f=>f.representativeId));
  const originalCandidates=result.families?.length?result.routes.filter(r=>representatives.has(r.id)):result.routes;
  const baseline=[...originalCandidates].sort(compareRecommendations)[0];
  if(!baseline)return [];
  const anchors=nearbyAccess(base,options),proposals=[];
  for(let i=0;i<anchors.length;i++) {
    if(cancelled())return [];
    const anchor=anchors[i],batches=[];
    const snappedAnchor=snapStart(base,anchor.point);
    if(snappedAnchor.graph.nodes[snappedAnchor.start].id!==anchor.nodeId)continue;
    for(const strategy of ['balanced','flow']) {
      if(cancelled())return [];
      batches.push({...generateRoutes(base,{...options,point:anchor.point,profile:strategy,variant:0,collect:true}),strategy,variant:0});
      onProgress({completed:i*2+batches.length,total:anchors.length*2});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const nearby=mergeExploration(batches,{...options,point:anchor.point});
    // Reject any ambiguous resnap instead of drawing an unverified connector.
    if(!nearby.snap||meters(nearby.snap.point,anchor.point)>.1)continue;
    const nearbyRepresentatives=new Set(nearby.families.map(f=>f.representativeId));
    for(const route of nearby.routes.filter(r=>nearbyRepresentatives.has(r.id)).sort(compareRecommendations)) {
      const quality=qualifyNearby(route,baseline,anchor.access,options.distance);
      if(!quality)continue;
      proposals.push({id:`nearby-${i+1}`,route:{...route,id:`nearby-${i+1}`},snap:nearby.snap,access:anchor.access,...quality});break;
    }
  }
  const selected=[];
  for(const p of proposals.sort((a,b)=>b.scoreGain-a.scoreGain||a.id.localeCompare(b.id))) {
    if(selected.some(s=>physicalOverlap(s.route,p.route).longCommon>=.9))continue;
    selected.push(p);if(selected.length===NEARBY_POLICY.maxProposals)break;
  }
  return cancelled()?[]:selected;
}
