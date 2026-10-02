export type Point = [number, number];
export type Mode = "A" | "B" | "C";
export type MapLayers = {
  elevation: boolean;
  signals: boolean;
  shops: boolean;
  water: boolean;
};
export const defaultLayers: MapLayers = {
  elevation: true,
  signals: true,
  shops: false,
  water: false,
};
// C remains a compatible URL alias; slope magnitude and direction are one display.
export function resolveMode(value: string | null): Mode {
  return value === "A" ? "A" : "B";
}
export type Reason = "best" | "elevation" | "signals";
export type Elevation = {
  state: string;
  range: number | null;
  coverage: number;
  profile: { at: number; elevation: number | null }[];
};
export type Route = {
  id: string;
  length: number;
  points: Point[];
  kind: string;
  error?: number;
  segments?: {
    length: number;
    bridge?: boolean;
    tunnel?: boolean;
    name?: string;
  }[];
  evidence: { bonus: number; elevation: Elevation; description?: string };
  comparison?: { recommendationScore?: number; score?: number; error?: number };
  crossings: { at: number; p: Point; signal: boolean; unknown: boolean }[];
  signals: number;
  inferredSignals?: number;
  unknownCrossings: number;
  shops: number;
  facilities?: {
    p?: Point;
    name?: string;
    kind?: string;
    type?: string;
    id?: string;
    offset?: number;
  }[];
};
export function routeFacilities(route: Route, type: "shop" | "water") {
  const seen = new Set<string>();
  return (route.facilities || []).filter((p) => {
    if (p.type !== type || !p.p || !p.p.every(Number.isFinite)) return false;
    const key = p.id || `${p.p[0].toFixed(6)},${p.p[1].toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export type Recommendation = { route: Route; reasons: Reason[] };
export const reasonLabels: Record<Reason, string> = {
  best: "최적 코스",
  elevation: "고저차 최소",
  signals: "가장 덜 끊기는 코스",
};
export function score(r: Route) {
  return (
    r.comparison?.recommendationScore ?? r.comparison?.score ?? r.evidence.bonus
  );
}
export function tieBreak(a: Route, b: Route) {
  return (
    score(b) - score(a) ||
    (a.comparison?.error ?? a.error ?? 0) -
      (b.comparison?.error ?? b.error ?? 0) ||
    a.id.localeCompare(b.id)
  );
}
export function recommend(routes: Route[]) {
  const cards: Recommendation[] = [];
  const pending: Reason[] = [];
  const by = new Map<string, Recommendation>();
  const choose = (
    reason: Reason,
    eligible: Route[],
    metric: (r: Route) => number,
  ) => {
    const winner = [...eligible].sort(
      (a, b) => metric(a) - metric(b) || tieBreak(a, b),
    )[0];
    if (!winner) {
      pending.push(reason);
      return;
    }
    const existing = by.get(winner.id);
    if (existing) existing.reasons.push(reason);
    else {
      const card = { route: winner, reasons: [reason] };
      by.set(winner.id, card);
      cards.push(card);
    }
  };
  choose("best", routes, (r) => -score(r));
  choose(
    "elevation",
    routes.filter(
      (r) =>
        r.evidence.elevation.state === "estimated" &&
        r.evidence.elevation.coverage === 1 &&
        r.evidence.elevation.profile.length > 0 &&
        r.evidence.elevation.profile.every(
          (p) => p.elevation !== null && Number.isFinite(p.elevation),
        ) &&
        Number.isFinite(r.evidence.elevation.range),
    ),
    (r) => r.evidence.elevation.range!,
  );
  choose(
    "signals",
    routes.filter(
      (r) =>
        r.unknownCrossings === 0 &&
        r.crossings.every(
          (c) => c.unknown === false && typeof c.signal === "boolean",
        ) &&
        Number.isFinite(r.signals),
    ),
    (r) => r.signals,
  );
  return { cards, pending };
}
export function meters(a: Point, b: Point) {
  const rad = Math.PI / 180,
    dy = (b[0] - a[0]) * rad,
    dx = (b[1] - a[1]) * rad;
  return (
    12742000 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin(dy / 2) ** 2 +
            Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dx / 2) ** 2,
        ),
      ),
    )
  );
}
export function distances(points: Point[]) {
  const out = [0];
  for (let i = 1; i < points.length; i++)
    out.push(out[i - 1] + meters(points[i - 1], points[i]));
  return out;
}
export function atDistance(points: Point[], ds: number[], at: number): Point {
  let i = 1;
  while (i < ds.length - 1 && ds[i] < at) i++;
  const t = Math.max(
    0,
    Math.min(1, (at - ds[i - 1]) / (ds[i] - ds[i - 1] || 1)),
  );
  return [
    points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
    points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
  ];
}
export function heightRange(routes: Route[]): [number, number] {
  const values = routes
    .flatMap((r) => r.evidence.elevation.profile.map((p) => p.elevation))
    .filter((e): e is number => e !== null && Number.isFinite(e));
  if (!values.length) return [0, 10];
  const lo = values.reduce((a, b) => Math.min(a, b), Infinity),
    hi = values.reduce((a, b) => Math.max(a, b), -Infinity);
  const min = Math.floor(lo / 10) * 10,
    max = Math.ceil(hi / 10) * 10;
  return [min, Math.max(min + 10, max)];
}
export type ColoredSegment = {
  points: Point[];
  color: string;
  grade: number | null;
  elevation: number | null;
  at: number;
  offset: boolean;
  unknown: boolean;
};
export function segmentColor(
  mode: Mode,
  elevation: number | null,
  grade: number | null,
  range: [number, number],
) {
  if (elevation === null || grade === null) return "#8d929b";
  if (mode !== "A") {
    const magnitude = Math.abs(grade);
    if (magnitude <= 3) return "#899297";
    const intensity = Math.min(1, (magnitude - 3) / 9);
    const pale = grade > 0 ? [228, 165, 165] : [153, 187, 220];
    const dark = grade > 0 ? [174, 44, 54] : [35, 94, 163];
    return `rgb(${pale.map((n, i) => Math.round(n + (dark[i] - n) * intensity)).join(",")})`;
  }
  const t = Math.max(
    0,
    Math.min(1, (elevation - range[0]) / (range[1] - range[0] || 1)),
  );
  return `rgb(${Math.round(235 - 75 * t)},${Math.round(161 - 147 * t)},${Math.round(163 - 117 * t)})`;
}
export function coloredSegments(
  route: Route,
  mode: Mode,
  range: [number, number],
): ColoredSegment[] {
  const ds = distances(route.points),
    total = ds.at(-1) || 0,
    profile = route.evidence.elevation.profile;
  if (!profile.length)
    return [
      {
        points: route.points,
        color: "#8d929b",
        grade: null,
        elevation: null,
        at: 0,
        offset: false,
        unknown: true,
      },
    ];
  const physical = new Map<string, Set<number>>();
  const keys: string[] = [];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1].map((x) => x.toFixed(6)).join(","),
      b = route.points[i].map((x) => x.toFixed(6)).join(",");
    const k = [a, b].sort().join("|");
    keys.push(k);
    const dirs = physical.get(k) || new Set();
    dirs.add(a < b ? 1 : -1);
    physical.set(k, dirs);
  }
  const result: ColoredSegment[] = [];
  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1],
      current = profile[i],
      start = Math.max(0, prev.at),
      end = Math.min(total, current.at);
    if (end <= start) continue;
    let grade =
      prev.elevation === null || current.elevation === null
        ? null
        : (100 * (current.elevation - prev.elevation)) / (current.at - prev.at);
    let elevation =
      prev.elevation === null || current.elevation === null
        ? null
        : (prev.elevation + current.elevation) / 2;
    const interior = ds
      .map((at, index) => ({ at, index }))
      .filter((v) => v.at > start + 0.001 && v.at < end - 0.001);
    const pts = [
      atDistance(route.points, ds, start),
      ...interior.map((v) => route.points[v.index]),
      atDistance(route.points, ds, end),
    ];
    let edge = 1;
    while (edge < ds.length - 1 && ds[edge] <= start) edge++;
    const edges: number[] = [];
    for (let j = edge; j < ds.length && ds[j - 1] < end; j++) edges.push(j - 1);
    if (
      edges.some(
        (j) => route.segments?.[j]?.bridge || route.segments?.[j]?.tunnel,
      )
    ) {
      grade = null;
      elevation = null;
    }
    // Opposite traversals shift to their own right in screen space, never in source coordinates.
    const offset =
      mode !== "A" && edges.some((j) => (physical.get(keys[j])?.size || 0) > 1);
    result.push({
      points: pts,
      color: segmentColor(mode, elevation, grade, range),
      grade,
      elevation,
      at: start,
      offset,
      unknown: elevation === null || grade === null,
    });
  }
  return result;
}
export function formatKm(m: number) {
  return (m / 1000).toFixed(1);
}
