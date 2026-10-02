import { meters } from './routing.js';

export const PRESETS = [
  { id: 'preset-forest', name: '철길숲 주변', point: [36.021, 129.337], description: '희망대로514번길 부근 · 지도에서 조정 가능', aliases: ['철길숲', '포항 철길숲'], source: '추천 위치' },
  { id: 'preset-postech', name: 'POSTECH 주변', point: [36.0135, 129.325], description: '캠퍼스 주변 · 지도에서 조정 가능', aliases: ['포스텍', '포항공과대학교', '포항공대', 'POSTECH'], source: '추천 위치' },
];
const normal = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s,·.()\-]/g, '');
const searchTerm = value => normal(value).replace(/대한민국|경상북도|포항시|포항/g, '');
export function inCoverage(point, bbox) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Boolean(bbox) && point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}
export function placeIndex(dataset) {
  const index = PRESETS.map(p => ({ ...p, text: searchTerm([p.name, ...p.aliases].join(' ')) }));
  const roads = new Map(), center = [36.021, 129.337];
  for (const el of dataset?.raw?.elements || []) {
    const t = el.tags || {}, name = t['name:ko'] || t.name;
    if (!name || ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction'].includes(t.highway)) continue;
    const coords = el.type === 'node' ? [[el.lat, el.lon]] : (el.geometry || []).filter(Boolean).map(p => [p.lat, p.lon]);
    const inside = coords.filter(p => inCoverage(p, dataset.bbox));
    if (!inside.length) continue;
    const point = inside[Math.floor(inside.length / 2)];
    const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    const item = { id: `${el.type}/${el.id}`, name, point, source: '저장된 지도', isRoad: Boolean(t.highway), description: address || (t.highway ? '도로 중 한 지점 · 선택 후 지도에서 조정' : '포항 · 저장된 지도에 등록된 장소'), text: searchTerm([name, t['name:en'], t.alt_name, t.short_name, address].filter(Boolean).join(' ')) };
    if (t.highway) {
      const old = roads.get(name);
      if (!old || meters(point, center) < meters(old.point, center)) roads.set(name, item);
    } else index.push(item);
  }
  return [...index, ...roads.values()];
}
export function searchLocal(index, query, limit = 6) {
  const q = searchTerm(query); if (!q) return [];
  return index.filter(p => p.text.includes(q)).sort((a, b) => {
    const score = p => searchTerm(p.name) === q ? 0 : p.source === '추천 위치' ? 1 : searchTerm(p.name).startsWith(q) ? 2 : 3;
    return score(a) - score(b) || a.name.length - b.name.length;
  }).slice(0, limit);
}
export function photonUrl(query, endpoint = 'https://photon.komoot.io/api/') {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ q: query.trim(), limit: '6', lat: '36.021', lon: '129.337', countrycode: 'KR' });
  return url.toString();
}
export function parsePhoton(data, bbox) {
  if (!Array.isArray(data?.features)) throw new Error('검색 결과를 읽지 못했어요.');
  return data.features.flatMap((f, i) => {
    const t = f.properties || {}, c = f.geometry?.coordinates;
    if (f.geometry?.type !== 'Point' || !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) return [];
    const point = [c[1], c[0]], name = t.name || [t.street, t.housenumber].filter(Boolean).join(' ');
    if (typeof name !== 'string' || !name.trim()) return [];
    return [{ id: `online/${t.osm_type || 'place'}/${t.osm_id || i}`, name, point, isRoad: t.type === 'street', source: '온라인 지도', description: [...new Set([t.state, t.city, t.district, t.locality, t.street, t.housenumber].filter(Boolean))].join(' ') || '온라인 지도에 등록된 장소', outside: !inCoverage(point, bbox) }];
  });
}
export function mergePlaces(local, online, limit = 10) {
  const merged = [...local];
  for (const item of online) if (!merged.some(p => normal(p.name) === normal(item.name) && meters(p.point, item.point) < 120)) merged.push(item);
  return merged.sort((a, b) => Number(Boolean(a.outside)) - Number(Boolean(b.outside))).slice(0, limit);
}
// Submitted searches only. Cache is in memory; location is never sent to search.
export function createOnlineSearch({ fetcher = (...args) => fetch(...args), now = Date.now, endpoint = 'https://photon.komoot.io/api/', minInterval = 1500 } = {}) {
  const cache = new Map(); let lastRequest = -Infinity;
  return async (query, { signal } = {}) => {
    const q = query.trim();
    if (q.length < 2 || q.length > 120) throw new Error('검색어를 2~120자로 입력해 주세요.');
    const key = normal(q), cached = cache.get(key);
    if (cached && now() - cached.time < 600000) return cached.data;
    if (now() - lastRequest < minInterval) throw new Error('잠시 후 검색을 다시 눌러 주세요.');
    lastRequest = now();
    const response = await fetcher(photonUrl(q, endpoint), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(response.status === 429 ? '온라인 검색이 붐비고 있어요. 잠시 후 다시 검색해 주세요.' : '온라인 검색에 연결하지 못했어요.');
    let data;
    try { data = await response.json(); } catch { throw new Error('온라인 지도에서 검색 결과를 받지 못했어요.'); }
    if (!Array.isArray(data?.features)) throw new Error('검색 결과를 읽지 못했어요.');
    cache.set(key, { data, time: now() }); if (cache.size > 30) cache.delete(cache.keys().next().value);
    return data;
  };
}
export function locationError(error) {
  return error?.code === 1 ? '위치 권한이 꺼져 있어요. 브라우저에서 위치를 허용하거나 검색·추천 위치를 사용해 주세요.' : error?.code === 3 ? '위치 확인 시간이 지났어요. 다시 누르거나 검색으로 출발지를 찾아 주세요.' : '현재 위치를 확인하지 못했어요. 검색이나 추천 위치를 사용해 주세요.';
}
