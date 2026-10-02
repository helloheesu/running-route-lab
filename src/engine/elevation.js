// Terrain estimates never represent bridge decks or tunnel floors.
const rad = Math.PI / 180;
function distance(a,b) {
  const h=Math.sin((b[0]-a[0])*rad/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin((b[1]-a[1])*rad/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function sampleTerrain(data, point) {
  if (!data?.values || !point?.every(Number.isFinite)) return null;
  const [lat,lon]=point, n=256*2**data.zoom;
  // Pixel centers, not tile corners. Adjacent pixels are bilinearly interpolated.
  const x=(lon+180)/360*n-.5-data.x0;
  const y=(1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*n-.5-data.y0;
  const ix=Math.floor(x), iy=Math.floor(y);
  if(ix<0||iy<0||ix+1>=data.width||iy+1>=data.height) return null;
  const v=[data.values[iy*data.width+ix],data.values[iy*data.width+ix+1],data.values[(iy+1)*data.width+ix],data.values[(iy+1)*data.width+ix+1]];
  if(!v.every(Number.isFinite)) return null;
  const dx=x-ix,dy=y-iy;
  return ((v[0]*(1-dx)+v[1]*dx)*(1-dy)+(v[2]*(1-dx)+v[3]*dx)*dy)*data.scale;
}
export function elevationProfile(route, terrain) {
  const unknown={state:'unknown',coverage:0,ascent:null,descent:null,range:null,profile:[],hills:[],reason:'고도 자료를 불러오지 못했거나 자료 범위 밖이에요.'};
  if(!terrain?.values || route.points.length<2) return unknown;
  const spans=[];let total=0;
  for(let i=1;i<route.points.length;i++) {
    const length=distance(route.points[i-1],route.points[i]),s=route.segments?.[i-1]||{};
    spans.push({start:total,end:total+length,a:route.points[i-1],b:route.points[i],excluded:!!(s.bridge||s.tunnel)});total+=length;
  }
  if(!total) return unknown;
  const positions=[];for(let at=0;at<total-1;at+=50)positions.push(at);
  if(positions.length>1&&total-positions.at(-1)<25)positions.pop();
  positions.push(total);
  let j=0;
  const raw=positions.map(at=>{
    while(j<spans.length-1&&spans[j].end<at)j++;
    const s=spans[j],t=(at-s.start)/(s.end-s.start||1),p=s.a.map((v,i)=>v+t*(s.b[i]-v));
    return {at,elevation:s.excluded?null:sampleTerrain(terrain,p)};
  });
  // Mark both ends of a sample interval if any excluded segment crosses it.
  for(let i=1;i<raw.length;i++)if(spans.some(s=>s.excluded&&s.end>raw[i-1].at&&s.start<raw[i].at)) {raw[i-1].gap=true;raw[i].gap=true;}
  const profile=raw.map((p,i)=>{
    if(p.gap||p.elevation===null)return {at:p.at,elevation:null};
    const near=raw.slice(Math.max(0,i-1),i+2);
    const elevation=i>0&&i<raw.length-1&&near.every(v=>v.elevation!==null&&!v.gap)?near.reduce((s,v)=>s+v.elevation,0)/near.length:p.elevation;
    return {at:p.at,elevation:Math.round(elevation*10)/10};
  });
  let covered=0,up=0,down=0,anchor=null,maxGrade=0,gentle=0,hill=null;const hills=[];
  for(let i=0;i<profile.length;i++) {
    const p=profile[i],prev=profile[i-1];
    if(p.elevation===null) {anchor=null;hill=null;continue;}
    if(anchor===null)anchor=p.elevation;
    const delta=p.elevation-anchor;
    if(Math.abs(delta)>=3){if(delta>0)up+=delta;else down-=delta;anchor=p.elevation;}
    if(!prev||prev.elevation===null)continue;
    const length=p.at-prev.at,grade=100*(p.elevation-prev.elevation)/length;
    covered+=length;maxGrade=Math.max(maxGrade,Math.abs(grade));if(Math.abs(grade)<=4)gentle+=length;
    if(grade>=3) {
      if(!hill){hill={start:prev.at,end:p.at,rise:p.elevation-prev.elevation};hills.push(hill);}
      else {hill.end=p.at;hill.rise+=p.elevation-prev.elevation;}
    }else hill=null;
  }
  const valid=profile.filter(p=>p.elevation!==null).map(p=>p.elevation);
  if(!valid.length)return {...unknown,profile,reason:spans.some(s=>s.excluded)?'교량·지하 통로의 실제 달리는 높이를 알 수 없어 지형 고도 계산을 보류했어요.':unknown.reason};
  const complete=profile.every(p=>p.elevation!==null);
  return {state:complete?'estimated':'partial',coverage:Math.min(1,covered/total),
    ascent:complete?Math.round(up):null,descent:complete?Math.round(down):null,
    partialAscent:Math.round(up),partialDescent:Math.round(down),
    range:Math.round(Math.max(...valid)-Math.min(...valid)),min:Math.round(Math.min(...valid)),max:Math.round(Math.max(...valid)),
    maxGrade:Math.round(maxGrade*10)/10,gentleRatio:covered?gentle/covered:null,
    hills:hills.filter(h=>h.end-h.start>=100).map(h=>({...h,grade:100*h.rise/(h.end-h.start)})).sort((a,b)=>b.rise-a.rise).slice(0,3),profile,
    source:terrain.source,sourceUrl:terrain.sourceUrl,fetchedAt:terrain.fetchedAt,pixelMeters:terrain.nominalPixelMeters,
    reason:complete?'지형 높이의 추정값이에요. 짧은 경사와 실제 노면 높이는 다를 수 있어요.':'교량·지하 통로 또는 고도 누락 구간을 제외했어요. 전체 누적 상승량은 미확인이에요.',
    method:'약 50m 간격 · 인접 3점 평균 · 3m 미만 변화 누적 제외'};
}
