/**
 * ChartDrawingLayer — the drawing/annotation overlay for the chart.
 *
 * An absolutely-positioned SVG that exactly overlays the lightweight-charts drawing area
 * (a sibling inside the chart's `relative` container). Drawings are anchored in DATA coords
 * ({time, price}) and re-projected to pixels every render via the chart's coordinate APIs
 * (timeScale().logicalToCoordinate + series.priceToCoordinate), so they track pan/zoom/resize.
 *
 * pointer-events strategy (so chart pan/zoom keeps working):
 *   • SELECT mode → SVG root `pointer-events:none` (empty clicks fall through to the chart);
 *     each drawing element sets `pointer-events:stroke|auto` so it stays selectable/draggable.
 *   • A DRAW tool armed → SVG root `pointer-events:auto` to capture the draw gesture.
 * Active gestures use window listeners created PER gesture (capturing the current projection),
 * so there are no stale-closure or hook-ordering issues; a handlers ref detaches them.
 *
 * Ported from StratosAI's backtest/ChartDrawingLayer.tsx: TypeScript stripped, theme tokens
 * repointed to --opt-*, persistence swapped to localStorage (per-instrument), SVG pinned to
 * inset-0 (the options chart fills its container, no inset-2 padding). Net-new tools added:
 * brush (freehand), magnet (OHLC snap), lock, hide, zoom. DISPLAY-ONLY.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MousePointer2,
  TrendingUp,
  Minus,
  Pause,
  MoveUpRight,
  Square,
  AlignJustify,
  Type as TypeIcon,
  Ruler,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  Eraser,
  PencilRuler,
  X as XIcon,
  Brush,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Plus,
} from "lucide-react";
import {
  timeToLogical,
  logicalToTime,
  logicalToX,
  shiftTimeByBars,
  makeDrawingId,
  makePositionDrawing,
  positionBars,
  positionStats,
  isPositionType,
  FIB_LEVELS,
} from "../chart/chartDrawings";
import { loadDrawings, saveDrawings } from "../chart/chartDrawingsStore";

const DRAW_COLORS = ["#00f0ff", "#ffd166", "#ff4060", "#00ffb3", "#a78bfa", "#ffffff"];

export function ChartDrawingLayer({
  getChart,
  getSeries,
  times,
  instrumentKey,
  redrawTick,
  onZoom,
  snapPrice,
  compact = false,
  toolbarSlot,
}) {
  const svgRef = useRef(null);
  const [drawings, setDrawings] = useState([]);
  const [tool, setTool] = useState("select");
  // Compact mode: the toolbar is hidden behind a single trigger button.
  const [toolsOpen, setToolsOpen] = useState(false);
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Net-new toggles: magnet (snap to OHLC), locked (drawings inert), hidden (drawings not rendered).
  const [magnet, setMagnet] = useState(false);
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const draftRef = useRef(null);
  const gestureRef = useRef(null);
  const handlersRef = useRef({});
  const idSeq = useRef(0);

  // magnet snap helpers — when magnet is ON and the host supplied `snapPrice`, snap an anchor's
  // price to the nearest OHLC of the bar at that time. No-op otherwise. Captured fresh per gesture.
  const snapPt = (pt) => (magnet && snapPrice && pt ? { ...pt, price: snapPrice(pt.time, pt.price) } : pt);
  const snapAt = (time, price) => (magnet && snapPrice ? snapPrice(time, price) : price);

  // ── load saved drawings on open / instrument change ──
  useEffect(() => {
    if (!instrumentKey) {
      setDrawings([]);
      return;
    }
    let cancelled = false;
    loadDrawings(instrumentKey).then((d) => {
      if (!cancelled) setDrawings(Array.isArray(d) ? d : []);
    });
    return () => {
      cancelled = true;
    };
  }, [instrumentKey]);

  // ── debounced save on change ──
  // The pending-timer + latest snapshot live in refs so the unmount effect below can
  // FLUSH a save the debounce cleanup would otherwise silently cancel (an edit made
  // <600ms before unmount was lost). The timer nulls its own ref on fire, so a
  // non-null ref always means "edits not yet persisted".
  const pendingSaveRef = useRef(null);
  const latestSaveRef = useRef(null);
  useEffect(() => {
    if (!instrumentKey) return;
    latestSaveRef.current = { id: instrumentKey, drawings };
    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      void saveDrawings(instrumentKey, drawings);
    }, 600);
    return () => {
      if (pendingSaveRef.current != null) clearTimeout(pendingSaveRef.current);
    };
  }, [drawings, instrumentKey]);
  useEffect(
    () => () => {
      if (pendingSaveRef.current != null && latestSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        pendingSaveRef.current = null;
        void saveDrawings(latestSaveRef.current.id, latestSaveRef.current.drawings);
      }
    },
    [],
  );

  // ── keep the SVG pixel size in sync (for full-width/height lines) ──
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
  }, [redrawTick]);

  // ── projection (data coords ↔ chart pixels) ──
  const project = useCallback(
    (pt) => {
      const chart = getChart();
      const series = getSeries();
      if (!chart || !series) return null;
      try {
        // logicalToX interpolates x between the two bracketing INTEGER bars — LWC's
        // logicalToCoordinate only maps integer bar indices and returns 0 for a fractional logical,
        // so an anchor that lands between bars (after a move/edit, or inside an overnight/weekend
        // gap) would otherwise collapse to x=0 (the chart's left edge). See chart/chartDrawings.js.
        const x = logicalToX(chart.timeScale(), timeToLogical(times, pt.time));
        const y = series.priceToCoordinate(pt.price);
        return x == null || y == null ? null : { x, y };
      } catch {
        return null;
      }
    },
    [getChart, getSeries, times],
  );
  const unproject = useCallback(
    (x, y) => {
      const chart = getChart();
      const series = getSeries();
      if (!chart || !series) return null;
      try {
        const logical = chart.timeScale().coordinateToLogical(x);
        const price = series.coordinateToPrice(y);
        return logical == null || price == null ? null : { time: logicalToTime(times, logical), price };
      } catch {
        return null;
      }
    },
    [getChart, getSeries, times],
  );

  const localXY = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const detachGesture = useCallback(() => {
    const h = handlersRef.current;
    if (h.move) window.removeEventListener("pointermove", h.move);
    if (h.up) window.removeEventListener("pointerup", h.up);
    handlersRef.current = {};
    gestureRef.current = null;
  }, []);

  // Start a drag/draw: build move+up closures NOW (capturing the current projection) and
  // attach them to the window so the gesture tracks even when the pointer leaves the element.
  const startGesture = (g, initial) => {
    gestureRef.current = g;
    if (initial) {
      draftRef.current = initial;
      setDraft(initial);
    }
    const move = (e) => {
      const cur = gestureRef.current;
      if (!cur) return;
      const { x, y } = localXY(e);
      const pt = unproject(x, y);
      if (!pt) return;
      if (cur.kind === "draw") {
        const prev = draftRef.current;
        if (!prev) return;
        const nd = { ...prev, points: [prev.points[0], snapPt(pt)] };
        draftRef.current = nd;
        setDraft(nd);
      } else if (cur.kind === "brush") {
        // freehand: append the (optionally snapped) cursor point to the running polyline.
        const prev = draftRef.current;
        if (!prev) return;
        const nd = { ...prev, points: [...prev.points, snapPt(pt)] };
        draftRef.current = nd;
        setDraft(nd);
      } else if (cur.kind === "move") {
        // Move along the time axis in LOGICAL (bar-index) space, NOT epoch time. The axis collapses
        // overnight/weekend gaps, so a raw `pt.time - start.time` delta explodes across a day
        // boundary and throws the box to another day instead of tracking the cursor. Shifting every
        // anchor by the same WHOLE-bar count (rounded → candle-snapped) moves the drawing
        // candle-for-candle and never skips a day. Price has no gaps, so shift it directly.
        const dBars = Math.round(
          timeToLogical(times, pt.time) - timeToLogical(times, cur.start.time),
        );
        const dp = pt.price - cur.start.price;
        setDrawings((arr) =>
          arr.map((d) => {
            if (d.id !== cur.id) return d;
            const o = cur.orig;
            const moved = {
              ...d,
              points: o.points.map((p) => ({
                time: shiftTimeByBars(times, p.time, dBars),
                price: p.price + dp,
              })),
            };
            // a position box also carries target/stop PRICES → shift them with the box.
            if (o.target != null) moved.target = o.target + dp;
            if (o.stop != null) moved.stop = o.stop + dp;
            return moved;
          }),
        );
      } else if (cur.kind === "target") {
        setDrawings((arr) =>
          arr.map((d) => (d.id === cur.id ? { ...d, target: snapAt(d.points[0].time, pt.price) } : d)),
        );
      } else if (cur.kind === "stop") {
        setDrawings((arr) =>
          arr.map((d) => (d.id === cur.id ? { ...d, stop: snapAt(d.points[0].time, pt.price) } : d)),
        );
      } else if (cur.kind === "duration") {
        // extend the box along time only (right edge); keep the entry-price baseline.
        setDrawings((arr) =>
          arr.map((d) =>
            d.id === cur.id
              ? { ...d, points: [d.points[0], { time: pt.time, price: d.points[0].price }] }
              : d,
          ),
        );
      } else {
        // "end" — a line endpoint drag.
        setDrawings((arr) =>
          arr.map((d) => {
            if (d.id !== cur.id) return d;
            const pts = [...d.points];
            pts[cur.idx] = snapPt(pt);
            return { ...d, points: pts };
          }),
        );
      }
    };
    const up = () => {
      const cur = gestureRef.current;
      if (cur?.kind === "draw" || cur?.kind === "brush") {
        const fin = draftRef.current;
        if (fin) {
          setDrawings((arr) => [...arr, fin]);
          setSelectedId(fin.id);
        }
        setTool("select");
      }
      draftRef.current = null;
      setDraft(null);
      detachGesture();
    };
    handlersRef.current = { move, up };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // pointer-down on EMPTY svg (draw mode only — root is interactive then).
  const onSvgPointerDown = (e) => {
    if (tool === "select") return; // empty clicks fall through to the chart for pan/zoom
    if (locked) return; // locked → drawings inert, no new gestures
    const { x, y } = localXY(e);
    const raw = unproject(x, y);
    if (!raw) return;
    const pt = snapPt(raw);
    const id = makeDrawingId(tool, idSeq.current++);
    if (isPositionType(tool)) {
      // CLICK-to-place: the clicked candle sets the ENTRY; a default target/stop/duration box
      // appears, selected, so its handles are immediately draggable (no draw-drag — shape via
      // the handles). REUSES the same data-coord model + selection/drag/persistence.
      const box = makePositionDrawing({ id, type: tool, entry: pt, color, times });
      setDrawings((arr) => [...arr, box]);
      setSelectedId(id);
      setTool("select");
      e.preventDefault();
      return;
    }
    if (tool === "text") {
      // Click-to-place a text label; a prompt captures the content (double-click a label to edit).
      const content = window.prompt("Text label:");
      if (content && content.trim()) {
        setDrawings((arr) => [...arr, { id, type: "text", color, points: [pt], text: content.trim(), width: 2 }]);
        setSelectedId(id);
      }
      setTool("select");
      e.preventDefault();
      return;
    }
    if (tool === "brush") {
      // freehand: begin capturing; points accumulate on pointermove, finalise on pointerup.
      startGesture({ kind: "brush" }, { id, type: "brush", color, points: [pt], width: 2 });
      e.preventDefault();
      return;
    }
    startGesture({ kind: "draw" }, { id, type: tool, color, points: [pt, pt], width: 2 });
    e.preventDefault();
  };

  const selectAndMove = (e, d) => {
    if (locked) return;
    e.stopPropagation();
    setSelectedId(d.id);
    const { x, y } = localXY(e);
    const pt = unproject(x, y);
    if (pt) startGesture({ kind: "move", id: d.id, orig: d, start: pt });
  };
  const dragEnd = (e, d, idx) => {
    if (locked) return;
    e.stopPropagation();
    setSelectedId(d.id);
    startGesture({ kind: "end", id: d.id, idx });
  };
  // position-box handle drags (target/stop price; duration = right-edge time).
  const dragField = (e, d, kind) => {
    if (locked) return;
    e.stopPropagation();
    setSelectedId(d.id);
    startGesture({ kind, id: d.id });
  };

  const deleteSelected = useCallback(() => {
    setSelectedId((sel) => {
      if (sel) setDrawings((arr) => arr.filter((d) => d.id !== sel));
      return null;
    });
  }, []);
  const clearAll = () => {
    setDrawings([]);
    setSelectedId(null);
  };

  // Delete/Backspace removes the selection; cleanup any dangling listeners on unmount.
  useEffect(() => {
    const onKey = (e) => {
      // Window-level listener: don't hijack Delete/Backspace (and preventDefault the
      // keystroke) while the user is typing in a form field or editable region.
      if (e.target.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, deleteSelected]);
  useEffect(() => detachGesture, [detachGesture]);

  // ── render one drawing as SVG ──
  const renderDrawing = (d, isDraft) => {
    const sel = selectedId === d.id;
    const linePE = isDraft ? "none" : "stroke";
    const onDown = isDraft ? undefined : (e) => selectAndMove(e, d);
    const a = d.points[0] ? project(d.points[0]) : null;
    const b = d.points[1] ? project(d.points[1]) : null;
    const lineProps = {
      stroke: d.color,
      strokeWidth: (d.width ?? 2) + (sel ? 1 : 0),
      strokeDasharray: isDraft ? "5 4" : undefined,
      style: { pointerEvents: linePE, cursor: "move" },
      onPointerDown: onDown,
    };
    const handle = (p, i) =>
      sel && p ? (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={5}
          fill="#03050b"
          stroke={d.color}
          strokeWidth={1.5}
          style={{ pointerEvents: "auto", cursor: "pointer" }}
          onPointerDown={(e) => dragEnd(e, d, i)}
        />
      ) : null;

    if (d.type === "horizontal") {
      if (!a) return null;
      return (
        <g key={d.id}>
          <line {...lineProps} x1={0} y1={a.y} x2={size.w} y2={a.y} />
          {handle({ x: Math.min(size.w - 8, 44), y: a.y }, 0)}
        </g>
      );
    }
    if (d.type === "vertical") {
      if (!a) return null;
      return (
        <g key={d.id}>
          <line {...lineProps} x1={a.x} y1={0} x2={a.x} y2={size.h} />
          {handle({ x: a.x, y: Math.min(size.h - 8, 44) }, 0)}
        </g>
      );
    }
    if (d.type === "text") {
      if (!a) return null;
      return (
        <g key={d.id}>
          <text
            x={a.x}
            y={a.y}
            fill={d.color}
            fontSize={13}
            fontWeight={600}
            fontFamily="Inter, ui-sans-serif, sans-serif"
            style={{ pointerEvents: isDraft ? "none" : "auto", cursor: "move", userSelect: "none" }}
            onPointerDown={onDown}
            onDoubleClick={
              isDraft
                ? undefined
                : () => {
                    const t = window.prompt("Edit text:", d.text ?? "");
                    if (t != null) setDrawings((arr) => arr.map((x) => (x.id === d.id ? { ...x, text: t } : x)));
                  }
            }
          >
            {d.text ?? ""}
          </text>
          {sel ? handle({ x: a.x - 6, y: a.y + 3 }, 0) : null}
        </g>
      );
    }
    if (d.type === "brush") {
      // freehand polyline through all N anchors; selectable by its stroke, moved as a whole.
      const pts = d.points.map((p) => project(p)).filter(Boolean);
      if (pts.length === 0) return null;
      const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <g key={d.id}>
          <polyline
            points={ptsStr}
            fill="none"
            stroke={d.color}
            strokeWidth={(d.width ?? 2) + (sel ? 1 : 0)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={isDraft ? "5 4" : undefined}
            style={{ pointerEvents: linePE, cursor: "move" }}
            onPointerDown={onDown}
          />
        </g>
      );
    }
    if (!a || !b) return null;
    if (d.type === "rectangle") {
      return (
        <g key={d.id}>
          <rect
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
            fill={`${d.color}1f`}
            stroke={d.color}
            strokeWidth={(d.width ?? 2) + (sel ? 1 : 0)}
            strokeDasharray={isDraft ? "5 4" : undefined}
            style={{ pointerEvents: isDraft ? "none" : "auto", cursor: "move" }}
            onPointerDown={onDown}
          />
          {handle(a, 0)}
          {handle(b, 1)}
        </g>
      );
    }
    if (d.type === "fib") {
      const p0 = d.points[0].price;
      const p1 = d.points[1].price;
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      return (
        <g key={d.id}>
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={d.color}
            strokeWidth={1}
            strokeOpacity={0.35}
            strokeDasharray={isDraft ? "5 4" : undefined}
            style={{ pointerEvents: isDraft ? "none" : "stroke", cursor: "move" }}
            onPointerDown={onDown}
          />
          {FIB_LEVELS.map((lvl) => {
            const price = p0 + (p1 - p0) * lvl;
            const yp = project({ time: d.points[0].time, price });
            if (!yp) return null;
            return (
              <g key={lvl} style={{ pointerEvents: "none" }}>
                <line x1={x1} y1={yp.y} x2={x2} y2={yp.y} stroke={d.color} strokeWidth={sel ? 1.4 : 1} strokeOpacity={0.7} />
                <text x={x1 + 4} y={yp.y - 3} fill={d.color} fontSize={9.5} fontFamily="JetBrains Mono, monospace">
                  {(lvl * 100).toFixed(1)}% · {price.toFixed(1)}
                </text>
              </g>
            );
          })}
          {handle(a, 0)}
          {handle(b, 1)}
        </g>
      );
    }
    if (d.type === "ruler") {
      const dp = d.points[1].price - d.points[0].price;
      const pct = d.points[0].price !== 0 ? (dp / d.points[0].price) * 100 : 0;
      const bars = positionBars(times, d.points[0].time, d.points[1].time);
      const up = dp >= 0;
      const col = up ? "#00ffb3" : "#ff4060";
      const rx = Math.min(a.x, b.x);
      const ry = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x);
      const rh = Math.abs(b.y - a.y);
      const cx = rx + rw / 2;
      const labelY = up ? Math.max(a.y, b.y) + 8 : Math.min(a.y, b.y) - 42;
      return (
        <g key={d.id}>
          <rect
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill={`${col}14`}
            stroke={col}
            strokeWidth={1}
            strokeDasharray="4 3"
            style={{ pointerEvents: isDraft ? "none" : "auto", cursor: "move" }}
            onPointerDown={onDown}
          />
          <g style={{ pointerEvents: "none" }}>
            <rect x={cx - 60} y={labelY} width={120} height={34} rx={4} fill="rgba(3,5,11,0.88)" stroke={col} strokeWidth={1} />
            <text x={cx} y={labelY + 15} textAnchor="middle" fill={col} fontSize={10.5} fontWeight={600} fontFamily="JetBrains Mono, monospace">
              {up ? "+" : ""}
              {dp.toFixed(1)} ({up ? "+" : ""}
              {pct.toFixed(2)}%)
            </text>
            <text x={cx} y={labelY + 28} textAnchor="middle" fill="rgba(238,242,255,0.75)" fontSize={9.5} fontFamily="JetBrains Mono, monospace">
              {bars} bar{bars === 1 ? "" : "s"}
            </text>
          </g>
          {handle(a, 0)}
          {handle(b, 1)}
        </g>
      );
    }
    let bx = b.x;
    let by = b.y;
    if (d.type === "ray") {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const far = (Math.max(size.w, size.h) || 2000) * 2;
      bx = a.x + (dx / len) * far;
      by = a.y + (dy / len) * far;
    }
    return (
      <g key={d.id}>
        <line {...lineProps} x1={a.x} y1={a.y} x2={bx} y2={by} />
        {handle(a, 0)}
        {handle(b, 1)}
      </g>
    );
  };

  // ── render a long/short POSITION box (green profit + red risk zones, handles, live readout) ──
  const renderPosition = (d, isDraft) => {
    const sel = selectedId === d.id;
    const entry = d.points[0];
    const right = d.points[1] ?? d.points[0];
    if (!entry) return null;
    const eP = project(entry);
    const rP = project(right);
    const tgt = d.target ?? entry.price;
    const stp = d.stop ?? entry.price;
    const tP = project({ time: entry.time, price: tgt });
    const sP = project({ time: entry.time, price: stp });
    if (!eP || !rP || !tP || !sP) return null;
    const x1 = Math.min(eP.x, rP.x);
    const x2 = Math.max(eP.x, rP.x);
    const w = Math.max(2, x2 - x1);
    const bars = Math.round(positionBars(times, entry.time, right.time));
    const stats = positionStats({
      direction: d.type === "short" ? "short" : "long",
      entryPrice: entry.price,
      targetPrice: tgt,
      stopPrice: stp,
      bars,
    });
    const bodyPE = isDraft ? "none" : "auto";
    const onBody = isDraft ? undefined : (e) => selectAndMove(e, d);
    const G = "0,255,179";
    const R = "255,64,96";
    const labelW = 96;
    const lx = Math.min(x2 + 8, Math.max(0, size.w - labelW - 2));
    const ly = Math.max(4, Math.min(tP.y, eP.y) - 2);
    return (
      <g key={d.id}>
        {/* profit zone (green): entry ↔ target */}
        <rect
          x={x1}
          y={Math.min(eP.y, tP.y)}
          width={w}
          height={Math.abs(tP.y - eP.y)}
          fill={`rgba(${G},0.15)`}
          stroke={`rgba(${G},0.55)`}
          strokeWidth={1}
          style={{ pointerEvents: bodyPE, cursor: "move" }}
          onPointerDown={onBody}
        />
        {/* risk zone (red): entry ↔ stop */}
        <rect
          x={x1}
          y={Math.min(eP.y, sP.y)}
          width={w}
          height={Math.abs(sP.y - eP.y)}
          fill={`rgba(${R},0.15)`}
          stroke={`rgba(${R},0.55)`}
          strokeWidth={1}
          style={{ pointerEvents: bodyPE, cursor: "move" }}
          onPointerDown={onBody}
        />
        {/* entry line */}
        <line
          x1={x1}
          y1={eP.y}
          x2={x2}
          y2={eP.y}
          stroke="#eef2ff"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          style={{ pointerEvents: bodyPE, cursor: "move" }}
          onPointerDown={onBody}
        />
        {/* drag handles (when selected): target (price), stop (price), duration (time) */}
        {sel && !isDraft ? (
          <>
            <circle cx={x2} cy={tP.y} r={5} fill="#03050b" stroke={`rgba(${G},1)`} strokeWidth={1.5}
              style={{ pointerEvents: "auto", cursor: "ns-resize" }} onPointerDown={(e) => dragField(e, d, "target")} />
            <circle cx={x2} cy={sP.y} r={5} fill="#03050b" stroke={`rgba(${R},1)`} strokeWidth={1.5}
              style={{ pointerEvents: "auto", cursor: "ns-resize" }} onPointerDown={(e) => dragField(e, d, "stop")} />
            <rect x={x2 - 4} y={eP.y - 7} width={8} height={14} rx={2} fill="#03050b" stroke="#eef2ff" strokeWidth={1.5}
              style={{ pointerEvents: "auto", cursor: "ew-resize" }} onPointerDown={(e) => dragField(e, d, "duration")} />
          </>
        ) : null}
        {/* live readout — %, R:R, duration */}
        <g style={{ pointerEvents: "none" }}>
          <rect x={lx} y={ly} width={labelW} height={52} rx={4} fill="rgba(3,5,11,0.82)" stroke="rgba(255,255,255,0.12)" />
          <text x={lx + 6} y={ly + 14} fontSize={10} fontFamily="JetBrains Mono, monospace" fill={`rgba(${G},1)`}>
            {`${d.type.toUpperCase()}  +${stats.rewardPct.toFixed(1)}%`}
          </text>
          <text x={lx + 6} y={ly + 26} fontSize={10} fontFamily="JetBrains Mono, monospace" fill={`rgba(${R},1)`}>
            {`stop  −${stats.riskPct.toFixed(1)}%`}
          </text>
          <text x={lx + 6} y={ly + 38} fontSize={10} fontFamily="JetBrains Mono, monospace" fill="#eef2ff">
            {`R:R  ${stats.rr != null ? stats.rr.toFixed(2) : "—"} : 1`}
          </text>
          <text x={lx + 6} y={ly + 49} fontSize={9.5} fontFamily="JetBrains Mono, monospace" fill="rgba(238,242,255,0.7)">
            {`${bars} candle${bars === 1 ? "" : "s"}`}
          </text>
        </g>
      </g>
    );
  };

  const toolBtn = (t, Icon, title) => (
    <button
      type="button"
      title={title}
      onClick={() => {
        setTool(t);
        if (t !== "select") setSelectedId(null);
        setToolsOpen(false); // compact mode: close the dropdown so the chart is clear to draw on
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
      style={{
        background: tool === t ? "rgba(99,102,241,0.16)" : "var(--opt-panel2)",
        color: tool === t ? "var(--opt-accent)" : "var(--opt-text)",
        border: `1px solid ${tool === t ? "var(--opt-accent)" : "var(--opt-edge)"}`,
      }}
    >
      <Icon size={15} />
    </button>
  );

  // Net-new toggle / action button (magnet, lock, hide, zoom) — same footprint as toolBtn but
  // driven by an `active` boolean rather than the armed tool.
  const auxBtn = (active, onClick, Icon, title, opts = {}) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
      style={{
        background: active ? "rgba(99,102,241,0.16)" : "var(--opt-panel2)",
        color: opts.color ?? (active ? "var(--opt-accent)" : "var(--opt-text)"),
        border: `1px solid ${active ? "var(--opt-accent)" : "var(--opt-edge)"}`,
      }}
    >
      <Icon size={15} />
    </button>
  );

  const rootPE = tool === "select" || locked || hidden ? "none" : "auto";

  const panelStyle = {
    background: "var(--opt-panel)",
    border: "1px solid var(--opt-edge)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
  };
  const sep = (k) => <div key={k} className="my-0.5 h-px w-full" style={{ background: "var(--opt-edge)" }} />;
  // Toolbar contents — shown inline (default) or inside the compact dropdown popover.
  const toolbarInner = (
    <>
      {toolBtn("select", MousePointer2, "Select / move (Esc)")}
      {toolBtn("trendline", TrendingUp, "Trend line")}
      {toolBtn("horizontal", Minus, "Horizontal line (price)")}
      {toolBtn("vertical", Pause, "Vertical line (time)")}
      {toolBtn("ray", MoveUpRight, "Ray (extended line)")}
      {toolBtn("rectangle", Square, "Rectangle")}
      {toolBtn("fib", AlignJustify, "Fibonacci retracement")}
      {toolBtn("ruler", Ruler, "Measure — price / % / bars")}
      {toolBtn("text", TypeIcon, "Text label")}
      {toolBtn("brush", Brush, "Brush (freehand)")}
      {sep("s0")}
      {toolBtn("long", ArrowUpRight, "Long position tool (click a candle, then drag the handles)")}
      {toolBtn("short", ArrowDownRight, "Short position tool (click a candle, then drag the handles)")}
      {sep("s1")}
      <div className="flex flex-wrap gap-1" style={{ width: 28 }}>
        {DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Colour ${c}`}
            onClick={() => {
              setColor(c);
              if (selectedId)
                setDrawings((arr) => arr.map((d) => (d.id === selectedId ? { ...d, color: c } : d)));
            }}
            className="h-3 w-3 rounded-full"
            style={{ background: c, outline: color === c ? "1.5px solid var(--opt-text)" : "none", outlineOffset: 1 }}
          />
        ))}
      </div>
      {sep("s2")}
      {/* magnet (snap to OHLC), lock (drawings inert), hide (drawings not rendered) */}
      {auxBtn(magnet, () => setMagnet((v) => !v), Magnet, "Magnet — snap to OHLC")}
      {auxBtn(locked, () => setLocked((v) => !v), locked ? Lock : Unlock, "Lock all drawings")}
      {auxBtn(hidden, () => setHidden((v) => !v), hidden ? EyeOff : Eye, "Hide drawings")}
      {sep("s3")}
      {/* zoom the chart (host wires onZoom to the visible-range zoom) */}
      {auxBtn(false, () => onZoom?.(0.8), Plus, "Zoom in")}
      {auxBtn(false, () => onZoom?.(1.25), Minus, "Zoom out")}
      {sep("s4")}
      <button
        type="button"
        title="Delete selected (Del)"
        onClick={deleteSelected}
        disabled={!selectedId}
        className="flex h-7 w-7 items-center justify-center rounded-md"
        style={{
          background: "var(--opt-panel2)",
          color: selectedId ? "#ff4060" : "var(--opt-faint)",
          border: "1px solid var(--opt-edge)",
        }}
      >
        <Trash2 size={15} />
      </button>
      <button
        type="button"
        title="Clear all drawings"
        onClick={clearAll}
        className="flex h-7 w-7 items-center justify-center rounded-md"
        style={{
          background: "var(--opt-panel2)",
          color: "var(--opt-text)",
          border: "1px solid var(--opt-edge)",
        }}
      >
        <Eraser size={15} />
      </button>
    </>
  );

  // Horizontal variant — portaled into a slot ABOVE the chart (out of the candles). Same buttons +
  // handlers as the vertical strip; vertical separators + an inline colour row. (Dormant here —
  // the options host renders the default vertical strip; kept for parity with the source.)
  const hsep = (k) => (
    <div key={k} className="mx-0.5 h-6 w-px shrink-0" style={{ background: "var(--opt-edge)" }} />
  );
  const horizontalToolbar = (
    <div className="flex items-center gap-1">
      {toolBtn("select", MousePointer2, "Select / move (Esc)")}
      {toolBtn("trendline", TrendingUp, "Trend line")}
      {toolBtn("horizontal", Minus, "Horizontal line (price)")}
      {toolBtn("vertical", Pause, "Vertical line (time)")}
      {toolBtn("ray", MoveUpRight, "Ray (extended line)")}
      {toolBtn("rectangle", Square, "Rectangle")}
      {toolBtn("fib", AlignJustify, "Fibonacci retracement")}
      {toolBtn("ruler", Ruler, "Measure — price / % / bars")}
      {toolBtn("text", TypeIcon, "Text label")}
      {toolBtn("brush", Brush, "Brush (freehand)")}
      {hsep("s1")}
      {toolBtn("long", ArrowUpRight, "Long position tool")}
      {toolBtn("short", ArrowDownRight, "Short position tool")}
      {hsep("s2")}
      <div className="flex items-center gap-1">
        {DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Colour ${c}`}
            onClick={() => {
              setColor(c);
              if (selectedId) setDrawings((arr) => arr.map((d) => (d.id === selectedId ? { ...d, color: c } : d)));
            }}
            className="h-3.5 w-3.5 shrink-0 rounded-full"
            style={{ background: c, outline: color === c ? "1.5px solid var(--opt-text)" : "none", outlineOffset: 1 }}
          />
        ))}
      </div>
      {hsep("s3")}
      {auxBtn(magnet, () => setMagnet((v) => !v), Magnet, "Magnet — snap to OHLC")}
      {auxBtn(locked, () => setLocked((v) => !v), locked ? Lock : Unlock, "Lock all drawings")}
      {auxBtn(hidden, () => setHidden((v) => !v), hidden ? EyeOff : Eye, "Hide drawings")}
      {hsep("s4")}
      {auxBtn(false, () => onZoom?.(0.8), Plus, "Zoom in")}
      {auxBtn(false, () => onZoom?.(1.25), Minus, "Zoom out")}
      {hsep("s5")}
      <button
        type="button"
        title="Delete selected (Del)"
        onClick={deleteSelected}
        disabled={!selectedId}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{
          background: "var(--opt-panel2)",
          color: selectedId ? "#ff4060" : "var(--opt-faint)",
          border: "1px solid var(--opt-edge)",
        }}
      >
        <Trash2 size={15} />
      </button>
      <button
        type="button"
        title="Clear all drawings"
        onClick={clearAll}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{
          background: "var(--opt-panel2)",
          color: "var(--opt-text)",
          border: "1px solid var(--opt-edge)",
        }}
      >
        <Eraser size={15} />
      </button>
    </div>
  );

  return (
    <>
      {toolbarSlot ? (
        createPortal(horizontalToolbar, toolbarSlot)
      ) : compact ? (
        // >2 charts: a single trigger button opens the toolbar as a dropdown so the vertical
        // strip doesn't crowd/overlap a small chart. Picking a tool closes it (see toolBtn).
        <div className="absolute left-2 top-2 z-30 flex items-start gap-1">
          <button
            type="button"
            title="Drawing tools"
            onClick={() => setToolsOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background: toolsOpen || tool !== "select" ? "rgba(99,102,241,0.16)" : "var(--opt-panel)",
              border: `1px solid ${
                toolsOpen || tool !== "select" ? "var(--opt-accent)" : "var(--opt-edge)"
              }`,
              color: toolsOpen || tool !== "select" ? "var(--opt-accent)" : "var(--opt-text)",
              backdropFilter: "blur(6px)",
            }}
          >
            {toolsOpen ? <XIcon size={15} /> : <PencilRuler size={15} />}
          </button>
          {toolsOpen ? (
            // Wrap into a compact block (fixed width) rather than a tall vertical strip, so it
            // fits inside a short multi-chart slot instead of being clipped at the slot's bottom.
            <div className="flex flex-wrap items-center gap-1 rounded-lg p-1.5" style={{ ...panelStyle, width: 208 }}>
              {toolbarInner}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="absolute left-2 top-2 z-30 flex max-h-[calc(100%-1rem)] flex-col gap-1 overflow-y-auto rounded-lg p-1"
          style={panelStyle}
        >
          {toolbarInner}
        </div>
      )}

      <svg
        ref={svgRef}
        className="absolute inset-0 z-20"
        style={{
          overflow: "hidden",
          pointerEvents: rootPE,
          cursor: tool === "select" ? "default" : "crosshair",
        }}
        width="100%"
        height="100%"
        onPointerDown={onSvgPointerDown}
      >
        {!hidden && drawings.map((d) => (isPositionType(d.type) ? renderPosition(d, false) : renderDrawing(d, false)))}
        {!hidden && draft ? (isPositionType(draft.type) ? renderPosition(draft, true) : renderDrawing(draft, true)) : null}
      </svg>
    </>
  );
}
