import { useCallback, useRef, useState, type MouseEvent, type PointerEvent } from "react";

type Box = { x: number; y: number; w: number; h: number };
type Pan = { pointer: number; clientX: number; clientY: number; from: Box; scale: number; panning: boolean };

const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
// how far the pointer goes before a press is a pan and not a click
const PAN_SLOP = 4;

const parse = (viewBox: string): Box => {
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
  return { x, y, w, h };
};

// Zoom and pan over an SVG drawn in `fit`, its whole viewBox: the wheel
// zooms where the pointer is, a drag pans, and the click that ends a drag is
// swallowed so a pan never lands as a click on what is under it. What is
// shown goes back to the whole when `fit` changes.
export function useZoomPan(fit: string) {
  const [zoomed, setZoomed] = useState<{ fit: string; box: Box } | null>(null);
  const box = zoomed && zoomed.fit === fit ? zoomed.box : parse(fit);
  const current = useRef(box);
  current.current = box;
  const pan = useRef<Pan | null>(null);
  const swallow = useRef(false);
  const el = useRef<SVGSVGElement | null>(null);

  const show = useCallback((b: Box) => setZoomed({ fit, box: b }), [fit]);

  const zoom = useCallback((factor: number, at?: { clientX: number; clientY: number }) => {
    const svg = el.current;
    const b = current.current;
    const whole = parse(fit);
    const w = Math.min(whole.w / MIN_ZOOM, Math.max(whole.w / MAX_ZOOM, b.w / factor));
    const k = w / b.w;
    let px = b.x + b.w / 2, py = b.y + b.h / 2;
    const ctm = at && svg?.getScreenCTM();
    if (at && svg && ctm) {
      const p = new DOMPoint(at.clientX, at.clientY).matrixTransform(ctm.inverse());
      px = p.x; py = p.y;
    }
    show({ x: px - (px - b.x) * k, y: py - (py - b.y) * k, w, h: b.h * k });
  }, [fit, show]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onWheel = useRef((e: WheelEvent) => { e.preventDefault(); zoomRef.current(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e); });

  // React's wheel listener is passive, so the page would scroll as well
  const ref = useCallback((svg: SVGSVGElement | null) => {
    el.current?.removeEventListener("wheel", onWheel.current);
    el.current = svg;
    svg?.addEventListener("wheel", onWheel.current, { passive: false });
  }, []);

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    swallow.current = false;
    pan.current = { pointer: e.pointerId, clientX: e.clientX, clientY: e.clientY, from: box, scale: e.currentTarget.getScreenCTM()?.a ?? 1, panning: false };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (!p || p.pointer !== e.pointerId) return;
    const dx = e.clientX - p.clientX, dy = e.clientY - p.clientY;
    if (!p.panning) {
      if (Math.hypot(dx, dy) < PAN_SLOP) return;
      p.panning = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    show({ ...p.from, x: p.from.x - dx / p.scale, y: p.from.y - dy / p.scale });
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (!p || p.pointer !== e.pointerId) return;
    swallow.current = p.panning;
    pan.current = null;
  };
  const onClickCapture = (e: MouseEvent<SVGSVGElement>) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.stopPropagation();
  };

  return {
    svg: {
      ref,
      viewBox: `${box.x} ${box.y} ${box.w} ${box.h}`,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => { pan.current = null; },
      onClickCapture,
    },
    zoomIn: () => zoom(ZOOM_STEP),
    zoomOut: () => zoom(1 / ZOOM_STEP),
    reset: () => setZoomed(null),
    zoomed: zoomed !== null && zoomed.fit === fit,
  };
}
