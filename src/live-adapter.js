// Keep the engine's established scores, geometry, and elevation evidence intact.
// Count crossing passages independently so an immediate return is a second pass.
export function adaptLiveRoutes(routes, graph) {
  const signals = new Map(
    graph.edges.map((e) => [e.physicalId || e.id, e.signal]),
  );
  return routes.map((route) => {
    const crossings = [];
    let group = null,
      at = 0;
    route.segments.forEach((s, i) => {
      if (!s.crossing) group = null;
      else {
        const direction = Math.sign(s.to - s.from),
          prior = group?.directions.get(s.physicalId);
        if (!group || (prior !== undefined && prior !== direction)) {
          group = {
            at,
            p: route.points[i],
            types: new Set(),
            directions: new Map(),
          };
          crossings.push(group);
        }
        group.types.add(signals.get(s.physicalId) || "unknown");
        group.directions.set(s.physicalId, direction);
      }
      at += s.length;
    });
    const passages = crossings.map((c) => ({
      at: c.at,
      p: c.p,
      signal: c.types.has("tagged") || c.types.has("nearby"),
      unknown:
        !c.types.has("tagged") &&
        !c.types.has("nearby") &&
        c.types.has("unknown"),
      inferred: !c.types.has("tagged") && c.types.has("nearby"),
    }));
    return {
      ...route,
      crossings: passages,
      signals: passages.filter((c) => c.signal).length,
      unknownCrossings: passages.filter((c) => c.unknown).length,
      inferredSignals: passages.filter((c) => c.inferred).length,
    };
  });
}
