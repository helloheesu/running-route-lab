import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Footprints,
  Info,
  LocateFixed,
  MapPin,
  Maximize,
  Minus,
  Plus,
  Search,
  Settings2,
  X,
  LoaderCircle,
  Flag,
  Mountain,
  EllipsisVertical,
  Store,
  Droplets,
} from "lucide-react";
import {
  BottomSheet,
  Carousel,
  KeyboardInput,
  MobileScroll,
  useKeyboard,
} from "./mobile";
import PocMap, { type MapCommand } from "./PocMap";
import {
  recommend,
  defaultLayers,
  routeFacilities,
  resolveMode,
  type MapLayers,
  reasonLabels,
  heightRange,
  formatKm,
  type Mode,
  type Point,
  type Route,
  type Reason,
} from "./domain";
import {
  PRESETS,
  placeIndex,
  searchLocal,
  createOnlineSearch,
  parsePhoton,
  mergePlaces,
  locationError,
} from "./engine/places.js";
import { namedRoads, nearbyRoad } from "./engine/guide.js";
import "./prototype.css";
import { createNavigation, type Screen } from "./navigation";
import { contains, loadRegion, ensureSupportedOrigin, hasRegionalData, type Region } from "./region-data";

type Place = {
  name: string;
  point: Point;
  description?: string;
  accuracy?: number;
  outside?: boolean;
};
type Demo = { origin: Point; name: string; target: number; routes: Route[] };
type Scenario = "distinct" | "partial" | "same" | "missing" | "empty";
const params = new URLSearchParams(location.search);
const fixedVariant = /^[ABC]$/.test(params.get("variant") || "")
  ? resolveMode(params.get("variant"))
  : null;
const participant = !!fixedVariant;
const initialCase = params.get("case");
const validCase = !initialCase || initialCase === "postech-5k";
const online = createOnlineSearch();
const modeNames: Record<Mode, string> = {
  A: "높낮이",
  B: "경사와 방향",
  C: "경사와 방향",
};
const scenarios: Record<Scenario, string> = {
  distinct: "서로 다른 3개",
  partial: "추천 2개로 합침",
  same: "한 코스로 합침",
  missing: "정보 부족",
  empty: "후보 없음",
};
function scenarioRoutes(demo: Demo, scenario: Scenario): Route[] {
  const routes = structuredClone(demo.routes);
  if (scenario === "empty") return [];
  if (scenario === "partial" || scenario === "same")
    routes[0].evidence.elevation.range = 5;
  if (scenario === "same")
    ((routes[0].signals = 0), (routes[0].crossings = []));
  if (scenario === "missing")
    for (const r of routes) {
      r.evidence.elevation = {
        ...r.evidence.elevation,
        state: "partial",
        range: null,
        coverage: 0.6,
        profile: r.evidence.elevation.profile.map((p, i) =>
          i > 20 && i < 50 ? { ...p, elevation: null } : p,
        ),
      };
      r.unknownCrossings = 1;
      r.crossings.push({ at: 0, p: r.points[0], signal: false, unknown: true });
    }
  // Rescale the displayed profile when a demonstration's range changes.
  for (const r of routes) {
    const original = demo.routes.find((x) => x.id === r.id)!;
    const old = original.evidence.elevation.range;
    if (
      r.evidence.elevation.range !== null &&
      old &&
      r.evidence.elevation.range !== old
    )
      r.evidence.elevation.profile = r.evidence.elevation.profile.map((p) => ({
        ...p,
        elevation:
          p.elevation === null
            ? null
            : 10 + ((p.elevation - 10) * r.evidence.elevation.range!) / old,
      }));
  }
  return routes;
}
function Legend({ mode, range }: { mode: Mode; range: [number, number] }) {
  return (
    <div
      className={`map-color-legend mode-${mode}`}
      aria-label={mode === "A" ? "고도 색 범례" : "경사와 방향 색 범례"}
    >
      <div className="legend-scale">
        <span>{mode === "A" ? `${range[0]}m` : "내리막"}</span>
        <i className="terrain-ramp" />
        <span>{mode === "A" ? `${range[1]}m` : "오르막"}</span>
      </div>
      <div className="legend-caption">
        <span>
          {mode === "A" ? "진할수록 높은 곳" : "진할수록 가파름 · ±3% 완만"}
        </span>
        <span className="unknown-legend">
          <i />
          미확인
        </span>
      </div>
    </div>
  );
}
export default function Prototype() {
  const [regionalReady, setRegionalReady] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    hasRegionalData(c.signal).then(ready => { if (!c.signal.aborted) setRegionalReady(ready); });
    return () => c.abort();
  }, []);

  const [screen, setScreen] = useState<Screen>(
    initialCase && validCase ? "results" : "start",
  );
  const [dataset, setDataset] = useState<any>(null),
    [demo, setDemo] = useState<Demo | null>(null);
  const regionRef = useRef<Region | null>(null), baseRegion = useRef<Region | null>(null);
  const [resultDataset, setResultDataset] = useState<Region | null>(null);
  const [regionStatus, setRegionStatus] = useState("");
  const regionAbort = useRef<AbortController | null>(null), regionTicket = useRef(0), initTicket = useRef(0);
  const initWaiter = useRef<{ ticket: number; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const distanceRef = useRef(5);
  const [source, setSource] = useState<"demo" | "live">(initialCase && validCase ? "demo" : "live"),
    [scenario, setScenario] = useState<Scenario>("distinct");
  const [routes, setRoutes] = useState<Route[]>([]),
    [selected, setSelected] = useState(0),
    [runVersion, setRunVersion] = useState(0);
  const mode = fixedVariant || "B";
  const [layers, setLayers] = useState<MapLayers>({ ...defaultLayers });
  const [draft, setDraft] = useState<Point>([36.0135, 129.325]),
    [draftName, setDraftName] = useState("POSTECH 주변");
  const [snap, setSnap] = useState<{ point: Point; offset: number } | null>(
      null,
    ),
    [checking, setChecking] = useState(false),
    [snapError, setSnapError] = useState("");
  const [confirmed, setConfirmed] = useState<Place | null>(null),
    [distance, setDistance] = useState("5.0"),
    [resultOrigin, setResultOrigin] = useState<Place | null>(null),
    [target, setTarget] = useState(5000);
  const [query, setQuery] = useState(""),
    [searchResults, setSearchResults] = useState<any[]>([]),
    [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState(
      validCase
        ? ""
        : "해당 예시를 찾지 못했어요. 출발지 선택부터 시작해 주세요.",
    ),
    [progress, setProgress] = useState(0),
    [locating, setLocating] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false),
    [detail, setDetail] = useState<{ title: string; body: string } | null>(
      null,
    ),
    [command, setCommand] = useState<MapCommand>();
  const originEntry = useRef<"start" | "search">("start");
  const navigation = useRef<ReturnType<typeof createNavigation> | null>(null);
  const screenRef = useRef(screen);
  const resultValid = useRef(!!initialCase && validCase);
  const generationActive = useRef(false);
  const navigationChanged = useRef<(next: Screen) => void>(() => {});
  const inputPath = (): Screen[] => ["start", ...(originEntry.current === "search" ? ["search" as const] : []), "refine", "distance"];
  const worker = useRef<Worker | null>(null),
    checkTicket = useRef(0),
    runTicket = useRef(0),
    searchTicket = useRef(0),
    geoTicket = useRef(0);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    searchAbort = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const keyboard = useKeyboard(),
    rail = useRef<HTMLDivElement>(null),
    layerRail = useRef<HTMLDivElement>(null),
    sheetKey = useRef(0);
  const [layerOverflow, setLayerOverflow] = useState({ before: false, after: false });
  distanceRef.current = Math.min(12, Math.max(1, Number(distance) || 5));
  const index = useMemo(() => placeIndex(dataset).map((p: any) => ({ ...p, description: p.description?.replace("포항 · 저장된 지도", "저장된 지도") })), [dataset]),
    roads = useMemo(() => namedRoads(dataset?.raw), [dataset]);
  const recommendations = useMemo(() => recommend(routes), [routes]),
    cards = recommendations.cards;
  const selectedCard = cards[Math.min(selected, Math.max(0, cards.length - 1))],
    route = selectedCard?.route;
  const visibleRoutes = useMemo(() => cards.map((c) => c.route), [cards]);
  const range = useMemo(() => heightRange(routes), [routes]);
  const go = useCallback((next: Screen, newInputs = false) => {
    setNotice("");
    const current = navigation.current?.path || ["start"];
    const path: Screen[] = next === "start" ? ["start"]
      : next === "search" ? ["start", "search"]
      : next === "refine" ? (current.at(-1) === "refine" ? current : [...current, "refine"])
      : next === "distance" ? inputPath()
      : next === "loading" || next === "results" ? [...inputPath(), next]
      : [...inputPath(), "results", "confirm"];
    navigation.current?.navigate(path, screenRef.current === "loading" && next === "results", newInputs);
  }, []);
  function back() {
    setNotice("");
    navigation.current?.back();
  }
  navigationChanged.current = (next) => {
    if ((next === "results" || next === "confirm") && !resultValid.current || next === "loading" && !generationActive.current) {
      navigation.current?.navigate(inputPath());
      return;
    }
    const previous = screenRef.current;
    screenRef.current = next;
    setCommand(undefined);
    keyboard.hide();
    ++searchTicket.current;
    searchAbort.current?.abort();
    setSearching(false);
    ++geoTicket.current;
    setLocating(false);
    ++checkTicket.current;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    if (next !== "refine" && next !== "loading") cancelRegion();
    if (previous === "loading" && next !== "results") invalidate();
    if (next === "refine") {
      if (previous === "distance" && confirmed) {
        setDraftName(confirmed.name);
        checkPoint(confirmed.point);
      } else checkPoint(draft);
    }
    setScreen(next);
  };
  useEffect(() => {
    const initial: Screen[] = initialCase && validCase ? ["start", "refine", "distance", "results"] : ["start"];
    const nav = navigation.current || createNavigation(window.history, initial, (next) => navigationChanged.current(next));
    navigation.current = nav;
    const onPop = (event: PopStateEvent) => nav.pop(event.state);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("popstate", onPop); };
  }, []);
  useEffect(() => {
    mounted.current = true;
    document.title = "다시 여기로 · 러닝 코스 PoC";
    const w = new Worker(new URL("./poc-worker.js", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === "ready" || data.type === "init-error") {
        if (initWaiter.current?.ticket === data.ticket) {
          const waiter = initWaiter.current!; initWaiter.current = null;
          if (data.type === "ready") { waiter.resolve(); }
          else waiter.reject(Error(data.message));
        }
        return;
      }
      if (data.type === "checked" && data.ticket === checkTicket.current) {
        setSnap(data.snap);
        setChecking(false);
        setSnapError("");
      }
      if (data.type === "check-error" && data.ticket === checkTicket.current) {
        setSnap(null);
        setChecking(false);
        setSnapError(data.message);
      }
      if (data.ticket !== runTicket.current) return;
      if (data.type === "progress") setProgress(data.completed / data.total);
      if (data.type === "result") {
        setRoutes(data.result.routes);
        setSelected(0);
        setRunVersion((v) => v + 1);
        generationActive.current = false;
        resultValid.current = true;
        go("results");
        setProgress(1);
      }
      if (data.type === "error") {
        go("distance");
        setNotice(data.message);
      }
    };
    w.onerror = () => {
      initWaiter.current?.reject(Error("지도를 준비하지 못했어요. 새로고침해 주세요."));
      initWaiter.current = null;
      cancelRegion();
      setChecking(false);
      if (generationActive.current) go("distance");
      setNotice("코스 계산을 시작하지 못했어요. 새로고침해 주세요.");
    };
    const controller = new AbortController();
    Promise.all([
      fetch("/map-data/pohang.json", { signal: controller.signal }).then(
        (r) => {
          if (!r.ok) throw Error();
          return r.json();
        },
      ),
      fetch("/map-data/terrain.json", { signal: AbortSignal.timeout(8000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/demo/postech-5k.json", { signal: controller.signal }).then(
        (r) => {
          if (!r.ok) throw Error();
          return r.json();
        },
      ),
    ])
      .then(([map, terrain, d]) => {
        if (controller.signal.aborted) return;
        const data = { ...map, terrain };
        baseRegion.current = data;
        setDataset(data);
        setResultDataset(data);
        setDemo(d);
        activateRegion(data).catch(() => {});
        if (initialCase && validCase) {
          setRoutes(scenarioRoutes(d, "distinct"));
          setResultOrigin({ name: d.name, point: d.origin });
          setConfirmed({ name: d.name, point: d.origin });
          setRunVersion(1);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError" && !controller.signal.aborted)
          setNotice("저장된 지도를 불러오지 못했어요. 새로고침해 주세요.");
      });
    return () => {
      mounted.current = false;
      controller.abort();
      w.terminate();
      worker.current = null;
      cancelRegion();
      initWaiter.current?.reject(new DOMException("Cancelled", "AbortError"));
      initWaiter.current = null;
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (demoTimer.current) clearTimeout(demoTimer.current);
      searchAbort.current?.abort();
    };
  }, []);
  function cancelRegion() {
    ++regionTicket.current;
    regionAbort.current?.abort();
    setRegionStatus("");
  }
  async function activateRegion(data: Region) {
    if (regionRef.current === data && !initWaiter.current) return;
    const ticket = ++initTicket.current;
    initWaiter.current?.reject(new DOMException("Cancelled", "AbortError"));
    regionRef.current = null;
    setDataset(data);
    await new Promise<void>((resolve, reject) => {
      initWaiter.current = { ticket, resolve, reject };
      worker.current?.postMessage({ type: "init", ticket, raw: data.raw, bbox: data.bbox, terrain: data.terrain });
    });
    regionRef.current = data;
  }
  async function prepareRegion(p: Point, km: number) {
    cancelRegion();
    const ticket = regionTicket.current;
    const controller = new AbortController(); regionAbort.current = controller;
    if (!contains(baseRegion.current, p)) await ensureSupportedOrigin(p, controller.signal);
    let data = regionRef.current;
    // Preserve the original bundled 5 km PoC; new/longer routes use a full regional extent.
    const usable = (d: Region | null) => contains(d, p, d === baseRegion.current && km <= 5 ? 0 : km);
    if (!usable(data)) data = usable(baseRegion.current) ? baseRegion.current : await loadRegion(p, km, controller.signal, text => {
      if (ticket === regionTicket.current) setRegionStatus(text);
    });
    controller.signal.throwIfAborted();
    setRegionStatus("출발할 수 있는 길을 준비하고 있어요");
    await activateRegion(data!);
    controller.signal.throwIfAborted();
    if (ticket === regionTicket.current) setRegionStatus("");
    return data!;
  }
  const checkPoint = useCallback((p: Point) => {
    setDraft(p);
    setSnap(null);
    setSnapError("");
    setChecking(true);
    const ticket = ++checkTicket.current;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(async () => {
      try {
        await prepareRegion(p, distanceRef.current);
        if (ticket === checkTicket.current) worker.current?.postMessage({ type: "check", point: p, ticket });
      } catch (e: any) {
        if (ticket === checkTicket.current && e.name !== "AbortError") { setChecking(false); setSnapError(e.message); }
      }
    }, 400);
  }, []);
  function beginRefine(p: Place, back: Screen = "start") {
    if (back === "start" || back === "search") originEntry.current = back;
    setDraft(p.point);
    setDraftName(p.name);
    setSnap(null);
    setSnapError("");
    go("refine");
    checkPoint(p.point);
    mapCommand("center", p.point);
  }
  function moving() {
    cancelRegion();
    ++checkTicket.current;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    setChecking(true);
    setSnap(null);
  }
  function cancelRefine() {
    ++checkTicket.current;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    back();
  }
  function invalidate() {
    resultValid.current = false;
    generationActive.current = false;
    ++runTicket.current;
    worker.current?.postMessage({ type: "cancel" });
    if (demoTimer.current) clearTimeout(demoTimer.current);
    setRoutes([]);
    setSelected(0);
  }
  function updateDistance(value: string) {
    if (value !== distance) {
      invalidate();
      setSource("live");
    }
    setDistance(value);
    setNotice("");
  }
  function confirmOrigin() {
    if (!snap || checking) return;
    setConfirmed({ name: nearbyRoad(snap.point, roads), point: snap.point });
    setSource("live");
    invalidate();
    go("distance", true);
  }
  async function locate() {
    if (!navigator.geolocation) {
      setNotice("현재 위치를 사용할 수 없어요. 장소 검색으로 선택해 주세요.");
      return;
    }
    const id = ++geoTicket.current;
    setLocating(true);
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current || id !== geoTicket.current) return;
        setLocating(false);
        beginRefine(
          {
            name: `현재 위치 · 정확도 ±${Math.round(pos.coords.accuracy)}m`,
            point: [pos.coords.latitude, pos.coords.longitude],
          },
          screen === "refine" ? (navigation.current?.path.at(-2) || "start") : screen,
        );
      },
      (err) => {
        if (mounted.current && id === geoTicket.current) {
          setLocating(false);
          setNotice(locationError(err));
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
    );
  }
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2 || searching) return;
    const id = ++searchTicket.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const local = searchLocal(index, query);
    setSearchResults(local);
    setSearching(true);
    setNotice("");
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await online(query, { signal: controller.signal });
      if (id === searchTicket.current)
        setSearchResults(
          mergePlaces(local, parsePhoton(response, dataset?.bbox)),
        );
    } catch (e: any) {
      if (id === searchTicket.current)
        setNotice(
          "온라인 검색에 연결하지 못했어요. 저장된 검색 결과를 이용해 주세요.",
        );
    } finally {
      clearTimeout(timer);
      if (id === searchTicket.current) setSearching(false);
    }
  }
  async function startGeneration() {
    const km = Number(distance);
    if (
      !Number.isFinite(km) ||
      km < 1 ||
      km > 12 ||
      Math.abs(km * 2 - Math.round(km * 2)) > 0.001
    ) {
      setNotice("1~12km 사이에서 0.5km 단위로 입력해 주세요.");
      return;
    }
    if (!confirmed || !demo) return;
    invalidate();
    const ticket = ++runTicket.current;
    setProgress(0);
    generationActive.current = true;
    go("loading");
    if (source === "demo") {
      setTarget(demo.target);
      setResultOrigin({ name: demo.name, point: demo.origin });
      demoTimer.current = setTimeout(() => {
        if (ticket !== runTicket.current) return;
        setRoutes(scenarioRoutes(demo, scenario));
        setSelected(0);
        setRunVersion((v) => v + 1);
        generationActive.current = false;
        resultValid.current = true;
        go("results");
      }, 450);
    } else {
      setTarget(km * 1000);
      setResultOrigin(confirmed);
      try {
        const data = await prepareRegion(confirmed.point, km);
        if (ticket !== runTicket.current) return;
        setResultDataset(data);
      } catch (e: any) {
        if (ticket === runTicket.current && e.name !== "AbortError") { go("distance"); setNotice(e.message); }
        return;
      }
      worker.current?.postMessage({
        type: "generate",
        ticket,
        options: {
          point: confirmed.point,
          distance: km * 1000,
          avoidSteps: true,
        },
      });
    }
  }
  function chooseCard(i: number, scroll = true) {
    setSelected(i);
    if (scroll) {
      const track = rail.current?.querySelector(".mobile-carousel");
      const card = rail.current?.querySelector<HTMLElement>(
        `[data-card-index="${i}"]`,
      );
      if (track && card)
        track.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2, behavior: "smooth" });
    }
  }
  useEffect(() => {
    const scroller =
      rail.current?.querySelector<HTMLElement>(".mobile-carousel");
    if (!scroller) return;
    const onScroll = () => {
      const elements = [
        ...scroller.querySelectorAll<HTMLElement>("[data-card-index]"),
      ];
      let best = 0,
        min = Infinity;
      elements.forEach((e, i) => {
        const gap = Math.abs(e.offsetLeft + e.offsetWidth / 2 - scroller.clientWidth / 2 - scroller.scrollLeft);
        if (gap < min) {
          min = gap;
          best = i;
        }
      });
      setSelected(best);
    };
    const active = scroller.querySelector<HTMLElement>(
      `[data-card-index="${selected}"]`,
    );
    if (active) scroller.scrollLeft = active.offsetLeft + active.offsetWidth / 2 - scroller.clientWidth / 2;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(() => {
      const current = scroller.querySelector<HTMLElement>(".route-card.selected");
      if (current) scroller.scrollLeft = current.offsetLeft + current.offsetWidth / 2 - scroller.clientWidth / 2;
    });
    resize.observe(scroller);
    return () => {
      resize.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [screen, cards]);
  useEffect(() => {
    const scroller = layerRail.current?.querySelector<HTMLElement>(".mobile-carousel");
    if (!scroller) return;
    const update = () => setLayerOverflow({ before: scroller.scrollLeft > 3, after: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 3 });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); scroller.removeEventListener("scroll", update); };
  }, [screen, route?.id]);
  function revealLayers(direction: number) {
    const scroller = layerRail.current?.querySelector<HTMLElement>(".mobile-carousel");
    scroller?.scrollBy({ left: direction * scroller.clientWidth * 0.65, behavior: "smooth" });
  }
  function mapCommand(kind: MapCommand["kind"], point?: Point) {
    setCommand({ id: ++sheetKey.current, kind, point });
  }
  function showTools() {
    keyboard.hide();
    setToolsOpen(true);
  }
  function applyScenario(s: Scenario) {
    invalidate();
    setScenario(s);
    if (demo) {
      setSource("demo");
      setResultDataset(baseRegion.current);
      setConfirmed({ name: demo.name, point: demo.origin });
      setDistance((demo.target / 1000).toFixed(1));
      resultValid.current = true;
      setRoutes(scenarioRoutes(demo, s));
      setResultOrigin({ name: demo.name, point: demo.origin });
      setTarget(demo.target);
      setSelected(0);
      setRunVersion((v) => v + 1);
      go("results");
    }
    setToolsOpen(false);
  }
  function changeSource(s: "demo" | "live") {
    setSource(s);
    invalidate();
    setToolsOpen(false);
    go(confirmed ? "distance" : "start");
  }
  const resultDataText =
    source === "demo" ? "예시 데이터" : "저장 지도 기준 · 현장 미검증";
  const signalText = route
    ? `${route.signals}회${route.unknownCrossings ? " + 미확인" : ""}`
    : "—";
  const toolbar = (title: string, onBack: () => void) => (
    <header className="poc-toolbar">
      <button className="icon-button" onClick={onBack} aria-label="뒤로">
        <ArrowLeft size={22} />
      </button>
      <span>{title}</span>
      {!participant ? (
        <button
          className="icon-button subtle"
          onClick={showTools}
          aria-label="PoC 설정"
        >
          <Settings2 size={19} />
        </button>
      ) : (
        <span className="toolbar-space" />
      )}
    </header>
  );
  const zoomButtons = (
    <div className="map-actions">
      <button aria-label="지도 확대" onClick={() => mapCommand("in")}>
        <Plus size={19} />
      </button>
      <button aria-label="지도 축소" onClick={() => mapCommand("out")}>
        <Minus size={19} />
      </button>
    </div>
  );
  return (
    <div
      className={`poc-app screen-${screen}`}
      data-screen={screen}
      data-mode={mode}
      data-source={source}
    >
      {screen === "start" && (
        <>
          <header className="poc-toolbar entry-toolbar">
            <span className="wordmark">
              다시, 여기로<span className="wordmark-dot">.</span>
            </span>
            {!participant && (
              <button className="poc-tag" onClick={showTools}>
                PoC <Settings2 size={13} />
              </button>
            )}
          </header>
          <div className="scroll-region">
            <MobileScroll className="entry-scroll">
              <div className="entry-main">
                <h1>어디서 출발할까요?</h1>
                <p className="intro-sub">가볍게 나갔다가, 다시 여기로.</p>
                <button
                  className="search-pill"
                  onClick={() => go("search")}
                  disabled={!demo}
                >
                  <Search size={20} />
                  <span>장소 또는 도로명 검색</span>
                  <ChevronRight size={18} />
                </button>
                <button
                  className="locate-row"
                  onClick={locate}
                  disabled={!demo || locating}
                >
                  {locating ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <LocateFixed size={18} />
                  )}{" "}
                  {locating ? "현재 위치 확인 중" : "현재 위치에서 출발"}
                </button>
                {notice && (
                  <p className="notice" role="alert">
                    {notice}
                  </p>
                )}
                <div className="preset-section">
                  <span className="section-caption">
                    이곳에서 시작해 보세요
                  </span>
                  {PRESETS.map((p: any) => (
                    <button
                      className="place-row"
                      key={p.id}
                      disabled={!demo}
                      onClick={() => beginRefine(p)}
                    >
                      <span className="place-icon">
                        <MapPin size={19} />
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.description}</small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
              </div>
            </MobileScroll>
          </div>
          <footer className="entry-footer">
            {!demo ? (
              <>
                <LoaderCircle size={13} className="spin" /> 포항 지도를 준비하고
                있어요
              </>
            ) : (
              <>
                {regionalReady ? "서울·경기·인천과 경상권에서 시작할 수 있어요" : "포항 샘플 제공 · 다른 지역은 광역 지도 준비가 필요해요"}
              </>
            )}
          </footer>
        </>
      )}
      {screen === "search" && (
        <>
          {toolbar("출발지 찾기", back)}
          <form className="search-form" onSubmit={search}>
            <Search size={20} />
            <KeyboardInput
              autoFocus
              placeholder="장소 또는 도로명"
              aria-label="출발지 검색어"
              value={query}
              onBlur={() => keyboard.hide()}
              onChange={(e) => {
                ++searchTicket.current;
                searchAbort.current?.abort();
                setSearching(false);
                setQuery(e.target.value);
                setSearchResults(searchLocal(index, e.target.value));
                setNotice("");
              }}
            />
            <button
              type="submit"
              disabled={searching || query.trim().length < 2}
            >
              {searching ? <LoaderCircle size={17} className="spin" /> : "검색"}
            </button>
          </form>
          <div className="scroll-region">
            <MobileScroll className="search-scroll">
              <div className="search-list">
                {(query ? searchResults : PRESETS).map((p: any, i) => (
                  <button
                    key={p.id || i}
                    className="place-row"

                    onClick={() => beginRefine(p, "search")}
                  >
                    <Search size={19} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.description}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {query && searchResults.length === 0 && !searching && (
                  <p className="notice">
                    저장된 결과가 없어요. 검색을 눌러 온라인에서도 찾아보세요.
                  </p>
                )}
                {notice && (
                  <p className="notice" role="status">
                    {notice}
                  </p>
                )}
                <p className="fine-print">
                  입력 중에는 저장된 장소를 찾아요. 검색을 누르면 검색어를
                  Photon에 보내요. {regionalReady ? "서울·경기·인천과 경상권의 주변 지도를 준비해요." : "현재는 포항 샘플만 계산할 수 있어요. 다른 지역은 실행 가이드의 광역 지도를 준비해 주세요."}
                </p>
              </div>
            </MobileScroll>
          </div>
        </>
      )}
      {screen === "refine" && (
        <>
          {toolbar("출발 위치 조정", cancelRefine)}
          <div className="refine-map">
            <PocMap
              data={dataset}
              point={draft}
              picking
              snap={snap}
              frameKey="refine"
              command={command}
              onCenter={checkPoint}
              onMoving={moving}
            />
            <span className="map-hint">
              지도를 움직여 출발할 길에 맞춰 주세요
            </span>
            {zoomButtons}
            <button
              className="map-locate"
              onClick={locate}
              disabled={locating}
              aria-label="현재 위치로 지도 이동"
            >
              <LocateFixed size={21} />
            </button>
          </div>
          <div className="refine-footer">
            <div className="pin-caption">
              <MapPin size={20} />
              <div>
                <strong>{draftName}</strong>
                <span>{nearbyRoad(draft, roads)}</span>
              </div>
            </div>
            <p
              className={`snap-state ${snapError ? "error" : ""}`}
              role="status"
            >
              {checking ? (
                <>
                  <LoaderCircle size={13} className="spin" /> {regionStatus || "출발할 수 있는 길을 확인 중이에요"}
                </>
              ) : (
                snapError ||
                (snap
                  ? `파란 점의 길 위로 약 ${Math.round(snap.offset)}m 맞춰 출발해요.`
                  : "지도에서 출발점을 골라 주세요.")
              )}
            </p>
            {snapError && <button className="text-button" onClick={() => checkPoint(draft)}>주변 지도 다시 확인</button>}
            {notice && (
              <p className="notice" role="alert">
                {notice}
              </p>
            )}
            <button
              className="primary-button"
              disabled={!snap || checking}
              onClick={confirmOrigin}
            >
              여기서 출발 <ArrowRight size={18} />
            </button>
          </div>
        </>
      )}
      {screen === "distance" && (
        <>
          {toolbar("달릴 거리", back)}
          <div className="scroll-region">
            <MobileScroll>
              <div className="distance-main">
                <span className="location-label">
                  <MapPin size={15} />
                  {confirmed?.name}
                </span>
                <h1>몇 km 뛸까요?</h1>
                <p className="intro-sub">오늘의 페이스에 맞춰 골라 주세요.</p>
                <div className="distance-input">
                  <button
                    aria-label="거리 0.5km 줄이기"
                    disabled={Number(distance) <= 1}
                    onClick={() =>
                      updateDistance(
                        Math.max(
                          1,
                          (Math.ceil((Number(distance) || 5) * 2) - 1) / 2,
                        ).toFixed(1),
                      )
                    }
                  >
                    <Minus size={22} />
                  </button>
                  <label>
                    <KeyboardInput
                      aria-label="목표 거리 km"
                      inputMode="decimal"
                      value={distance}
                      onBlur={() => keyboard.hide()}
                      onChange={(e) => updateDistance(e.target.value)}
                      maxLength={4}
                    />
                    <span>KM</span>
                  </label>
                  <button
                    aria-label="거리 0.5km 늘리기"
                    disabled={Number(distance) >= 12}
                    onClick={() =>
                      updateDistance(
                        Math.min(
                          12,
                          (Math.floor((Number(distance) || 5) * 2) + 1) / 2,
                        ).toFixed(1),
                      )
                    }
                  >
                    <Plus size={22} />
                  </button>
                </div>
                <div className="distance-shortcuts">
                  {[3, 5, 7, 10].map((n) => (
                    <button
                      key={n}
                      aria-pressed={Number(distance) === n}
                      onClick={() => {
                        keyboard.hide();
                        updateDistance(n.toFixed(1));
                      }}
                    >
                      {n} km
                    </button>
                  ))}
                </div>
                <p className="distance-helper">
                  목표 거리의 ±20% 안에서
                  <br />세 가지 기준으로 코스를 찾아요.
                </p>
                {notice && (
                  <p className="notice" role="alert">
                    {notice}
                  </p>
                )}
              </div>
            </MobileScroll>
          </div>
          <footer className="action-footer">
            <span className="demo-caption">
              {source === "demo"
                ? "지금은 POSTECH 5km 예시를 보여드려요."
                : "입력한 출발지·거리로 저장 지도에서 계산해요."}
            </span>
            <button
              className="primary-button"
              disabled={!demo}
              onClick={startGeneration}
            >
              코스 찾기 <ArrowRight size={18} />
            </button>
          </footer>
        </>
      )}
      {screen === "loading" && (
        <>
          {toolbar("코스 찾기", back)}
          <div className="loading-content">
            <LoaderCircle className="spin" size={35} />
            <h1>돌아올 길을 찾고 있어요</h1>
            <p>최적 코스 · 고저차 · 신호 횡단</p>
            <progress value={source === "demo" ? 0.6 : progress} max="1" />
            <span>
              {source === "demo"
                ? "예시 코스 준비 중"
                : regionStatus || `${Math.round(progress * 100)}% · 전체 후보 비교 중`}
            </span>
          </div>
        </>
      )}
      {screen === "results" && (
        <>
          {toolbar("나의 러닝 코스", () =>
            go(confirmed ? "distance" : "start"),
          )}
          {!demo ? (
            <div className="loading-content">
              <LoaderCircle className="spin" />
              <p>{notice || "코스를 불러오고 있어요"}</p>
            </div>
          ) : !route ? (
            <div className="empty-state">
              <MapPin size={35} />
              <h1>조건에 맞는 코스가 없어요</h1>
              <p>출발지나 거리를 바꿔 다시 찾아보세요.</p>
              <button
                className="primary-button"
                onClick={() => go(confirmed ? "distance" : "start")}
              >
                조건 바꾸기
              </button>
              {!participant && (
                <button className="text-button" onClick={showTools}>
                  다른 예시 보기
                </button>
              )}
            </div>
          ) : (
            <>
              <section className="route-heading" aria-label="선택 코스 정보">
                <div className="route-title-row">
                  <h1>
                    {formatKm(route.length)}
                    <span>KM</span>
                  </h1>
                  <button
                    onClick={() => beginRefine(resultOrigin!, "results")}
                    className="origin-edit"
                  >
                    <MapPin size={14} />
                    <span>{resultOrigin?.name || "POSTECH 주변"}</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </section>
              <div
                className="result-map"
                data-elevation-visible={layers.elevation}
              >
                <div
                  className="floating-layers"
                  ref={layerRail}
                  role="group"
                  aria-label="지도 정보 레이어"
                >
                  <Carousel
                    ariaLabel="지도 정보 토글"
                    contentClassName="layer-chip-track"
                  >
                    {(
                      [
                        {
                          id: "elevation",
                          label: "고저차",
                          value:
                            route.evidence.elevation.range === null
                              ? "미확인"
                              : `${Math.round(route.evidence.elevation.range)}m`,
                          icon: Mountain,
                          description:
                            "최고 고도와 최저 고도의 차이. 지도 고도 색상 표시",
                        },
                        {
                          id: "signals",
                          label: "신호",
                          value: signalText,
                          icon: EllipsisVertical,
                          description: "등록·추정 신호 횡단과 미확인 지점 표시",
                        },
                        {
                          id: "shops",
                          label: "편의점",
                          value: `${routeFacilities(route, "shop").length}개`,
                          icon: Store,
                          description:
                            "경로에서 직선 50m 이내 등록 편의점 표시",
                        },
                        {
                          id: "water",
                          label: "급수대",
                          value: `${routeFacilities(route, "water").length}개`,
                          icon: Droplets,
                          description:
                            "경로에서 직선 50m 이내 등록 급수대 표시. 급수 가능 여부 미확인",
                        },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.id}
                        className="layer-chip"
                        aria-pressed={layers[item.id]}
                        aria-label={`${item.label} ${item.value} 지도 표시`}
                        title={item.description}
                        onClick={() =>
                          setLayers((current) => ({
                            ...current,
                            [item.id]: !current[item.id],
                          }))
                        }
                      >
                        <item.icon size={15} />
                        <span>{item.label}</span>
                        <b>{item.value}</b>
                        <span className="layer-check" aria-hidden="true">
                          {layers[item.id] ? <Check size={11} /> : null}
                        </span>
                      </button>
                    ))}
                  </Carousel>
                  {layerOverflow.before && <button className="layer-more layer-more-before" aria-label="이전 지도 정보 보기" onClick={() => revealLayers(-1)}><ChevronRight size={17} /></button>}
                  {layerOverflow.after && <button className="layer-more layer-more-after" aria-label="급수대 등 다음 지도 정보 보기" onClick={() => revealLayers(1)}><ChevronRight size={17} /></button>}
                </div>
                <PocMap
                  data={resultDataset}
                  point={resultOrigin?.point || draft}
                  route={route}
                  routes={visibleRoutes}
                  mode={mode}
                  layers={layers}
                  range={range}
                  frameKey={`result-${runVersion}`}
                  command={command}
                  onFeature={(title, body) => setDetail({ title, body })}
                />
                <button
                  className="fit-button"
                  aria-label="선택 코스 전체 보기"
                  onClick={() => mapCommand("fit")}
                >
                  <Maximize size={18} />
                </button>
                <span className="data-badge">{resultDataText}</span>
                {layers.water &&
                  routeFacilities(route, "water").length === 0 && (
                    <span className="layer-empty-note" role="status">
                      코스 50m 안에 등록된 급수대가 없어요
                    </span>
                  )}
                {layers.elevation && <Legend mode={mode} range={range} />}
              </div>
              <section className="recommendation-footer">
                <div className="recommendation-caption">
                  <span>
                    {cards.length === 1
                      ? cards[0].reasons.length === 3
                        ? "한 코스가 세 기준을 만족해요"
                        : cards[0].reasons.length === 2
                          ? "한 코스가 두 기준을 만족해요"
                          : "비교 가능한 추천 코스"
                      : `${cards.length}개의 추천 코스`}
                  </span>
                  <span>
                    {selected + 1} / {cards.length}
                  </span>
                </div>
                <div ref={rail} className="recommendation-rail">
                  <Carousel
                    ariaLabel="추천 코스 카드"
                    contentClassName="route-card-track"
                    snapSelector="[data-card-index]"
                  >
                    {cards.map((card, i) => (
                      <article
                        key={card.route.id}
                        className={`route-card ${selected === i ? "selected" : ""}`}
                        data-card-index={i}
                        onClick={() => chooseCard(i)}
                      >
                        <button
                          className="card-select"
                          aria-label={`${reasonLabels[card.reasons[0]]} 선택`}
                          aria-pressed={selected === i}
                          onClick={() => chooseCard(i)}
                        >
                          <span className="card-reasons">
                            {card.reasons.map((reason: Reason, j: number) =>
                              j === 0 ? (
                                <strong key={reason}>
                                  {reasonLabels[reason]}
                                </strong>
                              ) : (
                                <small key={reason}>
                                  <Check size={12} />
                                  {reasonLabels[reason]}
                                </small>
                              ),
                            )}
                          </span>
                          <span className="card-description">
                            {card.reasons[0] === "best"
                              ? "종합점수가 가장 높은 코스"
                              : card.reasons[0] === "elevation"
                                ? `고저차 약 ${Math.round(card.route.evidence.elevation.range!)}m`
                                : `신호 횡단 ${card.route.signals}회 · 대기 가능 지점 기준`}
                          </span>
                          <span className="card-route-kind">
                            {formatKm(card.route.length)}km · {card.route.kind}
                          </span>
                        </button>
                        <button
                          className="start-button"
                          aria-label={`${reasonLabels[card.reasons[0]]} 시작 확인`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(i);
                            go("confirm");
                          }}
                        >
                          <Footprints size={27} />
                          <span>시작</span>
                        </button>
                      </article>
                    ))}
                  </Carousel>
                </div>
                <div className="card-indicators">
                  {cards.map((c, i) => (
                    <button
                      key={c.route.id}
                      aria-label={`${i + 1}번 추천 코스 보기`}
                      aria-current={selected === i}
                      onClick={() => chooseCard(i)}
                    />
                  ))}
                </div>
                <button
                  className="source-note"
                  onClick={() =>
                    setDetail({
                      title:
                        source === "demo"
                          ? "예시 데이터 안내"
                          : "자료와 추천 기준",
                      body:
                        source === "demo"
                          ? `도로 위 경로 모양은 저장 지도에서 가져왔으며 고도·신호·편의점·급수대·점수는 UI 비교용 예시예요. 입력한 출발지와 거리는 이 예시에 반영하지 않아요. 예시 목표 ${target / 1000}km. 고저차 숫자는 최고 고도−최저 고도예요. ${recommendations.pending.length ? "고저차·신호 자료가 부족해 해당 최소 추천을 보류했어요." : ""}`
                          : `OSM 지도${resultDataset?.osmTimestamp ? ` (${resultDataset.osmTimestamp.slice(0, 10)} 기준)` : ""}와 이용 가능한 지형 자료로 ${routes.length}개 후보를 비교했어요. 고저차는 최고 고도−최저 고도이며 지형 추정값이에요. 급수대는 등록 시설이며 실제 급수·음용 가능 여부는 미확인이에요. 코스의 현장 상태는 미검증이에요. 신호 미확인은 없음으로 취급하지 않아요. ${recommendations.pending.map((p) => reasonLabels[p]).join("·")}${recommendations.pending.length ? " 추천은 비교 정보가 부족해 보류했어요." : ""}`,
                    })
                  }
                >
                  <Info size={12} />
                  {recommendations.pending.length
                    ? "일부 추천은 정보 부족으로 보류"
                    : source === "demo"
                      ? "예시 출발지·수치 · 실제 계산 아님"
                      : "발견한 후보 안에서 비교 · 자료 보기"}
                </button>
              </section>
            </>
          )}
        </>
      )}
      {screen === "confirm" && route && (
        <>
          {toolbar("시작 확인", () => go("results"))}
          <div className="scroll-region">
            <MobileScroll>
              <div className="confirm-content">
                <div className="confirm-symbol">
                  <Flag size={32} />
                </div>
                <h1>이 코스로 출발할까요?</h1>
                <p>
                  {selectedCard.reasons.map((r) => reasonLabels[r]).join(" · ")}
                </p>
                <div className="confirmation-summary">
                  <strong>
                    {formatKm(route.length)}
                    <span> km</span>
                  </strong>
                  <span>
                    <MapPin size={15} />
                    {resultOrigin?.name}
                  </span>
                  <span>
                    고저차{" "}
                    {route.evidence.elevation.range === null
                      ? "미확인"
                      : `${Math.round(route.evidence.elevation.range)}m`}{" "}
                    · 신호 {signalText}
                  </span>
                </div>
                <p className="fine-print">
                  {source === "demo"
                    ? "지금은 예시 코스 선택을 확인하는 화면이에요."
                    : "저장 지도에서 선택한 코스를 확인하는 화면이에요."}
                  <br />
                  실제 주행 기록이나 길안내는 시작되지 않아요.
                </p>
                <button
                  className="primary-button"
                  onClick={() => {
                    go("results");
                    setDetail({
                      title: "코스 선택 완료",
                      body: "선택한 코스로 돌아왔어요. 이 PoC는 코스 선택과 시작 확인까지 제공해요.",
                    });
                  }}
                >
                  선택 완료 <Check size={19} />
                </button>
              </div>
            </MobileScroll>
          </div>
        </>
      )}
      <BottomSheet
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        title="PoC 비교 설정"
        description="참가자용 고정 링크에는 이 도구가 나타나지 않아요."
      >
        <div className="tools-content">
          <span className="section-caption">데이터 연결</span>
          <div className="source-switch">
            <button
              className={source === "demo" ? "active" : ""}
              onClick={() => changeSource("demo")}
            >
              예시 데이터
            </button>
            <button
              className={source === "live" ? "active" : ""}
              onClick={() => changeSource("live")}
            >
              저장 지도에서 계산
            </button>
          </div>
          <p className="fine-print">
            실제 계산은 선택한 출발지와 거리를 반영해요. 고도·신호는 저장 자료
            기준이며 현장 검증은 별도예요.
          </p>
          <span className="section-caption">추천 중복 시나리오</span>
          {Object.entries(scenarios).map(([key, label]) => (
            <button
              key={key}
              className="scenario-button"
              onClick={() => applyScenario(key as Scenario)}
            >
              <span>{label}</span>
              {scenario === key ? (
                <Check size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>
          ))}
          <span className="section-caption">같은 코스 · 다른 표현</span>
          <div className="variant-links">
            {(["A", "B"] as Mode[]).map((v) => (
              <a
                key={v}
                href={`?case=postech-5k&variant=${v}`}
                target="_blank"
                rel="noreferrer"
              >
                {modeNames[v]} <ArrowRight size={13} />
              </a>
            ))}
          </div>
        </div>
      </BottomSheet>
      <BottomSheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        title={detail?.title || "코스 정보"}
      >
        <div className="detail-content">
          <p>{detail?.body}</p>
          <button className="primary-button" onClick={() => setDetail(null)}>
            확인
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
