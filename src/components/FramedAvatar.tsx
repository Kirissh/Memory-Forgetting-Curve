"use client";

import { useEffect, useRef } from "react";
import type { Frame } from "@/lib/frames";

type DrawOpts = {
  frame: Frame | null;
  initial: string;
  baseColor: string;
  size: number;
  angle: number;
};

function ring(ctx: CanvasRenderingContext2D, c: number, r: number) {
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
}

function addStops(
  g: CanvasGradient,
  stops: string[]
): CanvasGradient {
  stops.forEach((s, i) =>
    g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), s)
  );
  return g;
}

/** Paint a framed avatar into a 2D context. Shared by the live canvas and export. */
export function drawFramedAvatar(
  ctx: CanvasRenderingContext2D,
  { frame, initial, baseColor, size, angle }: DrawOpts
) {
  const S = size;
  const c = S / 2;
  ctx.clearRect(0, 0, S, S);

  const ringWidth = S * 0.11;
  const outerR = c - ringWidth / 2 - S * 0.04;
  const discR = outerR - ringWidth * 0.72;

  if (frame) {
    ctx.save();
    if (frame.glow) {
      ctx.shadowColor = frame.glow;
      ctx.shadowBlur = S * 0.14;
    }
    ctx.lineWidth = ringWidth;

    if (frame.style === "solid") {
      ctx.strokeStyle = frame.stops[0];
      ring(ctx, c, outerR);
    } else if (frame.style === "linear") {
      ctx.strokeStyle = addStops(
        ctx.createLinearGradient(0, 0, S, S),
        frame.stops
      );
      ring(ctx, c, outerR);
    } else if (frame.style === "conic") {
      const supportsConic =
        typeof ctx.createConicGradient === "function";
      ctx.strokeStyle = supportsConic
        ? addStops(ctx.createConicGradient(angle, c, c), frame.stops)
        : addStops(ctx.createLinearGradient(0, 0, S, S), frame.stops);
      ring(ctx, c, outerR);
    } else if (frame.style === "double") {
      ctx.lineWidth = ringWidth * 0.5;
      ctx.strokeStyle = frame.stops[0];
      ring(ctx, c, outerR);
      ctx.strokeStyle = frame.stops[1] ?? frame.stops[0];
      ring(ctx, c, outerR - ringWidth * 0.7);
    }
    ctx.restore();
  }

  // Avatar disc with a soft top-left highlight.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, discR, 0, Math.PI * 2);
  const dg = ctx.createRadialGradient(
    c - discR * 0.3,
    c - discR * 0.3,
    discR * 0.1,
    c,
    c,
    discR
  );
  dg.addColorStop(0, "rgba(255,255,255,0.4)");
  dg.addColorStop(0.4, baseColor);
  dg.addColorStop(1, baseColor);
  ctx.fillStyle = dg;
  ctx.fill();
  ctx.restore();

  // Initial.
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(discR * 0.95)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = S * 0.03;
  ctx.fillText((initial || "?").toUpperCase().slice(0, 1), c, c + discR * 0.06);
  ctx.restore();
}

/** Resolve the app accent colour for the bare avatar disc. */
export function accentColor(): string {
  if (typeof window === "undefined") return "#7c5cff";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return v || "#7c5cff";
}

export function FramedAvatar({
  frame,
  initial,
  size = 96,
  spin = false,
  baseColor,
  className,
}: {
  frame: Frame | null;
  initial: string;
  size?: number;
  spin?: boolean;
  baseColor?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const color = baseColor || accentColor();

    let raf = 0;
    const animate = spin && frame?.animated;
    const start = performance.now();

    const render = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const angle = animate
        ? -Math.PI / 2 + ((now - start) / 4000) * Math.PI * 2
        : -Math.PI / 2;
      drawFramedAvatar(ctx, { frame, initial, baseColor: color, size, angle });
      if (animate) raf = requestAnimationFrame(render);
    };
    render(start);

    return () => cancelAnimationFrame(raf);
  }, [frame, initial, size, spin, baseColor]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className={className}
      aria-label={frame ? `${frame.name} frame` : "avatar"}
    />
  );
}

/** Render at high resolution and trigger a PNG download. */
export async function downloadFramedAvatar(
  frame: Frame | null,
  initial: string,
  baseColor?: string
) {
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawFramedAvatar(ctx, {
    frame,
    initial,
    baseColor: baseColor || accentColor(),
    size: S,
    angle: -Math.PI / 2,
  });
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/png")
  );
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `brain-frame-${frame?.id ?? "bare"}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
