import fs from "node:fs";
import {
  buildGraph,
  generateRoutes,
  mergeExploration,
  EXPLORATION_STRATEGIES,
  overlap,
  meters,
} from "../src/engine/routing.js";
const data = JSON.parse(fs.readFileSync("public/map-data/pohang.json"));
const terrain = JSON.parse(fs.readFileSync("public/map-data/terrain.json"));
const graph = buildGraph(data.raw, data.bbox, terrain);
const options = { point: [36.0135, 129.325], distance: 5000, avoidSteps: true };
const batches = [];
for (let variant = 0; variant < 2; variant++)
  for (const strategy of EXPLORATION_STRATEGIES)
    batches.push({
      ...generateRoutes(graph, {
        ...options,
        profile: strategy,
        variant,
        collect: true,
      }),
      strategy,
      variant,
    });
const result = mergeExploration(batches, options);
const loops = result.routes
  .filter(
    (r) =>
      r.kind === "순환형" &&
      r.length < 5700 &&
      r.evidence.elevation.state === "estimated",
  )
  .sort(
    (a, b) =>
      b.comparison.recommendationScore - a.comparison.recommendationScore,
  );
const picked = [];
for (const r of loops) {
  if (
    !picked.length ||
    picked.every(
      (p) =>
        Math.abs(p.length - r.length) > 250 &&
        p.points.some((pt) => !r.points.some((q) => meters(pt, q) < 50)),
    )
  )
    picked.push(r);
  if (picked.length === 3) break;
}
if (picked.length !== 3) throw Error("Need three example geometries");
const routes = picked.map((r, i) => {
  const copy = structuredClone(r);
  copy.id = `demo-${i + 1}`;
  const range = [35, 15, 55][i],
    signals = [3, 4, 1][i];
  const ds = [0];
  for (let j = 1; j < r.points.length; j++)
    ds.push(ds.at(-1) + meters(r.points[j - 1], r.points[j]));
  const position = (at) => {
    let j = 1;
    while (j < ds.length - 1 && ds[j] < at) j++;
    const t = (at - ds[j - 1]) / (ds[j] - ds[j - 1] || 1);
    return r.points[j - 1].map((n, k) => n + (r.points[j][k] - n) * t);
  };
  const total = ds.at(-1),
    samples = [];
  for (let at = 0; at < total; at += 50)
    samples.push({
      at,
      elevation:
        10 +
        range *
          ((0.62 * (1 - Math.cos((2 * Math.PI * at) / total))) / 2 +
            0.65 * Math.exp(-(((at - total * 0.37) / 140) ** 2))),
    });
  samples.push({ at: total, elevation: 10 });
  const lo = Math.min(...samples.map((p) => p.elevation)),
    hi = Math.max(...samples.map((p) => p.elevation));
  for (const p of samples)
    p.elevation = 10 + (range * (p.elevation - lo)) / (hi - lo);
  copy.evidence = {
    bonus: 95 - i * 10,
    elevation: { state: "estimated", range, coverage: 1, profile: samples },
  };
  copy.comparison = {
    recommendationScore: 95 - i * 10,
    error: Math.abs(r.length - 5000) / 5000,
  };
  copy.crossings = Array.from({ length: signals }, (_, j) => ({
    at: (total * (j + 1)) / (signals + 1),
    p: position((total * (j + 1)) / (signals + 1)),
    signal: true,
    unknown: false,
  }));
  copy.signals = signals;
  copy.inferredSignals = 0;
  copy.unknownCrossings = 0;
  copy.shops = [4, 2, 1][i];
  copy.facilities = Array.from({ length: copy.shops }, (_, j) => ({
    id: `demo-shop-${i}-${j}`,
    p: position((total * (j + 0.5)) / (copy.shops + 1)),
    type: "shop",
    name: `예시 편의점 ${j + 1}`,
    offset: 0,
  }));
  copy.water = [2, 0, 1][i];
  copy.facilities.push(
    ...Array.from({ length: copy.water }, (_, j) => ({
      id: `demo-water-${i}-${j}`,
      p: position((total * (j + 0.8)) / (copy.water + 1)),
      type: "water",
      name: `예시 급수대 ${j + 1}`,
      offset: 0,
    })),
  );
  copy.segments = copy.segments.map((s) => ({
    ...s,
    bridge: false,
    tunnel: false,
  }));
  delete copy.searches;
  delete copy.completions;
  delete copy.completionSearch;
  return copy;
});
fs.mkdirSync("public/demo", { recursive: true });
fs.writeFileSync(
  "public/demo/postech-5k.json",
  JSON.stringify({
    id: "postech-5k",
    origin: result.snap.point,
    name: "POSTECH 주변",
    target: 5000,
    source:
      "Saved OSM route geometry, deliberately simulated elevation/signals/shops/water/scores for UI testing. Not field evidence.",
    routes,
  }),
);
fs.writeFileSync(
  "public/demo/real-reference-summary.json",
  JSON.stringify({
    sourceDate: data.fetchedAt,
    candidates: result.routes.length,
    terrainEstimated: result.routes.filter(
      (r) => r.evidence.elevation.state === "estimated",
    ).length,
    signalsKnown: result.routes.filter((r) => r.unknownCrossings === 0).length,
  }),
);
console.log(
  "Demo geometries:",
  routes.map((r) => ({
    id: r.id,
    km: r.length / 1000,
    points: r.points.length,
  })),
  "Real candidate count:",
  result.routes.length,
);
