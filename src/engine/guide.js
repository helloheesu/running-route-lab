import { meters, project } from './routing.js';

export const formatDistance = m => m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
export function bearing(a, b) {
  return (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 360;
}
const direction = angle => ['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽'][Math.round(angle / 45) % 8];
export function positionAt(points, distances, at) {
  let i = 1;
  while (i < distances.length - 1 && distances[i] < at) i++;
  const f = Math.max(0, Math.min(1, (at - distances[i - 1]) / (distances[i] - distances[i - 1] || 1)));
  return points[i - 1].map((n, j) => n + (points[i][j] - n) * f);
}
// Context labels describe proximity, never an invented address or road connection.
export function namedRoads(raw) {
  return (raw?.elements || []).filter(e => e.type === 'way' && e.tags?.highway && e.tags.name && e.geometry?.length > 1)
    .map(e => ({ name: e.tags.name, points: e.geometry.filter(Boolean).map(p => [p.lat, p.lon]) }));
}
export function nearbyRoad(point, roads) {
  let best;
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const d = project(point, road.points[i - 1], road.points[i]).distance;
    if (d <= 250 && (!best || d < best.distance)) best = { name: road.name, distance: d };
  }
  return best ? `${best.name}에서 약 ${Math.round(best.distance / 10) * 10}m 부근` : `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`;
}
export function kakaoPointUrl(point, name = '러닝 코스 출발점') {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}
export function buildGuide(route, roads = []) {
  if (!route?.points || route.points.length < 2) return null;
  const points = route.points, segments = route.segments || [], distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances.at(-1) + meters(points[i - 1], points[i]));
  const total = distances.at(-1), halfIndex = (points.length - 1) / 2;
  // A high overlap score alone does not prove that the way back retraces the way out.
  const outback = Number.isInteger(halfIndex) && points.every((p, i) => meters(p, points[points.length - 1 - i]) < 0.5);
  const end = outback ? halfIndex : points.length - 1, endDistance = distances[end];
  const roadLabel = i => segments[i]?.name || (segments[i]?.crossing ? '횡단 구간' : ['residential', 'service', 'unclassified', 'living_street'].includes(segments[i]?.highway) ? '이름 미등록 동네길' : '이름 미등록 보행로');
  const heading = bearing(points[0], positionAt(points, distances, Math.min(25, endDistance)));
  const steps = [{ point: points[0], at: 0, kind: 'start', heading, title: `${direction(heading)}으로 출발`, detail: `${roadLabel(0)}를 따라 시작해요.`, context: nearbyRoad(points[0], roads) }];
  let lastAt = 0;
  for (let i = 1; i < end; i++) {
    const at = distances[i];
    if (at < 12 || endDistance - at < 12) continue;
    const before = positionAt(points, distances, Math.max(0, at - 12)), after = positionAt(points, distances, Math.min(endDistance, at + 12));
    const incoming = bearing(before, points[i]), outgoing = bearing(points[i], after);
    const angle = ((outgoing - incoming + 540) % 360) - 180;
    const crossing = segments[i]?.crossing && !segments[i - 1]?.crossing;
    const nameChange = segments[i]?.name && segments[i].name !== segments[i - 1]?.name;
    const bend = Math.abs(angle) >= 50 && at - lastAt >= 18;
    const progress = at - lastAt >= 500;
    if (!crossing && !nameChange && !bend && !progress) continue;
    const kind = crossing ? 'crossing' : bend ? (Math.abs(angle) > 145 ? 'turn' : angle > 0 ? 'right' : 'left') : 'continue';
    const title = crossing ? '횡단 구간 확인' : bend ? (Math.abs(angle) > 145 ? '길이 크게 꺾이는 지점' : `길을 따라 ${angle > 0 ? '오른쪽' : '왼쪽'}으로`) : `${direction(outgoing)}으로 계속`;
    steps.push({ point: points[i], at, heading: outgoing, kind, title,
      detail: crossing ? '신호·통행 조건을 확인하고 지도 경로를 따라가요.' : `${roadLabel(i)} · 지도에 그려진 길의 방향이에요.`, context: nearbyRoad(points[i], roads) });
    lastAt = at;
  }
  if (outback) steps.push({ point: points[end], at: endDistance, kind: 'turnaround', title: '여기서 돌아오기', detail: `이 지점에서 방향을 바꿔 왔던 길로 ${formatDistance(total - endDistance)} 돌아와요.`, context: nearbyRoad(points[end], roads) });
  steps.push({ point: points.at(-1), at: total, kind: 'finish', title: '출발점 도착', detail: `총 ${formatDistance(total)} 달리기.`, context: nearbyRoad(points[0], roads) });
  steps.forEach((step, i) => { step.id = i; step.nextDistance = steps[i + 1] ? steps[i + 1].at - step.at : 0; });
  return { steps, outback, total, heading, startLabel: nearbyRoad(points[0], roads), turnaround: outback ? steps.at(-2) : null, distances };
}
