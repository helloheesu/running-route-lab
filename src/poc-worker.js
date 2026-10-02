import {
  buildGraph,
  generateRoutes,
  snapStart,
  EXPLORATION_STRATEGIES,
  mergeExploration,
} from "./engine/routing.js";
import { adaptLiveRoutes } from "./live-adapter.js";
let graph,
  generation = 0;
self.onmessage = async ({ data }) => {
  const { ticket, type } = data;
  try {
    if (type === "init") {
      generation++;
      graph = buildGraph(data.raw, data.bbox, data.terrain);
      self.postMessage({ type: "ready", ticket });
      return;
    }
    if (type === "cancel") {
      generation++;
      return;
    }
    if (!graph) throw Error("지도를 준비하고 있어요.");
    if (type === "check") {
      const snap = snapStart(graph, data.point);
      self.postMessage({
        type: "checked",
        ticket,
        snap: { point: snap.point, offset: snap.offset },
      });
      return;
    }
    if (type === "generate") {
      const run = ++generation,
        batches = [];
      for (let variant = 0; variant < 2; variant++)
        for (const strategy of EXPLORATION_STRATEGIES) {
          if (run !== generation) return;
          batches.push({
            ...generateRoutes(graph, {
              ...data.options,
              profile: strategy,
              variant,
              collect: true,
            }),
            strategy,
            variant,
          });
          self.postMessage({
            type: "progress",
            ticket,
            completed: batches.length,
            total: 10,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      if (run !== generation) return;
      const result = mergeExploration(batches, data.options);
      result.routes = adaptLiveRoutes(result.routes, graph);
      self.postMessage({ type: "result", ticket, result });
    }
  } catch (error) {
    self.postMessage({
      type: type === "init" ? "init-error" : type === "check" ? "check-error" : "error",
      ticket,
      message: error.message,
    });
  }
};
