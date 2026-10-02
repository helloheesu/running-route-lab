import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import osmtogeojson from "osmtogeojson";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowUp,
  Flag,
  MapPin,
  Store,
  Droplets,
  EllipsisVertical,
  CircleHelp,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import {
  coloredSegments,
  routeFacilities,
  defaultLayers,
  type MapLayers,
  type Point,
  type Route,
  type Mode,
} from "./domain";

export type MapCommand = {
  id: number;
  kind: "fit" | "center" | "in" | "out";
  point?: Point;
};
type Props = {
  data: any;
  point: Point;
  picking?: boolean;
  snap?: { point: Point; offset: number } | null;
  route?: Route;
  routes?: Route[];
  mode?: Mode;
  layers?: MapLayers;
  range?: [number, number];
  frameKey: string;
  command?: MapCommand;
  onCenter?: (p: Point) => void;
  onMoving?: () => void;
  onFeature?: (title: string, body: string) => void;
};
const icon = (html: string, className: string, size = 26) =>
  L.divIcon({
    html,
    className,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
export default function PocMap(props: Props) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    latest = useRef(props);
  latest.current = props;
  const geo = useMemo(
    () => (props.data ? osmtogeojson(props.data.raw) : null),
    [props.data],
  );
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      center: props.point,
      zoom: 16,
      zoomControl: false,
      zoomSnap: 0.25,
      preferCanvas: false,
      minZoom: 13,
      maxZoom: 20,
      attributionControl: true,
    });
    map.current = m;
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution(
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    );
    L.control
      .scale({ imperial: false, position: "bottomleft", maxWidth: 65 })
      .addTo(m);
    let resizing = false;
    const move = () => {
      if (!resizing && latest.current.picking) {
        const c = m.getCenter();
        latest.current.onCenter?.([c.lat, c.lng]);
      }
    };
    m.on("movestart", () => {
      if (!resizing && latest.current.picking) latest.current.onMoving?.();
    });
    m.on("moveend", move);
    const ro = new ResizeObserver(() => {
      resizing = true;
      m.invalidateSize({ pan: false });
      resizing = false;
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !geo) return;
    const layer = L.geoJSON(geo as any, {
      interactive: false,
      filter: (f: any) => f.geometry?.type !== "Point",
      style: (f: any) => {
        const t = f?.properties?.tags || f?.properties || {};
        if (t.natural === "water" || t.waterway)
          return {
            color: "#cbd7d8",
            weight: 1,
            fillColor: "#e4ecec",
            fillOpacity: 1,
          };
        if (
          t.leisure === "park" ||
          t.landuse === "forest" ||
          t.natural === "wood"
        )
          return {
            color: "#e8ece3",
            weight: 1,
            fillColor: "#edf0e9",
            fillOpacity: 1,
          };
        if (t.building)
          return {
            color: "#e4e5e2",
            weight: 0.5,
            fillColor: "#edeeeb",
            fillOpacity: 0.65,
          };
        if (t.highway)
          return {
            color: ["primary", "secondary", "tertiary"].includes(t.highway)
              ? "#dce1dc"
              : "#e4e7e1",
            weight: ["primary", "secondary"].includes(t.highway)
              ? 4
              : t.highway === "footway"
                ? 1.4
                : 2,
            opacity: 0.75,
          };
        return {
          color: "#e7e9e4",
          weight: 1,
          fillColor: "#f0f1ed",
          fillOpacity: 0.25,
        };
      },
    }).addTo(m);
    const labels = L.layerGroup().addTo(m);
    const places = (props.data.raw.elements || []).filter(
      (e: any) =>
        e.tags?.name &&
        (e.tags.place ||
          e.tags.leisure === "park" ||
          e.tags.natural === "water" ||
          e.tags.highway === "tertiary" ||
          e.tags.highway === "secondary"),
    );
    const drawLabels = () => {
      labels.clearLayers();
      const used: string[] = [],
        boxes: L.Point[] = [];
      for (const e of places) {
        const p =
          e.type === "node"
            ? [e.lat, e.lon]
            : e.geometry?.[Math.floor(e.geometry.length / 2)]
              ? Object.values({
                  lat: e.geometry[Math.floor(e.geometry.length / 2)].lat,
                  lon: e.geometry[Math.floor(e.geometry.length / 2)].lon,
                })
              : null;
        if (
          !p ||
          used.includes(e.tags.name) ||
          !m.getBounds().contains(p as Point)
        )
          continue;
        const px = m.latLngToContainerPoint(p as Point);
        if (boxes.some((q) => q.distanceTo(px) < 78)) continue;
        const label = document.createElement("span");
        label.textContent = e.tags.name;
        L.marker(p as Point, {
          icon: icon(label.outerHTML, "quiet-map-label", 0),
          interactive: false,
        }).addTo(labels);
        used.push(e.tags.name);
        boxes.push(px);
      }
    };
    m.on("moveend zoomend resize", drawLabels);
    drawLabels();
    return () => {
      m.off("moveend zoomend resize", drawLabels);
      layer.remove();
      labels.remove();
    };
  }, [geo]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (props.routes?.length) {
      m.fitBounds(
        L.latLngBounds(
          props.route?.points || props.routes.flatMap((r) => r.points),
        ),
        {
          paddingTopLeft: [28, 86],
          paddingBottomRight: [28, 80],
          animate: false,
        },
      );
    } else m.setView(props.point, 17, { animate: false });
  }, [props.frameKey]);
  useEffect(() => {
    const m = map.current,
      c = props.command;
    if (!m || !c) return;
    if (c.kind === "center" && c.point)
      m.setView(c.point, 17, { animate: false });
    if (c.kind === "in") m.zoomIn();
    if (c.kind === "out") m.zoomOut();
    if (c.kind === "fit" && props.route)
      m.fitBounds(L.latLngBounds(props.route.points), {
        paddingTopLeft: [28, 86],
        paddingBottomRight: [28, 80],
        animate: false,
      });
  }, [props.command]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const g = L.layerGroup().addTo(m),
      r = props.route;
    if (r) {
      const layers = props.layers || defaultLayers;
      const draw = () => {
        g.clearLayers();
        L.polyline(r.points, {
          color: "#ffffff",
          weight: 9,
          opacity: 0.9,
          interactive: false,
        }).addTo(g);
        if (!layers.elevation)
          L.polyline(r.points, {
            color: "#53626a",
            weight: 5.5,
            interactive: false,
            className: "plain-route",
          }).addTo(g);
        for (const segment of layers.elevation
          ? coloredSegments(r, props.mode || "B", props.range || [0, 80])
          : []) {
          const coords = segment.offset
            ? segment.points.map((p, i, arr) => {
                const current = m.latLngToLayerPoint(p),
                  a = m.latLngToLayerPoint(arr[Math.max(0, i - 1)]),
                  b = m.latLngToLayerPoint(
                    arr[Math.min(arr.length - 1, i + 1)],
                  ),
                  dx = b.x - a.x,
                  dy = b.y - a.y,
                  d = Math.hypot(dx, dy) || 1;
                const q = m.layerPointToLatLng(
                  L.point(current.x - (dy / d) * 3, current.y + (dx / d) * 3),
                );
                return [q.lat, q.lng] as Point;
              })
            : segment.points;
          L.polyline(coords, {
            color: segment.color,
            className: "elevation-segment",
            weight: segment.offset ? 3.5 : 5.5,
            opacity: 1,
            lineCap: "round",
            dashArray: segment.unknown ? "5 6" : undefined,
          })
            .on("click", () =>
              latest.current.onFeature?.(
                "코스 구간",
                segment.unknown
                  ? "이 구간의 고도는 미확인이에요."
                  : `${(segment.at / 1000).toFixed(2)}km 지점 · 고도 ${segment.elevation!.toFixed(0)}m · 경사 ${segment.grade! > 0 ? "+" : ""}${segment.grade!.toFixed(1)}%`,
              ),
            )
            .addTo(g);
        }
        for (const type of ["shop", "water"] as const) {
          if (!(type === "shop" ? layers.shops : layers.water)) continue;
          routeFacilities(r, type).forEach((p) => {
            const label =
              p.name || (type === "shop" ? "등록 편의점" : "등록 급수대");
            L.marker(p.p!, {
              icon: icon(
                renderToStaticMarkup(
                  type === "shop" ? (
                    <Store size={14} />
                  ) : (
                    <Droplets size={14} />
                  ),
                ),
                `facility-icon ${type}-icon`,
                25,
              ),
              title: label,
            })
              .on("click", () =>
                latest.current.onFeature?.(
                  label,
                  p.name?.startsWith("예시")
                    ? "시연용 위치예요. 실제 시설을 뜻하지 않아요."
                    : `경로에서 직선 약 ${Math.round(p.offset || 0)}m 거리의 등록 시설이에요. ${type === "shop" ? "진입 동선과 영업 여부" : "현재 급수·음용 가능 여부"}는 미확인이에요.`,
                ),
              )
              .addTo(g);
          });
        }
        if (layers.signals)
          r.crossings.forEach((c) => {
            if (!c.signal && !c.unknown) return;
            L.marker(c.p, {
              icon: icon(
                renderToStaticMarkup(
                  c.signal ? (
                    <EllipsisVertical size={14} />
                  ) : (
                    <CircleHelp size={14} />
                  ),
                ),
                `signal-icon ${c.signal ? "" : "unverified"}`,
                25,
              ),
              title: c.signal ? "신호 횡단" : "신호 여부 미확인",
            })
              .on("click", () =>
                latest.current.onFeature?.(
                  c.signal ? "신호 횡단" : "신호 여부 미확인",
                  c.signal
                    ? `${(c.at / 1000).toFixed(2)}km 지점의 등록·추정 신호예요. 현재 신호 상태나 대기시간을 뜻하지 않아요.`
                    : "이 횡단의 신호 여부는 미확인이에요.",
                ),
              )
              .addTo(g);
          });
        for (
          let i = 1;
          i < r.points.length;
          i += Math.max(1, Math.floor(r.points.length / 4))
        ) {
          const a = r.points[Math.max(0, i - 1)],
            b = r.points[i],
            angle =
              (Math.atan2(
                (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180),
                b[0] - a[0],
              ) *
                180) /
              Math.PI;
          const html = renderToStaticMarkup(
            <ArrowUp
              size={15}
              strokeWidth={3}
              style={{ transform: `rotate(${angle}deg)` }}
            />,
          );
          L.marker(b, {
            icon: icon(html, "direction-icon", 19),
            interactive: false,
          }).addTo(g);
        }
        L.marker(r.points[0], {
          icon: icon(
            renderToStaticMarkup(<Flag size={17} fill="currentColor" />),
            "origin-icon",
            30,
          ),
          title: "출발 · 도착",
          zIndexOffset: 1000,
        }).addTo(g);
      };
      draw();
      m.on("zoomend", draw);
      return () => {
        m.off("zoomend", draw);
        g.remove();
      };
    }
    if (props.picking && props.snap) {
      L.polyline([props.point, props.snap.point], {
        color: "#2174f7",
        weight: 2,
        dashArray: "3 5",
        interactive: false,
      }).addTo(g);
      L.circleMarker(props.snap.point, {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: "#2174f7",
        fillOpacity: 1,
      }).addTo(g);
    }
    return () => {
      g.remove();
    };
  }, [
    props.route,
    props.layers,
    props.mode,
    props.range,
    props.snap,
    props.picking,
    props.point,
  ]);
  return (
    <div className="poc-map-wrap" data-scroll-drag="ignore">
      <div
        ref={el}
        className="poc-map"
        role="region"
        aria-label={
          props.picking
            ? "출발지 조정 지도. 지도를 움직여 중앙 핀 위치를 고르세요."
            : "선택한 러닝 코스 지도"
        }
      />
      {props.picking && (
        <div className="center-pin" aria-hidden="true">
          <MapPin size={38} fill="#2174f7" color="#fff" strokeWidth={1.8} />
          <span />
        </div>
      )}
    </div>
  );
}
