import { UNPAVED } from './route-evidence.js';
import { clusterBySimilarity } from './route-clustering.js';
// Presentation families never delete original candidates. Thresholds are test hypotheses.
export const COMPARISON_POLICY = { distanceWeight: 30, subsetOverrunWeight: 150, strictContainment: .999, completionFraction: .05, completionMaxMeters: 300, completionMinMeters: 10, meanSimilarity: .65, minimumPairSimilarity: .50, similarity: 'physical-traversal-dice', grouping: 'guarded-average-linkage', subsetScope: 'all-candidates' };
export function routeComparison(route, targetDistance) {
  const error = targetDistance > 0 ? Math.abs(route.length-targetDistance)/targetDistance : (route.error || 0);
  const distancePenalty = COMPARISON_POLICY.distanceWeight * error;
  return { error, targetDistance, distancePenalty, score: (route.evidence?.bonus || 0)-distancePenalty };
}
const cache = new WeakMap();
function coverage(route) {
  if(cache.has(route)) return cache.get(route);
  const events = new Map(), density = new Map();
  for(const s of route.segments || []) {
    if(!s.physicalId || !Number.isFinite(s.from) || !Number.isFinite(s.to)) continue;
    if(!events.has(s.physicalId)) events.set(s.physicalId,[]);
    events.get(s.physicalId).push([Math.min(s.from,s.to),1],[Math.max(s.from,s.to),-1]);
  }
  let total=0;
  for(const [id,list] of events) {
    list.sort((a,b)=>a[0]-b[0]);const intervals=[];let count=0,previous=list[0][0];
    for(const [at,delta] of list) {if(count>0&&at>previous){intervals.push([previous,at,count]);total+=(at-previous)*count;}count+=delta;previous=at;}
    density.set(id,intervals);
  }
  const value={density,total};cache.set(route,value);return value;
}
export function physicalOverlap(a,b) {
  const A=coverage(a),B=coverage(b);let shared=0;
  for(const [id,aa] of A.density) {
    const bb=B.density.get(id);if(!bb)continue;let i=0,j=0;
    while(i<aa.length&&j<bb.length){const x=aa[i],y=bb[j];shared+=Math.max(0,Math.min(x[1],y[1])-Math.max(x[0],y[0]))*Math.min(x[2],y[2]);if(x[1]<y[1])i++;else j++;}
  }
  return {shared,shortContainment:shared/Math.min(A.total,B.total)||0,longCommon:shared/Math.max(A.total,B.total)||0};
}
export function routeSimilarity(a,b) {
  const overlap=physicalOverlap(a,b),total=coverage(a).total+coverage(b).total;
  return total>0?Math.min(1,2*overlap.shared/total):0;
}
export function recommendationScore(route) {
  return route.comparison?.recommendationScore ?? route.comparison?.score ?? route.evidence?.bonus ?? 0;
}
export function compareRecommendations(a,b) {
  return recommendationScore(b)-recommendationScore(a)
    ||(a.comparison?.error ?? a.error ?? 0)-(b.comparison?.error ?? b.error ?? 0)||a.id.localeCompare(b.id);
}
export function smallDeficit(route,target) {
  const missing=target-route.length;
  return missing>=COMPARISON_POLICY.completionMinMeters-.01&&missing<=Math.min(COMPARISON_POLICY.completionMaxMeters,target*COMPARISON_POLICY.completionFraction)+.01;
}
export function strictExtension(shorter,longer) {
  return longer.length>shorter.length+.5&&physicalOverlap(shorter,longer).shortContainment>=COMPARISON_POLICY.strictContainment;
}
export function recordedBurden(route) {
  const totals={crossing:0,steps:0,unpaved:0,unlit:0};
  for(const s of route.segments||[]){if(s.crossing)totals.crossing+=s.length;if(s.steps)totals.steps+=s.length;if(UNPAVED.has(s.surface))totals.unpaved+=s.length;if(s.lit==='no')totals.unlit+=s.length;}
  return totals;
}
export function addedBurden(shorter,longer) {
  const a=recordedBurden(shorter),b=recordedBurden(longer);
  return Object.keys(a).filter(key=>b[key]>a[key]+.1||(key==='crossing'&&(longer.crossings?.length||0)>(shorter.crossings?.length||0)));
}
const burdenLabels={crossing:'등록 횡단',steps:'계단',unpaved:'비포장',unlit:'조명 없음 기록'};
export function compareCandidates(routes) {
  const comparisons={};
  for(const r of routes) {
    const base=r.comparison||routeComparison(r),target=base.targetDistance;
    // A contained route is a valid reference even if presentation put it elsewhere.
    const subsets=routes.filter(s=>strictExtension(s,r));
    const peer=subsets.sort((a,b)=>Math.max(0,a.length-target)-Math.max(0,b.length-target)||Math.abs(a.length-target)-Math.abs(b.length-target)||a.id.localeCompare(b.id))[0];
    const avoidableOverrun=peer&&target>0?Math.max(0,r.length-Math.max(target,peer.length)):0;
    const subsetOverrunPenalty=target>0?COMPARISON_POLICY.subsetOverrunWeight*avoidableOverrun/target:0;
    const overlap=peer?physicalOverlap(peer,r):null;
    comparisons[r.id]={...base,avoidableOverrun,subsetOverrunPenalty,subsetReferenceId:peer?.id||null,subsetReferenceLength:peer?.length??null,subsetContainment:overlap?.shortContainment??null,recommendationScore:base.score-subsetOverrunPenalty,familyScore:base.score-subsetOverrunPenalty};
  }
  return comparisons;
}
export function compareWithinFamily(members, allComparisons=compareCandidates(members)) {
  const comparisons=Object.fromEntries(members.map(r=>[r.id,allComparisons[r.id]])),decisions=[],dominated=new Set();
  for(const shorter of members) {
    const target=shorter.comparison?.targetDistance;
    if(!target||!smallDeficit(shorter,target))continue;
    for(const full of members) {
      if(Math.abs(full.length-target)>1||!strictExtension(shorter,full))continue;
      const added=addedBurden(shorter,full),winner=added.length?shorter:full,loser=added.length?full:shorter;
      dominated.add(loser.id);decisions.push({winnerId:winner.id,loserId:loser.id,shorterId:shorter.id,fullId:full.id,added,meters:full.length-shorter.length});
    }
  }
  const ranking=(a,b)=>comparisons[b.id].familyScore-comparisons[a.id].familyScore||compareRecommendations(a,b);
  const ranked=[...members].sort(ranking),eligible=ranked.filter(r=>!dominated.has(r.id));
  const representative=(eligible.length?eligible:ranked)[0];
  const decision=decisions.find(d=>d.winnerId===representative.id);
  let reason='비슷한 동선의 후보 중 확인된 장점과 목표 거리 차이를 비교해 골랐어요. 단순 연장의 불필요한 초과는 추가로 보정해요.';
  if(members.length===1)reason='이 동선의 후보예요.';
  if(decision)reason=decision.added.length
    ?`목표까지 ${Math.round(decision.meters)}m를 더 채우는 변형에는 ${decision.added.map(k=>burdenLabels[k]).join('·')} 구간이 추가돼, 조금 짧게 마치는 코스를 골랐어요.`
    :`${Math.round(decision.meters)}m 짧은 변형에 비해 등록 횡단·계단·비포장·조명 없음 구간이 늘지 않아 목표를 채운 코스를 골랐어요. 미기록 구간의 상태는 미확인이에요.`;
  else if(members.some(r=>comparisons[r.id].subsetOverrunPenalty>0&&strictExtension(representative,r))&&comparisons[representative.id].subsetOverrunPenalty===0)reason='같은 길을 더 달려 얻는 포장·보행로 비율 증가보다, 불필요하게 목표를 넘기지 않는 쪽을 우선했어요.';
  return {ranked:[representative,...ranked.filter(r=>r!==representative)],comparisons,decisions,reason};
}
const variationLabels={distance:'같은 길의 거리 변형',direction:'같은 길의 방향·순서 변형',path:'일부 길이 다른 변형'};
export function variationFrom(representative,route) {
  const overlap=physicalOverlap(representative,route);
  const sameCoverage=overlap.shortContainment>=.999&&overlap.longCommon>=.999;
  const key=sameCoverage?'direction':strictExtension(representative,route)||strictExtension(route,representative)?'distance':'path';
  return {key,label:variationLabels[key],...overlap,distanceDelta:route.length-representative.length,representativeOnlyMeters:Math.max(0,representative.length-overlap.shared),candidateOnlyMeters:Math.max(0,route.length-overlap.shared)};
}
export function groupRouteFamilies(routes) {
  const allComparisons=compareCandidates(routes);
  const groups=clusterBySimilarity(routes,routeSimilarity,{meanThreshold:COMPARISON_POLICY.meanSimilarity,pairFloor:COMPARISON_POLICY.minimumPairSimilarity});
  return groups.map(({members,clustering},index)=>{
    const {ranked,comparisons,decisions,reason}=compareWithinFamily(members,allComparisons);
    const overlaps=Object.fromEntries(ranked.slice(1).map(r=>[r.id,variationFrom(ranked[0],r)]));
    const variantGroups=Object.entries(variationLabels).map(([key,label])=>({key,label,memberIds:ranked.slice(1).filter(r=>overlaps[r.id].key===key).map(r=>r.id)})).filter(g=>g.memberIds.length);
    return {id:`family-${index+1}`,representativeId:ranked[0].id,memberIds:ranked.map(r=>r.id),clustering,comparisons,completionDecisions:decisions,reason,overlaps,variantGroups,lengthRange:[Math.min(...members.map(r=>r.length)),Math.max(...members.map(r=>r.length))]};
  });
}
