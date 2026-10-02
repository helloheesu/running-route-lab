import type { Point } from './domain';
export type Bbox = [number, number, number, number];
export type Region = { id?: string; bbox: Bbox; raw: any; terrain: any; fetchedAt: string; source?: string; version?: string; osmTimestamp?: string };
const DAY = 86400000;
const CACHE = 'route-lab-regions-v1';
const ROAD_CACHE = 'route-lab-road-tiles-v1';
const TILE_CACHE = 'route-lab-terrain-v1';
type Coverage = { type: 'Polygon' | 'MultiPolygon'; coordinates: any[] };
export type Manifest = { version: string; step: number; osmTimestamp: string; builtAt: string; coverage?: Coverage; tiles: Record<string, { file: string; bytes: number }> };
let manifest: Manifest | null = null;
const memory = new Map<string, Region>();
export function supportsOrigin(point: Point, coverage?: Coverage) {
  if (!coverage) return true; // Legacy packs/tests without a regional mask.
  const [y, x] = point;
  function inRing(ring: number[][]) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = ring[i], [c, d] = ring[j];
      if (Math.abs((x-a)*(d-b)-(y-b)*(c-a)) < 1e-12 && x >= Math.min(a,c) && x <= Math.max(a,c) && y >= Math.min(b,d) && y <= Math.max(b,d)) return true;
      if ((b > y) !== (d > y) && x < (c-a)*(y-b)/(d-b)+a) inside = !inside;
    }
    return inside;
  }
  const polygons = coverage.type === 'Polygon' ? [coverage.coordinates] : coverage.coordinates;
  return polygons.some((rings: number[][][]) => inRing(rings[0]) && !rings.slice(1).some(inRing));
}
export async function ensureSupportedOrigin(point: Point, signal: AbortSignal) {
  const index = await getManifest(signal);
  if (!supportsOrigin(point, index.coverage)) throw Error('현재 서울·경기·인천과 경상권에서 코스를 만들 수 있어요. 이 지역 안에서 출발지를 골라 주세요.');
  return index;
}
export function regionBounds(point: Point, km: number): Bbox {
  // A closed course within +20% cannot get farther than half its total length.
  const radius = Math.max(1, km * .6 + .3), lat = Math.round(point[0] * 200) / 200, lon = Math.round(point[1] * 200) / 200;
  const dy = (radius + .4) / 111.32, dx = dy / Math.cos(lat * Math.PI / 180);
  return [lat - dy, lon - dx, lat + dy, lon + dx].map(n => +n.toFixed(6)) as Bbox;
}
export function contains(data: Region | null, p: Point, km = 0) {
  if (!data) return false;
  const margin = km ? (km * .6 + .2) / 111.32 : 0, dx = margin / Math.cos(p[0] * Math.PI / 180);
  const [s, w, n, e] = data.bbox;
  return p[0] - margin >= s && p[0] + margin <= n && p[1] - dx >= w && p[1] + dx <= e;
}
export function tileKeys(b: Bbox, step: number) {
  const keys = [];
  for (let y = Math.floor(b[0] / step); y <= Math.floor(b[2] / step); y++)
    for (let x = Math.floor(b[1] / step); x <= Math.floor(b[3] / step); x++) keys.push(`${y},${x}`);
  return keys;
}
export function decodeTile(raw: any) {
  if (raw?.format !== 2) return raw;
  if (!Array.isArray(raw.elements)) throw Error('잘못된 지도 파일');
  return { elements: raw.elements.map((e: any) => {
    if (e.type !== 'way') return e;
    if (!Array.isArray(e.refs) || !Array.isArray(e.coords) || e.coords.length !== e.refs.length * 2) throw Error('잘못된 도로 좌표');
    let id = 0, lat = 0, lon = 0;
    const nodes: number[] = [], geometry: {lat:number;lon:number}[] = [];
    const bounds = { minlat: Infinity, minlon: Infinity, maxlat: -Infinity, maxlon: -Infinity };
    for (let i = 0; i < e.refs.length; i++) {
      id += e.refs[i]; lat += e.coords[i * 2]; lon += e.coords[i * 2 + 1];
      if (![id, lat, lon].every(Number.isSafeInteger)) throw Error('잘못된 도로 좌표');
      const p = { lat: lat / 1e7, lon: lon / 1e7 };
      nodes.push(id); geometry.push(p);
      bounds.minlat = Math.min(bounds.minlat, p.lat); bounds.maxlat = Math.max(bounds.maxlat, p.lat);
      bounds.minlon = Math.min(bounds.minlon, p.lon); bounds.maxlon = Math.max(bounds.maxlon, p.lon);
    }
    return { type: e.type, id: e.id, tags: e.tags, nodes, geometry, bounds };
  }) };
}
export function mergeTiles(parts: any[]) {
  const elements = new Map();
  for (const raw of parts) {
    if (!Array.isArray(raw?.elements)) throw Error('지역 지도 파일을 읽지 못했어요. 다시 시도해 주세요.');
    for (const el of raw.elements) elements.set(`${el.type}/${el.id}`, el);
  }
  return { elements: [...elements.values()].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id) };
}
export function validRaw(raw: any) {
  return !raw?.remark && Array.isArray(raw?.elements) && raw.elements.some((e: any) => e.type === 'way' && e.tags?.highway && e.nodes?.length > 1 && e.geometry?.length === e.nodes.length);
}
async function openCache(name: string) { try { return await caches.open(name); } catch { return null; } }
async function storeResponse(cache: Cache | null, key: string, response: Response, limit: number) {
  try {
    await cache?.put(key, response);
    const keys = await cache?.keys() || [];
    for (const old of keys.slice(0, Math.max(0, keys.length - limit))) await cache?.delete(old);
  } catch { /* Private browsing and full storage still permit an uncached run. */ }
}
function abort(signal: AbortSignal) { signal.throwIfAborted(); }
async function getManifest(signal: AbortSignal): Promise<Manifest> {
  if (manifest) return manifest;
  const cache = await openCache(ROAD_CACHE);
  const url = new URL('/map-regions/manifest.json', location.origin).href;
  let data: any;
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), cache: 'no-cache' });
    if (!response.ok) throw Error();
    data = await response.clone().json();
    if (![1, 2].includes(data.format) || !data.tiles || data.step !== .05) throw Error();
    await storeResponse(cache, url, response, 256);
  } catch (e) {
    abort(signal);
    try { data = await (await cache?.match(url))?.json(); } catch { data = null; }
    if (!data) throw Error('이 실행본은 포항 샘플 지도를 제공합니다. 다른 지역을 계산하려면 실행 가이드에 따라 광역 지도 자료를 먼저 준비해 주세요.');
  }
  if (![1, 2].includes(data.format) || typeof data.version !== 'string' || !data.tiles || data.step !== .05) throw Error('지역 지도 목록이 올바르지 않아요.');
  return manifest = data;
}
export async function hasRegionalData(signal: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch('/map-regions/manifest.json', { signal, cache: 'no-cache' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d.tiles && Object.keys(d.tiles).length > 0;
  } catch { return false; }
}

export async function fetchRoads(bbox: Bbox, index: Manifest, signal: AbortSignal, onProgress: (text: string) => void, fetcher: typeof fetch = fetch) {
  const tiles = tileKeys(bbox, index.step).map(key => index.tiles[key]).filter(Boolean);
  if (!tiles.length) throw Error('이 위치에는 준비된 한국 지도 자료가 없어요. 다른 위치를 선택해 주세요.');
  const failure = new AbortController();
  signal = AbortSignal.any([signal, failure.signal]);
  const cache = await openCache(ROAD_CACHE), parts: any[] = [];
  let next = 0, completed = 0;
  async function download() {
    while (next < tiles.length) {
      abort(signal);
      const tile = tiles[next++];
      if (!/^[0-9]+-[0-9]+-[a-f0-9]+\.json\.gz$/.test(tile.file)) throw Error('지역 지도 파일명이 올바르지 않아요.');
      const url = new URL(`/map-regions/${tile.file}`, location.origin).href;
      let res = await cache?.match(url);
      if (!res) {
        res = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
        if (!res.ok) throw Error('주변 지도를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
        await storeResponse(cache, url, res.clone(), 256);
      }
      const bytes = await res.arrayBuffer();
      // Content-Encoding may already have decompressed a gzip file at the host.
      const compressed = new Uint8Array(bytes)[0] === 0x1f && new Uint8Array(bytes)[1] === 0x8b;
      const decoded = compressed ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))) : new Response(bytes);
      try { parts.push(decodeTile(await decoded.json())); }
      catch { await cache?.delete(url); throw Error('지역 지도 파일을 읽지 못했어요. 다시 시도해 주세요.'); }
      abort(signal);
      onProgress(`주변 지도 준비 중 · ${++completed}/${tiles.length}`);
    }
  }
  try { await Promise.all(Array.from({length:Math.min(3,tiles.length)},download)); }
  catch (error) { failure.abort(); throw error; }
  const raw = mergeTiles(parts);
  const [south, west, north, east] = bbox;
  raw.elements = raw.elements.filter(el => {
    const b = el.type === 'node' ? { minlat: el.lat, maxlat: el.lat, minlon: el.lon, maxlon: el.lon } : el.bounds;
    return !b || b.maxlat >= south - .001 && b.minlat <= north + .001 && b.maxlon >= west - .001 && b.minlon <= east + .001;
  });
  if (!validRaw(raw)) throw Error('이 주변에 등록된 도로가 없어요. 다른 위치를 골라 주세요.');
  return raw;
}
async function loadTerrain(bbox: Bbox, signal: AbortSignal) {
  const zoom = 12, n = 256 * 2 ** zoom;
  const pixel = (lat: number, lon: number) => [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n];
  const a = pixel(bbox[2], bbox[1]), b = pixel(bbox[0], bbox[3]);
  const x0 = Math.floor(a[0]) - 2, y0 = Math.floor(a[1]) - 2, width = Math.ceil(b[0]) - x0 + 3, height = Math.ceil(b[1]) - y0 + 3;
  const values: (number | null)[] = Array(width * height).fill(null), cache = await openCache(TILE_CACHE);
  // Sequential tile requests keep downloads bounded and cancel promptly on a new origin.
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + height - 1) / 256); ty++) {
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + width - 1) / 256); tx++) {
      abort(signal);
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
      let response = await cache?.match(url);
      if (!response) {
        response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), credentials: 'omit' });
        if (!response.ok) throw Error('고도 자료 연결 실패');
        await storeResponse(cache, url, response.clone(), 128);
      }
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const rgba = ctx.getImageData(0, 0, 256, 256).data;
      for (let y = Math.max(y0, ty * 256); y < Math.min(y0 + height, (ty + 1) * 256); y++) {
        for (let x = Math.max(x0, tx * 256); x < Math.min(x0 + width, (tx + 1) * 256); x++) {
          const i = ((y - ty * 256) * 256 + x - tx * 256) * 4;
          values[(y - y0) * width + x - x0] = rgba[i + 3] ? Math.round((rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768) * 10) : null;
        }
      }
    }
  }
  return { source: 'AWS Terrain Tiles · 지형 고도 추정', sourceUrl: 'https://registry.opendata.aws/terrain-tiles/', fetchedAt: new Date().toISOString(), bbox, zoom, x0, y0, width, height, scale: .1, nominalPixelMeters: Math.round(156543.03 * Math.cos(bbox[0] * Math.PI / 180) / 2 ** zoom), values };
}
export async function loadRegion(point: Point, km: number, signal: AbortSignal, onProgress: (text: string) => void): Promise<Region> {
  if (!point.every(Number.isFinite) || Math.abs(point[0]) > 80 || Math.abs(point[1]) > 180) throw Error('이 위치의 지도를 불러올 수 없어요. 다른 위치를 선택해 주세요.');
  const index = await ensureSupportedOrigin(point, signal);
  const reusable = (d: Region) => d.version === index.version && Date.now() - Date.parse(d.fetchedAt) < 7 * DAY && contains(d, point, km) && validRaw(d.raw);
  for (const data of memory.values()) if (reusable(data)) return data;
  onProgress('저장된 지역 지도를 확인하고 있어요');
  const cache = await openCache(CACHE);
  for (const key of await cache?.keys() || []) {
    abort(signal);
    try {
      const data = await (await cache!.match(key))!.json();
      if (reusable(data)) { memory.set(data.id, data); return data; }
      if (Date.now() - Date.parse(data.fetchedAt) >= 7 * DAY) await cache?.delete(key);
    } catch { /* Ignore an invalid cache entry. */ }
  }
  abort(signal);
  const bbox = regionBounds(point, km), id = bbox.join(',');
  onProgress('주변 지도 파일을 불러오고 있어요');
  const raw = await fetchRoads(bbox, index, signal, onProgress);
  onProgress('고도 자료를 준비하고 있어요');
  const terrain = await loadTerrain(bbox, signal).catch(() => null);
  abort(signal);
  const data: Region = { id, bbox, raw, terrain, fetchedAt: new Date().toISOString(), version: index.version, osmTimestamp: index.osmTimestamp, source: 'OpenStreetMap · Geofabrik South Korea' };
  memory.set(id, data);
  if (memory.size > 8) memory.delete(memory.keys().next().value!);
  await storeResponse(cache, new URL(`/__running-cache/v1/${id}`, location.origin).href, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), 8);
  return data;
}
