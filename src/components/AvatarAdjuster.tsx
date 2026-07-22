"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { accentColor } from "@/components/FramedAvatar";

const V = 264; // editor size in CSS px (also the crop logical size)
const OUT = 256; // exported square size

/**
 * Pan + zoom an image inside a circular mask, then export the framed square as a
 * JPEG data URL. The circle just previews what shows through the avatar disc — the
 * full square is exported (FramedAvatar clips to the circle at render time).
 */
export function AvatarAdjuster({
  src,
  onSave,
  onCancel,
}: {
  src: string;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Geometry: cover-scale × user zoom, with pan clamped so the square stays filled.
  const placement = useCallback(
    (img: HTMLImageElement, z: number, p: { x: number; y: number }) => {
      const base = Math.max(V / img.naturalWidth, V / img.naturalHeight);
      const s = base * z;
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      let x = V / 2 + p.x - w / 2;
      let y = V / 2 + p.y - h / 2;
      x = Math.min(0, Math.max(V - w, x));
      y = Math.min(0, Math.max(V - h, y));
      return { x, y, w, h };
    },
    []
  );

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setReady(true);
    };
    img.src = src;
  }, [src]);

  // Live preview with the circular mask.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !ready) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = V * dpr;
    canvas.height = V * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { x, y, w, h } = placement(img, zoom, pan);
    ctx.clearRect(0, 0, V, V);
    ctx.drawImage(img, x, y, w, h);

    // Dim everything outside the circle.
    ctx.save();
    ctx.fillStyle = "rgba(5,8,15,0.62)";
    ctx.beginPath();
    ctx.rect(0, 0, V, V);
    ctx.arc(V / 2, V / 2, V / 2 - 2, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.restore();

    ctx.strokeStyle = accentColor();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(V / 2, V / 2, V / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }, [zoom, pan, ready, placement]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = () => {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const k = OUT / V;
    const { x, y, w, h } = placement(img, zoom, pan);
    ctx.drawImage(img, x * k, y * k, w * k, h * k);
    onSave(out.toDataURL("image/jpeg", 0.85));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel w-full max-w-sm p-6 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Position your photo
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Drag to move · slide to zoom
        </p>

        <div className="mt-5 flex justify-center">
          <canvas
            ref={canvasRef}
            style={{
              width: V,
              height: V,
              touchAction: "none",
              cursor: "grab",
            }}
            className="rounded-2xl"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-[var(--muted)]">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost px-5 py-2.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!ready}
            className="btn-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Save photo
          </button>
        </div>
      </div>
    </div>
  );
}
