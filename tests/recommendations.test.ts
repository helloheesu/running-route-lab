import test from "node:test";
import assert from "node:assert/strict";
import {
  recommend,
  routeFacilities,
  resolveMode,
  coloredSegments,
  segmentColor,
  heightRange,
  type Route,
} from "../src/domain.ts";
const fixture = (
  id: string,
  score: number,
  range: number | null,
  signals: number,
  unknown = 0,
): Route => ({
  id,
  length: 5000,
  kind: "순환형",
  points: [
    [36, 129],
    [36.001, 129],
    [36, 129],
  ],
  segments: [{ length: 111 }, { length: 111 }],
  comparison: { recommendationScore: score, error: 0 },
  evidence: {
    bonus: score,
    elevation: {
      state: range === null ? "partial" : "estimated",
      coverage: range === null ? 0.5 : 1,
      range,
      profile: [
        { at: 0, elevation: 0 },
        { at: 111, elevation: 10 },
        { at: 222, elevation: 0 },
      ],
    },
  },
  signals,
  unknownCrossings: unknown,
  crossings: [
    ...Array.from({ length: signals }, (_, i) => ({
      at: i,
      p: [36, 129] as [number, number],
      signal: true,
      unknown: false,
    })),
    ...Array.from({ length: unknown }, (_, i) => ({
      at: 100 + i,
      p: [36, 129] as [number, number],
      signal: false,
      unknown: true,
    })),
  ],
  shops: 0,
});
test("selects separate global winners including candidates outside the top three", () => {
  const routes = [
    fixture("best", 100, 40, 4),
    fixture("second", 95, 39, 4),
    fixture("third", 90, 38, 4),
    fixture("flat", 80, 5, 3),
    fixture("flow", 70, 30, 1),
  ];
  assert.deepEqual(
    recommend(routes).cards.map((c) => [c.route.id, c.reasons]),
    [
      ["best", ["best"]],
      ["flat", ["elevation"]],
      ["flow", ["signals"]],
    ],
  );
});
test("merges two criteria, preserving order", () =>
  assert.deepEqual(
    recommend([fixture("a", 100, 5, 3), fixture("b", 90, 20, 1)]).cards.map(
      (c) => c.reasons,
    ),
    [["best", "elevation"], ["signals"]],
  ));
test("merges all three criteria without inventing alternatives", () =>
  assert.deepEqual(
    recommend([fixture("a", 100, 5, 0), fixture("b", 90, 20, 1)]).cards.map(
      (c) => c.reasons,
    ),
    [["best", "elevation", "signals"]],
  ));
test("unsignalized crossings do not penalize flow", () => {
  const a = fixture("a", 90, 10, 1);
  a.crossings.push(
    ...Array.from({ length: 40 }, () => ({
      at: 50,
      p: [36, 129] as [number, number],
      signal: false,
      unknown: false,
    })),
  );
  const b = fixture("b", 100, 5, 2);
  assert.equal(
    recommend([a, b]).cards.find((c) => c.reasons.includes("signals"))?.route
      .id,
    "a",
  );
});
test("two traversals of one signal count twice", () => {
  const two = fixture("twice", 100, 10, 2);
  const one = fixture("once", 90, 20, 1);
  assert.equal(
    recommend([two, one]).cards.find((c) => c.reasons.includes("signals"))
      ?.route.id,
    "once",
  );
});
test("unknown signals never become zero; partial elevation cannot win flatness", () => {
  const missing = fixture("missing", 100, null, 0, 2),
    complete = fixture("complete", 90, 30, 3);
  assert.deepEqual(
    recommend([missing, complete]).cards.map((c) => [c.route.id, c.reasons]),
    [
      ["missing", ["best"]],
      ["complete", ["elevation", "signals"]],
    ],
  );
});
test("withholds criteria with no eligible candidates", () => {
  const result = recommend([fixture("a", 100, null, 0, 1)]);
  assert.deepEqual(result.pending, ["elevation", "signals"]);
  assert.deepEqual(result.cards[0].reasons, ["best"]);
});
test("zero altitude range is a valid value", () =>
  assert.equal(
    recommend([
      fixture("zero", 80, 0, 4),
      fixture("hill", 100, 10, 2),
    ]).cards.find((c) => c.reasons.includes("elevation"))?.route.id,
    "zero",
  ));
test("ties use score, distance error, then stable ID, independent of input order", () => {
  const a = fixture("a", 100, 10, 2),
    b = fixture("b", 100, 10, 2);
  a.comparison!.error = 0.1;
  assert.equal(recommend([a, b]).cards[0].route.id, "b");
  a.comparison!.error = 0;
  assert.equal(recommend([b, a]).cards[0].route.id, "a");
});
test("uses the established adjusted total score, not raw evidence bonus", () => {
  const a = fixture("a", 80, 10, 2);
  a.evidence.bonus = 120;
  const b = fixture("b", 95, 20, 3);
  assert.equal(recommend([a, b]).cards[0].route.id, "b");
});
test("recommendation does not mutate candidates", () => {
  const routes = [fixture("b", 90, 5, 2), fixture("a", 100, 10, 3)];
  const before = JSON.stringify(routes);
  recommend(routes);
  assert.equal(JSON.stringify(routes), before);
});
test("empty candidate list stays empty", () =>
  assert.deepEqual(recommend([]).cards, []));
test("signed grade uses hue for direction and intensity for magnitude", () => {
  assert.equal(segmentColor("B", 0, -3, [0, 20]), "#899297");
  assert.equal(segmentColor("B", 0, 3, [0, 20]), "#899297");
  const rgb = (grade: number) =>
    segmentColor("B", 0, grade, [0, 20]).match(/\d+/g)!.map(Number);
  const up = rgb(6),
    down = rgb(-6),
    steep = rgb(12);
  assert(up[0] > up[2]);
  assert(down[2] > down[0]);
  assert(steep[1] < up[1]);
  assert.equal(segmentColor("A", null, 0, [0, 20]), "#8d929b");
  assert.equal(
    segmentColor("B", 0, 6, [0, 20]),
    segmentColor("C", 0, 6, [0, 20]),
  );
});
test("height range is shared, keeps zero, and handles a flat course", () => {
  const a = fixture("a", 1, 0, 0);
  a.evidence.elevation.profile = [
    { at: 0, elevation: 0 },
    { at: 100, elevation: 0 },
  ];
  assert.deepEqual(heightRange([a]), [0, 10]);
});
test("opposite outback traversals have opposite signs and separate display offsets", () => {
  const r = fixture("a", 1, 10, 0),
    s = coloredSegments(r, "B", [0, 20]);
  assert.equal(s.length, 2);
  assert(s[0].grade! > 0 && s[1].grade! < 0);
  assert(s.every((x) => x.offset));
  assert.notEqual(s[0].color, s[1].color);
});
test("bridge geometry stays unknown even with elevation samples", () => {
  const r = fixture("a", 1, 10, 0);
  r.segments![0].bridge = true;
  assert(coloredSegments(r, "A", [0, 20])[0].unknown);
});
test("null profile interval cannot acquire a fake slope", () => {
  const r = fixture("a", 1, null, 0);
  r.evidence.elevation.profile[1].elevation = null;
  assert(coloredSegments(r, "B", [0, 20]).every((x) => x.unknown));
});

test("incomplete profiles cannot win flatness even if metadata still says estimated", () => {
  const a = fixture("partial", 100, 1, 0);
  a.evidence.elevation.profile[1].elevation = null;
  assert.equal(
    recommend([a, fixture("complete", 90, 10, 1)]).cards.find((c) =>
      c.reasons.includes("elevation"),
    )?.route.id,
    "complete",
  );
});
test("common elevation scale supports a large candidate pool", () => {
  const a = fixture("large", 100, 10, 0);
  a.evidence.elevation.profile = Array.from({ length: 160000 }, (_, i) => ({
    at: i,
    elevation: i % 91,
  }));
  assert.deepEqual(heightRange([a]), [0, 90]);
});

test("fixed URLs select height or combined signed grade, with legacy C alias", () => {
  assert.equal(resolveMode(null), "B");
  assert.equal(resolveMode("A"), "A");
  assert.equal(resolveMode("B"), "B");
  assert.equal(resolveMode("C"), "B");
});
test("water and shop layers use separate deduplicated registered facilities", () => {
  const r = fixture("facilities", 1, 10, 0);
  r.facilities = [
    { id: "w", p: [36, 129], type: "water" },
    { id: "w", p: [36, 129], type: "water" },
    { id: "s", p: [36, 129], type: "shop" },
    { id: "missing", type: "water" },
  ];
  assert.equal(routeFacilities(r, "water").length, 1);
  assert.equal(routeFacilities(r, "shop").length, 1);
  assert.deepEqual(routeFacilities(fixture("empty", 1, 10, 0), "water"), []);
});
