import { groupRouteFamilies, routeComparison, COMPARISON_POLICY, smallDeficit } from './route-comparison.js';
import { assessRoute, edgeBonus, evidenceRank, numericWidth, UNPAVED } from './route-evidence.js';
// Local, deterministic prototype. All routing follows shared OSM node IDs;
// geometry proximity never creates a traversable connection.
const RAD = Math.PI / 180;
const ACCESS = new Set(['no', 'private', 'customers', 'permit', 'destination', 'use_sidepath']);
const FOOT_OK = new Set(['yes', 'designated', 'permissive', 'official']);
const WALK = new Set(['footway', 'pedestrian', 'path', 'steps']);
const LOCAL = new Set(['residential', 'living_street', 'service', 'unclassified']);
const MAJOR = new Set(['primary', 'secondary', 'tertiary']);
export const DISTANCE_TOLERANCE = 0.2;
export function distanceBounds(target) {
  return { min: target * (1 - DISTANCE_TOLERANCE), max: target * (1 + DISTANCE_TOLERANCE) };
}
export const PROFILES = {
  balanced: { label: '확인된 장점 우선', short: '장점 근거' },
  flow: { label: '등록 횡단 적게', short: '등록 횡단' },
  supply: { label: '보급 지점 가까이', short: '보급' },
  boulevard: { label: '보행로 근거 위주', short: '보행로 근거' },
};
export const EXPLORATION_STRATEGIES = ['distance', 'balanced', 'flow', 'boulevard', 'supply'];
export const SHAPES = {
  mixed: { label: '형태 다양하게', hint: '첫 코스는 우선 조건에 맞게, 다른 후보는 순환·일부 중복·왕복을 비교해요.' },
  loop: { label: '한 바퀴 우선', hint: '반복이 적은 순환형부터 골라요. 같은 형태 안에서 우선 조건을 비교해요.' },
  outback: { label: '왕복 우선', hint: '갔던 길로 돌아오는 코스부터 골라요. 같은 형태 안에서 우선 조건을 비교해요.' },
};
export function meters(a, b) {
  const dy = (b[0] - a[0]) * RAD, dx = (b[1] - a[1]) * RAD;
  const h = Math.sin(dy / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dx / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const xy = p => [p[1] * 90000, p[0] * 111320];
export function project(p, a, b) {
  const P = xy(p), A = xy(a), B = xy(b), x = B[0] - A[0], y = B[1] - A[1];
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * x + (P[1] - A[1]) * y) / (x * x + y * y || 1)));
  const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return { t, point, distance: meters(p, point) };
}
function restricted(t) {
  return ACCESS.has(t.foot) || (!FOOT_OK.has(t.foot) && ACCESS.has(t.access)) || Boolean(t['access:conditional'] || t['foot:conditional']);
}
function usable(t) {
  if (restricted(t) || t.area === 'yes' || t.highway === 'construction' || t.construction) return false;
  return WALK.has(t.highway) || LOCAL.has(t.highway) || (['cycleway', 'track'].includes(t.highway) && FOOT_OK.has(t.foot));
}
function spatialSegments(segments) {
  const buckets = new Map();
  for (const s of segments) {
    const a = xy(s.a), b = xy(s.b);
    for (let x = Math.floor(Math.min(a[0], b[0]) / 100); x <= Math.floor(Math.max(a[0], b[0]) / 100); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / 100); y <= Math.floor(Math.max(a[1], b[1]) / 100); y++) {
        const key = `${x},${y}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(s);
      }
  }
  return p => {
    const [x, y] = xy(p).map(n => Math.floor(n / 100)), found = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const s of buckets.get(`${x + i},${y + j}`) || []) found.add(s);
    return [...found];
  };
}
export function buildGraph(raw, bbox, terrain = null) {
  if (!Array.isArray(raw?.elements) || raw.remark) throw new Error('지도의 원본 데이터를 읽을 수 없어요.');
  const inside = p => !bbox || p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3];
  const tags = new Map(raw.elements.filter(e => e.type === 'node').map(e => [e.id, e.tags || {}]));
  const signals = raw.elements.filter(e => e.type === 'node' && (e.tags?.highway === 'traffic_signals' || e.tags?.['crossing:signals'] === 'yes' || e.tags?.crossing === 'traffic_signals'));
  const signalLookup = spatialSegments(signals.map(e => ({ a: [e.lat, e.lon], b: [e.lat, e.lon] })));
  const major = [];
  for (const e of raw.elements) if (e.type === 'way' && MAJOR.has(e.tags?.highway))
    for (let i = 1; i < (e.geometry?.length || 0); i++) if (e.geometry[i - 1] && e.geometry[i]) major.push({ a: [e.geometry[i - 1].lat, e.geometry[i - 1].lon], b: [e.geometry[i].lat, e.geometry[i].lon] });
  const majorLookup = spatialSegments(major);
  const graph = { nodes: [], edges: [], adj: [], pois: [], bbox, terrain, stats: {} }, indices = new Map();
  function node(id, p) {
    if (!indices.has(id)) { indices.set(id, graph.nodes.length); graph.nodes.push({ id, p }); graph.adj.push([]); }
    return indices.get(id);
  }
  for (const way of raw.elements) {
    const t = way.tags || {};
    if (way.type !== 'way' || !usable(t)) continue;
    const geo = way.geometry, ids = way.nodes;
    if (!geo || !ids) continue;
    let wayLength = 0;
    for (let i = 1; i < geo.length; i++) if (geo[i] && geo[i - 1]) wayLength += meters([geo[i - 1].lat, geo[i - 1].lon], [geo[i].lat, geo[i].lon]);
    for (let i = 1; i < ids.length; i++) {
      if (!geo[i - 1] || !geo[i]) continue;
      const p = [geo[i - 1].lat, geo[i - 1].lon], q = [geo[i].lat, geo[i].lon];
      if (!inside(p) || !inside(q)) continue;
      const nt = [tags.get(ids[i - 1]) || {}, tags.get(ids[i]) || {}];
      if (nt.some(n => restricted(n) || ['wall', 'fence'].includes(n.barrier) || n.barrier && !FOOT_OK.has(n.foot))) continue;
      const length = meters(p, q);
      if (length < 0.1) continue;
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const crossing = t.footway === 'crossing' || t.cycleway === 'crossing' || nt.some(n => n.highway === 'crossing');
      const explicitSignal = crossing && [t, ...nt].some(n => n['crossing:signals'] === 'yes' || n.crossing === 'traffic_signals');
      const explicitNo = crossing && [t, ...nt].some(n => n['crossing:signals'] === 'no' || n.crossing === 'uncontrolled');
      const nearSignal = crossing && !explicitNo && [p, mid, q].some(c => signalLookup(c).some(s => meters(c, s.a) <= 28));
      const signal = explicitSignal ? 'tagged' : nearSignal ? 'nearby' : explicitNo ? 'none' : crossing ? 'unknown' : null;
      const street = LOCAL.has(t.highway);
      const boulevard = !street && !crossing && majorLookup(mid).some(s => project(mid, s.a, s.b).distance <= 35);
      const a = node(ids[i - 1], p), b = node(ids[i], q), ei = graph.edges.length;
      const footDirection = t['oneway:foot'] === '-1' ? -1 : ['yes', '1', 'true'].includes(t['oneway:foot']) ? 1 : 0;
      graph.edges.push({ physicalId: `${way.id}:${ids[i - 1]}:${ids[i]}`, physicalA: p, physicalB: q, physicalLength: length, a, b, length, id: `${way.id}:${ids[i - 1]}:${ids[i]}`, wayId: way.id,
        name: t.name || '', highway: t.highway, street, boulevard, crossing, signal, steps: t.highway === 'steps',
        surface: t.surface || null, lit: t.lit || null, width: numericWidth(t.width),
        bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no',
        motorAllowed: ['yes','designated'].includes(t.motor_vehicle) || ['yes','designated'].includes(t.motorcar),
        crossFraction: crossing ? length / Math.max(wayLength, length) : 0, footDirection, poiIds: [] });
      if (footDirection !== -1) graph.adj[a].push({ to: b, ei, dir: 1 });
      if (footDirection !== 1) graph.adj[b].push({ to: a, ei, dir: -1 });
    }
  }
  const edgeLookup = spatialSegments(graph.edges.map((e, ei) => ({ a: graph.nodes[e.a].p, b: graph.nodes[e.b].p, ei })));
  for (const el of raw.elements) {
    const t = el.tags || {}, type = t.shop === 'convenience' ? 'shop' : (t.amenity === 'drinking_water' || t.drinking_water === 'yes') && t.drinking_water !== 'no' ? 'water' : null;
    if (!type || restricted(t)) continue;
    const p = el.type === 'node' ? [el.lat, el.lon] : el.bounds ? [(el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2] : null;
    if (!p || !inside(p)) continue;
    const poi = { id: `${el.type}/${el.id}`, p, type, name: t.name || (type === 'shop' ? '이름 미기록 편의점' : '이름 미기록 음수대'), openingHours: t.opening_hours || null };
    const pi = graph.pois.length; graph.pois.push(poi);
    for (const s of edgeLookup(p)) if (project(p, s.a, s.b).distance <= 50) graph.edges[s.ei].poiIds.push(pi);
  }
  graph.stats = { nodes: graph.nodes.length, edges: graph.edges.length, shops: graph.pois.filter(p => p.type === 'shop').length, water: graph.pois.filter(p => p.type === 'water').length };
  return graph;
}
export function snapStart(base, point) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new Error('출발점을 선택해 주세요.');
  const b = base.bbox;
  if (b && (point[0] < b[0] || point[0] > b[2] || point[1] < b[1] || point[1] > b[3])) throw new Error('저장된 지도 영역 안에서 출발점을 골라 주세요.');
  let best;
  base.edges.forEach((e, ei) => {
    if (e.steps) return;
    const hit = project(point, base.nodes[e.a].p, base.nodes[e.b].p);
    if (!best || hit.distance < best.distance) best = { ...hit, ei };
  });
  if (!best || best.distance > 100) throw new Error('선택점 100m 안에 연결할 수 있는 길이 없어요. 지도에서 길에 더 가까운 곳을 골라 주세요.');
  const edge = base.edges[best.ei];
  if (best.t < 0.001 || best.t > 0.999) {
    const start = best.t < 0.001 ? edge.a : edge.b;
    return { graph: base, start, point: base.nodes[start].p, offset: meters(point, base.nodes[start].p) };
  }
  const graph = { ...base, nodes: [...base.nodes, { id: 'start', p: best.point }], edges: [...base.edges], adj: [...base.adj, []] };
  const start = graph.nodes.length - 1;
  // Replace, rather than duplicate, the selected edge for this request only.
  graph.adj[edge.a] = graph.adj[edge.a].filter(a => a.ei !== best.ei);
  graph.adj[edge.b] = graph.adj[edge.b].filter(a => a.ei !== best.ei);
  for (const [a, b, fraction] of [[edge.a, start, best.t], [start, edge.b, 1 - best.t]]) {
    const ei = graph.edges.length;
    graph.edges.push({ ...edge, a, b, length: edge.length * fraction, crossFraction: edge.crossFraction * fraction, id: `${edge.id}:${a}` });
    if (edge.footDirection !== -1) graph.adj[a].push({ to: b, ei, dir: 1 });
    if (edge.footDirection !== 1) graph.adj[b].push({ to: a, ei, dir: -1 });
  }
  return { graph, start, point: best.point, offset: best.distance };
}
class Heap {
  data = [];
  push(value) {
    const a = this.data; a.push(value); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p][0] <= value[0]) break; a[i] = a[p]; i = p; } a[i] = value;
  }
  pop() {
    const a = this.data, top = a[0], last = a.pop();
    if (a.length) { let i = 0; while (2 * i + 1 < a.length) { let c = 2 * i + 1; if (c + 1 < a.length && a[c + 1][0] < a[c][0]) c++; if (a[c][0] >= last[0]) break; a[i] = a[c]; i = c; } a[i] = last; } return top;
  }
}
function edgeCost(e, profile, avoidSteps) {
  if (avoidSteps && e.steps) return Infinity;
  // Missing surface/light/width/signal tags are neutral. Road adjacency is not a benefit.
  let cost = e.length / (1 + edgeBonus(e, profile));
  if (profile === 'flow' && e.crossing) cost += e.crossFraction * 300;
  return cost;
}
export function shortestTree(graph, start, { profile = 'balanced', avoidSteps = true, target = -1, maxLength = Infinity, penalized = null, penalty = 1, edgeFilter = null } = {}) {
  const n = graph.nodes.length, costs = new Float64Array(n).fill(Infinity), lengths = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1), prevEdge = new Int32Array(n).fill(-1), heap = new Heap();
  costs[start] = lengths[start] = 0; heap.push([0, start]);
  while (heap.data.length) {
    const [cost, u] = heap.pop(); if (cost !== costs[u]) continue; if (u === target) break;
    for (const a of graph.adj[u]) {
      const e = graph.edges[a.ei]; if(edgeFilter&&!edgeFilter(e,a.ei))continue;
      const len = lengths[u] + e.length;
      if (len > maxLength) continue;
      const c = cost + edgeCost(e, profile, avoidSteps) * (penalized?.has(e.id) ? penalty : 1);
      if (c < costs[a.to]) { costs[a.to] = c; lengths[a.to] = len; prev[a.to] = u; prevEdge[a.to] = a.ei; heap.push([c, a.to]); }
    }
  }
  return { costs, lengths, prev, prevEdge, start };
}
export function pathTo(graph, tree, target) {
  if (!Number.isFinite(tree.costs[target])) return null;
  const route = []; let u = target;
  while (u !== tree.start) {
    const from = tree.prev[u], ei = tree.prevEdge[u]; if (from < 0) return null;
    const edge = graph.edges[ei]; route.push({ ei, from, to: u, length: edge.length, a: graph.nodes[from].p, b: graph.nodes[u].p }); u = from;
  }
  return route.reverse();
}
function exactOutback(graph, path, half) {
  const outbound = []; let left = half;
  for (const arc of path) {
    if (left <= 0.001) break;
    if (graph.edges[arc.ei].footDirection) return null;
    const length = Math.min(left, arc.length), f = length / arc.length;
    outbound.push({ ...arc, length, b: [arc.a[0] + f * (arc.b[0] - arc.a[0]), arc.a[1] + f * (arc.b[1] - arc.a[1])] }); left -= length;
  }
  if (left > 0.1) return null;
  return [...outbound, ...outbound.slice().reverse().map(a => ({ ...a, from: a.to, to: a.from, a: a.b, b: a.a }))];
}
// A single bounded excursion on unused, connected edges can complete a short
// route. Unknown tags remain eligible; no geometric connection is invented.
export function completeShortRoute(graph,arcs,route,targetLength) {
  if(!smallDeficit(route,targetLength))return {proposals:[],anchors:0};
  const missing=targetLength-route.length,half=missing/2;
  const used=new Set(arcs.map(a=>graph.edges[a.ei].physicalId||graph.edges[a.ei].id));
  const allowed=e=>!e.footDirection&&!e.crossing&&!e.steps&&e.lit!=='no'&&!UNPAVED.has(e.surface)&&!used.has(e.physicalId||e.id);
  const anchors=[],seen=new Set();let at=0;
  // A partial turnaround's arc.to is not necessarily an actually reached node.
  for(let index=0;index<=arcs.length;index++) {
    const node=index?arcs[index-1].to:arcs[0].from,point=index?arcs[index-1].b:arcs[0].a;
    if(node>=0&&!seen.has(node)&&meters(point,graph.nodes[node].p)<.05&&graph.adj[node].some(a=>allowed(graph.edges[a.ei]))) {
      anchors.push({node,index,at});seen.add(node);
    }
    if(index<arcs.length)at+=arcs[index].length;
  }
  const sample=anchors.length<=12?anchors:Array.from({length:12},(_,i)=>anchors[Math.round(i*(anchors.length-1)/11)]);
  const possibilities=[];
  for(const anchor of sample) {
    const tree=shortestTree(graph,anchor.node,{profile:'balanced',avoidSteps:true,maxLength:half,edgeFilter:allowed});
    for(let u=0;u<graph.nodes.length;u++) {
      if(!Number.isFinite(tree.lengths[u])||tree.lengths[u]>half+.01)continue;
      const path=pathTo(graph,tree,u);if(!path)continue;
      const pathIds=new Set(path.map(a=>graph.edges[a.ei].physicalId||graph.edges[a.ei].id));
      for(const a of graph.adj[u]) {
        const e=graph.edges[a.ei];
        if(!allowed(e)||pathIds.has(e.physicalId||e.id)||tree.lengths[u]+e.length<half-.01)continue;
        const frontier={ei:a.ei,from:u,to:a.to,length:e.length,a:graph.nodes[u].p,b:graph.nodes[a.to].p};
        const excursion=exactOutback(graph,[...path,frontier],half);if(!excursion)continue;
        const quality=excursion.reduce((n,arc)=>n+arc.length*edgeBonus(graph.edges[arc.ei]),0);
        possibilities.push({anchor,excursion,quality});
      }
    }
  }
  possibilities.sort((a,b)=>b.quality-a.quality||a.anchor.at-b.anchor.at);
  const proposals=[],seenPaths=new Set();
  for(const p of possibilities) {
    const extended=[...arcs.slice(0,p.anchor.index),...p.excursion,...arcs.slice(p.anchor.index)];
    let crossingCount=0,previousCrossing=false;
    for(const arc of extended){const crossing=graph.edges[arc.ei].crossing;if(crossing&&!previousCrossing)crossingCount++;previousCrossing=crossing;}
    if(crossingCount>route.crossings.length)continue;
    const sig=extended.map(a=>`${a.ei}:${a.b.join(',')}`).join(';');if(seenPaths.has(sig))continue;seenPaths.add(sig);
    const unknownSurface=p.excursion.reduce((n,a)=>n+(!graph.edges[a.ei].surface?a.length:0),0);
    const unknownLighting=p.excursion.reduce((n,a)=>n+(!['yes','no'].includes(graph.edges[a.ei].lit)?a.length:0),0);
    proposals.push({arcs:extended,completion:{parentSignature:routeSignature(route),addedMeters:missing,atMeters:p.anchor.at,point:graph.nodes[p.anchor.node].p,method:'one-unused-path-outback',addedRecordedBurden:{crossing:0,steps:0,unpaved:0,unlit:0},unknownSurfaceMeters:unknownSurface,unknownLightingMeters:unknownLighting}});
    if(proposals.length===2)break;
  }
  return {proposals,anchors:sample.length};
}
function mergeCompletions(a=[],b=[]) {
  const all=new Map([...a,...b].map(c=>[`${c.parentSignature}:${c.atMeters}:${c.method}`,c]));return [...all.values()];
}
export function evaluateRoute(graph, arcs, targetLength) {
  let length = 0, street = 0, boulevard = 0, steps = 0;
  const uses = new Map(), poiHits = new Map(), crossings = [];
  let group = null;
  for (const arc of arcs) {
    const e = graph.edges[arc.ei];
    if (e.street) street += arc.length; if (e.boulevard) boulevard += arc.length; if (e.steps) steps += arc.length;
    // A partial terminal edge contributes only its traversed physical length.
    const use = uses.get(e.id) || { total: 0, unique: 0 };
    use.total += arc.length; use.unique = Math.max(use.unique, arc.length); uses.set(e.id, use);
    for (const pi of e.poiIds) {
      const hit = project(graph.pois[pi].p, arc.a, arc.b);
      if (hit.distance > 50) continue;
      const dist = length + hit.t * arc.length, old = poiHits.get(pi);
      if (!old) poiHits.set(pi, { ...graph.pois[pi], at: [dist], offset: hit.distance });
      else { if (dist - old.at.at(-1) > 100) old.at.push(dist); old.offset = Math.min(old.offset, hit.distance); }
    }
    if (e.crossing) {
      if (!group) { group = { at: length, p: arc.a, signals: new Set() }; crossings.push(group); }
      group.signals.add(e.signal);
    } else group = null;
    length += arc.length;
  }
  const signals = crossings.filter(c => c.signals.has('tagged') || c.signals.has('nearby')).length;
  const inferredSignals = crossings.filter(c => !c.signals.has('tagged') && c.signals.has('nearby')).length;
  const unknownCrossings = crossings.filter(c => !c.signals.has('tagged') && !c.signals.has('nearby') && c.signals.has('unknown')).length;
  const facilities = [...poiHits.values()], positions = [0, ...facilities.flatMap(p => p.at), length].sort((a, b) => a - b);
  const maxGap = positions.slice(1).reduce((m, p, i) => Math.max(m, p - positions[i]), 0);
  const repeated = [...uses.values()].reduce((s, v) => s + v.total - v.unique, 0);
  const points = [arcs[0]?.a, ...arcs.map(a => a.b)].filter(Boolean);
  const result = { length, error: Math.abs(length - targetLength) / targetLength, points, signals, inferredSignals, unknownCrossings,
    segments: arcs.map(a => { const e = graph.edges[a.ei]; return { physicalId: e.physicalId || e.id, from: project(a.a, e.physicalA || graph.nodes[e.a].p, e.physicalB || graph.nodes[e.b].p).t * (e.physicalLength || e.length), to: project(a.b, e.physicalA || graph.nodes[e.a].p, e.physicalB || graph.nodes[e.b].p).t * (e.physicalLength || e.length), name: e.name, highway: e.highway, crossing: e.crossing, length: a.length, steps: e.steps, surface: e.surface, lit: e.lit, width: e.width, bridge: e.bridge, tunnel: e.tunnel, motorAllowed: e.motorAllowed }; }),
    crossings: crossings.map(c => ({ at: c.at, p: c.p, signal: c.signals.has('tagged') || c.signals.has('nearby'), unknown: c.signals.has('unknown') && !c.signals.has('tagged') && !c.signals.has('nearby') })),
    streetRatio: street / length, boulevardRatio: boulevard / length, steps, repeatRatio: repeated / length,
    facilities, shops: facilities.filter(p => p.type === 'shop').length, water: facilities.filter(p => p.type === 'water').length,
    // Compare traversed distance, so a loop and an outback sharing the outbound
    // half are not incorrectly treated as the same entire course.
    maxGap, usage: Object.fromEntries([...uses.entries()].map(([id, v]) => [id, v.total])) };
  result.evidence = assessRoute(result, graph.terrain);
  return result;
}
export function overlap(a, b) {
  let shared = 0;
  for (const [id, len] of Object.entries(a.usage)) shared += Math.min(len, b.usage[id] || 0);
  return shared / Math.min(Object.values(a.usage).reduce((s, x) => s + x, 0), Object.values(b.usage).reduce((s, x) => s + x, 0));
}
function compare(a, b, profile) {
  const A = evidenceRank(a, profile), B = evidenceRank(b, profile);
  for (let i = 0; i < A.length; i++) if (Math.abs(A[i] - B[i]) > 1e-8) return A[i] - B[i];
  // Prefer the target distance only when the route-condition scores are tied.
  return a.error - b.error || a.length - b.length;
}
export function routeShape(r) {
  const p = r.points;
  const exactReturn = p.length >= 3 && p.length % 2 === 1 && p.every((point, i) => meters(point, p[p.length - 1 - i]) < 0.5);
  return exactReturn ? 'outback' : r.repeatRatio <= 0.08 ? 'loop' : 'partial';
}
export function selectCandidates(candidates, { profile = 'balanced', shape = 'mixed', limit = 3 } = {}) {
  const ranked = candidates.slice().sort((a, b) => compare(a, b, profile));
  const family = new Map(ranked.map(r => [r, routeShape(r)]));
  const selected = [];
  const add = r => {
    if (!r || selected.length >= limit || selected.includes(r) || selected.some(s => overlap(r, s) >= 0.78)) return false;
    selected.push(r); return true;
  };
  if (shape === 'mixed') {
    add(ranked[0]);
    // Keep the profile winner, then represent genuinely different route forms.
    for (const kind of ['loop', 'partial', 'outback']) {
      if (selected.some(r => family.get(r) === kind)) continue;
      ranked.filter(r => family.get(r) === kind).some(add);
    }
    ranked.forEach(add);
  } else {
    const order = shape === 'loop' ? ['loop', 'partial', 'outback'] : ['outback', 'partial', 'loop'];
    for (const kind of order) {
      let group = ranked.filter(r => family.get(r) === kind);
      // When a pure loop was not found, make the lower-repeat fallback explicit.
      if (shape === 'loop' && kind === 'partial') group = group.slice().sort((a, b) => a.repeatRatio - b.repeatRatio || compare(a, b, profile));
      group.forEach(add);
    }
  }
  return selected;
}
export function generateRoutes(base, options) {
  const { point, distance = 5000, profile = 'balanced', avoidSteps = true, variant = 0 } = options;
  const shape = Object.hasOwn(SHAPES, options.shape) ? options.shape : 'mixed';
  if (!Number.isFinite(distance) || distance < 1000 || distance > 12000) throw new Error('목표 거리는 1~12km로 선택해 주세요.');
  const bounds = distanceBounds(distance);
  const snapped = snapStart(base, point), { graph, start } = snapped;
  const tree = shortestTree(graph, start, { profile, avoidSteps, maxLength: bounds.max * 0.7 });
  const sectors = 16, buckets = Array.from({ length: sectors }, () => []), rotation = (variant % 4) * Math.PI / 32;
  graph.nodes.forEach((n, i) => {
    const l = tree.lengths[i]; if (!Number.isFinite(l) || l < distance * 0.17) return;
    const a = Math.atan2((n.p[1] - snapped.point[1]) * Math.cos(snapped.point[0] * RAD), n.p[0] - snapped.point[0]) + Math.PI * 2 + rotation;
    buckets[Math.floor(a / (2 * Math.PI) * sectors) % sectors].push(i);
  });
  const targets = new Set();
  for (const bucket of buckets) for (const ratio of [0.24, 0.34, 0.43, 0.53, 0.66]) {
    const best = bucket.reduce((a, n) => a === null || Math.abs(tree.lengths[n] - distance * ratio) < Math.abs(tree.lengths[a] - distance * ratio) ? n : a, null);
    if (best !== null) targets.add(best);
  }
  const candidates = [], signatures = new Map(), candidateArcs=new Map(); let attempted = 0, eligible = 0;
  const add = (arcs,completion=null) => {
    if (!arcs?.length) return;
    const r = evaluateRoute(graph, arcs, distance);
    if (r.error > DISTANCE_TOLERANCE + 1e-8 || meters(r.points[0], r.points.at(-1)) > 0.1) return;
    eligible++;
    const signature = options.collect ? routeSignature(r) : Object.keys(r.usage).sort().join('|');
    if (signatures.has(signature)) {if(completion){const existing=signatures.get(signature);existing.completions=mergeCompletions(existing.completions,[completion]);}return;}
    if(completion)r.completions=[completion];
    signatures.set(signature,r);candidates.push(r);candidateArcs.set(r,arcs);
  };
  for (const dest of targets) {
    const outward = pathTo(graph, tree, dest); if (!outward) continue;
    for (const total of options.collect ? [bounds.min, distance, bounds.max] : [distance]) {
      if (tree.lengths[dest] >= total / 2) add(exactOutback(graph, outward, total / 2));
    }
    const penalized = new Set(outward.map(a => graph.edges[a.ei].id));
    for (const penalty of [2.5, 8]) {
      attempted++;
      const backTree = shortestTree(graph, dest, { profile, avoidSteps, target: start, maxLength: bounds.max - tree.lengths[dest], penalized, penalty });
      const back = pathTo(graph, backTree, start); if (back) add([...outward, ...back]);
    }
  }
  if(options.collect&&options.completeShort!==false) {
    for(const original of [...candidates]) {
      if(!smallDeficit(original,distance))continue;
      const completion=completeShortRoute(graph,candidateArcs.get(original),original,distance);
      original.completionSearch={state:completion.proposals.length?'found':'not-found',missingMeters:distance-original.length,anchors:completion.anchors,method:'bounded-single-excursion'};
      for(const proposal of completion.proposals)add(proposal.arcs,proposal.completion);
    }
  }
  const candidateShapes = { loop: 0, partial: 0, outback: 0 };
  candidates.forEach(r => { candidateShapes[routeShape(r)]++; });
  if (options.collect) return { candidates, eligible, attempted, candidateShapes, snap: { point: snapped.point, offset: snapped.offset }, bounds };
  const selected = selectCandidates(candidates, { profile, shape });
  const selectedLoops = selected.filter(r => routeShape(r) === 'loop').length;
  const selectedOutbacks = selected.filter(r => routeShape(r) === 'outback').length;
  const shapeNote = shape === 'mixed' ? '첫 코스는 우선 조건에 맞춰 골랐어요. 나머지는 다른 형태와 비교할 수 있도록 담았어요.'
    : shape === 'loop' ? selectedLoops ? `순환형 ${selectedLoops}개를 먼저 골랐어요.${selectedLoops < selected.length ? ' 나머지는 동선이 다른 대안이에요.' : ''}` : '이 조건의 탐색에서는 순환형을 찾지 못해, 반복이 적은 다른 형태를 보여드려요.'
      : selectedOutbacks ? `왕복형 ${selectedOutbacks}개를 먼저 골랐어요.${selectedOutbacks < selected.length ? ' 나머지는 동선이 다른 대안이에요.' : ''}` : '이 조건의 탐색에서는 왕복형을 찾지 못해, 다른 형태를 보여드려요.';
  selected.forEach((r, i) => { r.id = `route-${i + 1}`; r.kind = { loop: '순환형', partial: '일부 중복형', outback: '왕복형' }[routeShape(r)]; delete r.usage; });
  return { routes: selected, snap: { point: snapped.point, offset: snapped.offset }, candidateCount: candidates.length,
    attempted, graphStats: base.stats, profile, shape, candidateShapes, shapeNote, distance, bounds, variant, tolerance: DISTANCE_TOLERANCE,
    message: selected.length ? selected.length < 3 ? `충분히 다른 코스 ${selected.length}개를 찾았어요. 비슷한 동선은 합쳤습니다.` : '서로 다른 동선 3개를 골랐어요.' : `거리 ±${DISTANCE_TOLERANCE * 100}% 안에서 돌아오는 코스를 찾지 못했어요. 거리를 줄이거나 다른 출발점을 골라 주세요.` };
}

// Ordered geometry keeps reverse loops and different partial-edge turnarounds.
// Only identical coordinates at ~centimetre precision are merged, never 78% overlap.
export function routeSignature(route) {
  return route.points.map(p => p.map(n => n.toFixed(7)).join(',')).join(';');
}
export function mergeExploration(batches, options) {
  const unique = new Map(); let eligible = 0, attempted = 0;
  for (const batch of batches) {
    eligible += batch.eligible; attempted += batch.attempted;
    for (const route of batch.candidates) {
      const signature = routeSignature(route), source = { strategy: batch.strategy, variant: batch.variant };
      if (unique.has(signature)) {
        const existing=unique.get(signature);existing.searches.push(source);
        if(route.completions?.length)existing.completions=mergeCompletions(existing.completions,route.completions);
      }
      else {
        const { usage, ...copy } = route;
        unique.set(signature, { ...copy, id: `candidate-${String(unique.size + 1).padStart(4, '0')}`, kind: { loop: '순환형', partial: '일부 중복형', outback: '왕복형' }[routeShape(route)], searches: [source] });
      }
    }
  }
  const routes = [...unique.values()], candidateShapes = { loop: 0, partial: 0, outback: 0 };
  routes.forEach(r => { candidateShapes[routeShape(r)]++; r.comparison = routeComparison(r, options.distance); });
  const families = groupRouteFamilies(routes);
  const comparisons=Object.assign({},...families.map(f=>f.comparisons));
  routes.forEach(r=>{r.comparison=comparisons[r.id];});
  return { mode: 'explore', routes, families, comparisonPolicy: COMPARISON_POLICY, candidateCount: routes.length, eligible, duplicateCount: eligible - routes.length, attempted,
    candidateShapes, batches: batches.map(b => ({ strategy: b.strategy, variant: b.variant, eligible: b.eligible, unique: b.candidates.length, attempted: b.attempted })),
    snap: batches[0]?.snap, distance: options.distance, bounds: distanceBounds(options.distance), tolerance: DISTANCE_TOLERANCE,
    avoidSteps: options.avoidSteps, point: options.point, algorithmVersion: 'candidate-exploration-6-average-linkage',
    message: routes.length ? '더 닮은 후보부터 모아 큰 동선으로 묶었어요. 펼치면 거리·방향·다른 길 변형을 모두 볼 수 있어요. 거리 감점은 묶음을 나누지 않고 대표를 고르는 데만 써요.' : '이번 탐색에서 거리 범위에 맞는 코스를 찾지 못했어요. 가능한 모든 코스를 탐색한 결과는 아니에요.' };
}
