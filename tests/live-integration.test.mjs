import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildGraph,
  generateRoutes,
  mergeExploration,
  EXPLORATION_STRATEGIES,
  snapStart,
} from "../src/engine/routing.js";
import { adaptLiveRoutes } from "../src/live-adapter.js";
import {
  recommend,
  score,
  coloredSegments,
  heightRange,
} from "../src/domain.ts";
const data = JSON.parse(
  fs.readFileSync(new URL("../public/map-data/pohang.json", import.meta.url)),
);
const terrain = JSON.parse(
  fs.readFileSync(new URL("../public/map-data/terrain.json", import.meta.url)),
);
const graph = buildGraph(data.raw, data.bbox, terrain);
test("saved POSTECH candidate pool integrates with independent recommendation criteria", () => {
  const options = {
    point: [36.0135, 129.325],
    distance: 5000,
    avoidSteps: true,
  };
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
  const result = mergeExploration(batches, options),
    routes = adaptLiveRoutes(result.routes, graph);
  assert.ok(routes.length > 3);
  assert.ok(
    routes.every((r) => Math.abs(r.length - 5000) / 5000 <= 0.2 + 1e-8),
  );
  const rec = recommend(routes),
    best = rec.cards.find((c) => c.reasons.includes("best"));
  assert.equal(score(best.route), Math.max(...routes.map(score)));
  const flat = rec.cards.find((c) => c.reasons.includes("elevation"));
  assert.equal(
    flat.route.evidence.elevation.range,
    Math.min(
      ...routes
        .filter((r) => r.evidence.elevation.state === "estimated")
        .map((r) => r.evidence.elevation.range),
    ),
  );
  assert.ok(
    rec.pending.includes("signals"),
    "unknown crossings must not silently become zero signals",
  );
  for (const mode of ["A", "B", "C"])
    assert.ok(
      coloredSegments(best.route, mode, heightRange(routes)).length > 0,
    );
});
test("start snapping exposes offset and rejects unsupported locations", () => {
  const snap = snapStart(graph, [36.0135, 129.325]);
  assert.ok(snap.offset >= 0 && snap.offset <= 100);
  assert.throws(() => snapStart(graph, [37, 127]), /저장된 지도 영역/);
  assert.throws(
    () => snapStart({ ...graph, edges: [] }, [36.0135, 129.325]),
    /100m/,
  );
});
test("a different selected start and distance produce routes from that start", () => {
  const point = [36.021, 129.337];
  const start = snapStart(graph, point).point;
  const began = performance.now();
  const batches = [];
  for (let variant = 0; variant < 2; variant++)
    for (const strategy of EXPLORATION_STRATEGIES)
      batches.push({ ...generateRoutes(graph, { point, distance: 3000, avoidSteps: true, profile: strategy, variant, collect: true }), strategy, variant });
  const routes = adaptLiveRoutes(mergeExploration(batches, { point, distance: 3000, avoidSteps: true }).routes, graph);
  assert.ok(routes.length > 0);
  assert.ok(routes.every(r => Math.abs(r.points[0][0] - start[0]) < 1e-8 && Math.abs(r.points[0][1] - start[1]) < 1e-8));
  assert.ok(routes.every(r => Math.abs(r.length - 3000) <= 600.001));
  assert.ok(Math.abs(start[1] - 129.325) > 0.01, 'must not reuse the POSTECH fixture origin');
  console.log(`Forest 3km: ${routes.length} candidates in ${Math.round(performance.now() - began)}ms`);
});
test("missing terrain preserves routes with unknown elevation", () => {
  const noTerrain = buildGraph(data.raw, data.bbox, null);
  const result = generateRoutes(noTerrain, {
    point: [36.0135, 129.325],
    distance: 5000,
    avoidSteps: true,
    profile: EXPLORATION_STRATEGIES[0],
    variant: 0,
    collect: true,
  });
  const merged = mergeExploration(
    [{ ...result, strategy: EXPLORATION_STRATEGIES[0], variant: 0 }],
    { distance: 5000 },
  );
  assert.ok(merged.routes.length > 0);
  const rec = recommend(merged.routes);
  assert.ok(rec.cards.some((c) => c.reasons.includes("best")));
  assert.ok(rec.pending.includes("elevation"));
});

test("actual passage adapter counts immediate signal turnaround twice without changing total score", () => {
  const route = {
    id: "turn",
    points: [
      [36, 129],
      [36.001, 129],
      [36, 129],
    ],
    segments: [
      { physicalId: "signal", from: 0, to: 100, length: 100, crossing: true },
      { physicalId: "signal", from: 100, to: 0, length: 100, crossing: true },
    ],
    comparison: { recommendationScore: 82 },
  };
  const tagged = adaptLiveRoutes([route], {
    edges: [{ id: "signal", signal: "tagged" }],
  })[0];
  assert.equal(tagged.signals, 2);
  assert.equal(tagged.crossings.length, 2);
  assert.equal(tagged.comparison.recommendationScore, 82);
  const noSignal = adaptLiveRoutes([route], {
    edges: [{ id: "signal", signal: "none" }],
  })[0];
  assert.equal(noSignal.signals, 0);
  assert.equal(noSignal.unknownCrossings, 0);
  const missing = adaptLiveRoutes([route], { edges: [] })[0];
  assert.equal(missing.signals, 0);
  assert.equal(missing.unknownCrossings, 2);
});
