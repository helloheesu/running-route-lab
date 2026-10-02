import { elevationProfile } from './elevation.js';
const PAVED=new Set(['asphalt','concrete','concrete:plates','concrete:lanes','paved','paving_stones']);
export const UNPAVED=new Set(['unpaved','gravel','fine_gravel','ground','dirt','earth','sand','mud','grass','woodchips']);
export function numericWidth(value) {
  const match=typeof value==='string'&&value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:m)?$/);
  return match&&Number(match[1])>0?Number(match[1]):null;
}
export function walkingEvidence(s) {
  return ['footway','pedestrian'].includes(s.highway)&&!s.crossing&&!s.steps&&!s.motorAllowed;
}
export function edgeBonus(s, profile='balanced') {
  if(profile==='distance')return 0;
  const walk=walkingEvidence(s);
  let bonus=walk?.2:0;
  if(walk&&PAVED.has(s.surface))bonus+=.3;
  if(walk&&s.lit==='yes')bonus+=.15;
  if(walk&&s.width!==null&&s.width>=3)bonus+=.15;
  if(profile==='boulevard')bonus*=1.6; // A retained control now uses direct evidence, never road proximity.
  if(profile==='supply'&&s.poiIds?.length)bonus+=.3;
  return bonus;
}
const pct=v=>`${Math.round(v*100)}%`, km=v=>`${(v/1000).toFixed(1)}km`;
export function assessRoute(route, terrain) {
  const length=route.length||1;
  const m={walk:0,paved:0,unpaved:0,surfaceKnown:0,litYes:0,litNo:0,litKnown:0,widthKnown:0,wide:0,pavedWalk:0,litWalk:0,wideWalk:0,longestWalk:0};
  let run=0,at=0;const conditions=[],runIntervals=new Map();
  for(const s of route.segments||[]) {
    const n=s.length,walk=walkingEvidence(s);
    if(walk){
      m.walk+=n;
      const lo=Math.min(s.from,s.to),hi=Math.max(s.from,s.to);
      const prior=runIntervals.get(s.physicalId)||[];
      // A turnaround cannot make the same physical walkway look newly longer.
      if(s.physicalId&&prior.some(([a,b])=>Math.min(b,hi)-Math.max(a,lo)>.05)){run=0;runIntervals.clear();}
      if(s.physicalId)runIntervals.set(s.physicalId,[...(runIntervals.get(s.physicalId)||[]),[lo,hi]]);
      run+=n;m.longestWalk=Math.max(m.longestWalk,run);
    }else {run=0;runIntervals.clear();}
    if(s.surface)m.surfaceKnown+=n;
    if(PAVED.has(s.surface)){m.paved+=n;if(walk)m.pavedWalk+=n;}
    if(UNPAVED.has(s.surface))m.unpaved+=n;
    if(s.lit==='yes'){m.litYes+=n;if(walk)m.litWalk+=n;}
    if(s.lit==='no')m.litNo+=n;
    if(['yes','no'].includes(s.lit))m.litKnown+=n;
    if(Number.isFinite(s.width)){m.widthKnown+=n;if(s.width>=3){m.wide+=n;if(walk)m.wideWalk+=n;}}
    const types=[s.steps?'steps':null,UNPAVED.has(s.surface)?'unpaved':null,s.lit==='no'?'unlit':null].filter(Boolean);
    for(const type of types){const previous=conditions.findLast(c=>c.type===type);if(previous&&Math.abs(previous.end-at)<.1)previous.end+=n;else conditions.push({type,start:at,end:at+n,name:s.name||''});}
    at+=n;
  }
  const elevation=elevationProfile(route,terrain);
  // Positive evidence additions, never a total quality score or a missing-data penalty.
  const benefits=[];
  const add=(key,value,weight,text,basis='OSM 등록')=>{if(value>0)benefits.push({key,bonus:value*weight,text,basis});};
  add('walk',m.walk/length,20,`보행로로 등록된 구간 ${pct(m.walk/length)}`);
  add('paved',m.pavedWalk/length,30,`포장 노면이 기록된 보행로 ${pct(m.pavedWalk/length)}`);
  add('lighting',m.litWalk/length,15,`조명 있음으로 기록된 보행로 ${pct(m.litWalk/length)}`);
  add('width',m.wideWalk/length,15,`폭 3m 이상으로 기록된 보행로 ${pct(m.wideWalk/length)}`);
  if(m.longestWalk>=500)add('continuous',Math.min(1,m.longestWalk/2000),10,`같은 길 재사용 전 보행로 ${km(m.longestWalk)} 이어짐`);
  // Estimated relief is displayed but not called a confirmed benefit or included in this score.
  benefits.sort((a,b)=>b.bonus-a.bonus);
  const unknowns=['개방감·시야 정보 부족','경치 다양성·개인의 새로움 정보 부족','실시간 혼잡·공사·신호 대기시간 미확인'];
  if(m.surfaceKnown<length-.1)unknowns.push(`노면 정보 없는 구간 ${pct(1-m.surfaceKnown/length)}`);
  if(m.litKnown<length-.1)unknowns.push(`조명 정보 없는 구간 ${pct(1-m.litKnown/length)}`);
  if(m.widthKnown<length-.1)unknowns.push(`폭 정보 없는 구간 ${pct(1-m.widthKnown/length)}`);
  if(elevation.state!=='estimated')unknowns.push(elevation.state==='partial'?'전체 누적 상승량 미확인':'고저차 정보 부족');
  const description=benefits.length?`${benefits.filter(b=>b.key!=='walk'||!benefits.some(v=>v.key==='paved')).slice(0,2).map(b=>b.text).join(' · ')}. 이 기록을 추천 근거로 삼았어요.`:'추천을 뒷받침할 길 환경 기록이 부족해요. 나쁜 코스라는 뜻은 아니에요.';
  return {version:'positive-evidence-2-physical-continuity',bonus:benefits.reduce((n,b)=>n+b.bonus,0),benefits,description,unknowns,conditions,
    surface:{known:m.surfaceKnown/length,paved:m.paved/length,unpaved:m.unpaved/length},
    lighting:{known:m.litKnown/length,yes:m.litYes/length,no:m.litNo/length},
    width:{known:m.widthKnown/length,atLeast3m:m.wide/length},pavedWalkRatio:m.pavedWalk/length,litWalkRatio:m.litWalk/length,wideWalkRatio:m.wideWalk/length,walkRatio:m.walk/length,longestWalk:m.longestWalk,elevation,
    openness:{state:'unknown',reason:'대로 인접성·폭·조명만으로 시야나 개방감을 판단하지 않아요.'},
    scenery:{state:'unknown',reason:'길 중복률은 동선 정보예요. 경치의 반복·다양성이나 전에 달렸는지는 알 수 없어요.'}};
}
export function evidenceRank(route, profile='balanced') {
  const bonus=route.evidence?.bonus||0;
  if(profile==='flow')return [route.crossings.length,-bonus];
  if(profile==='supply')return [-Math.min(4,(route.shops||0)+(route.water||0)),-bonus];
  return [-bonus];
}
