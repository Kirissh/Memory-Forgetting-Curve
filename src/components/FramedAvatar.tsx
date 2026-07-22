"use client";

import { useEffect, useRef } from "react";
import type { Frame } from "@/lib/frames";

type DrawOpts = {
  frame: Frame | null;
  initial: string;
  baseColor: string;
  size: number;
  angle: number;
  /** When loaded, drawn cover-fit inside the disc instead of the initial. */
  image?: HTMLImageElement | null;
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
  { frame, initial, baseColor, size, angle, image }: DrawOpts
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

  const hasImage = !!image && image.naturalWidth > 0;

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, discR, 0, Math.PI * 2);
  ctx.clip();
  if (hasImage) {
    // Cover-fit the uploaded photo into the circular disc.
    const iw = image!.naturalWidth;
    const ih = image!.naturalHeight;
    const scale = Math.max((discR * 2) / iw, (discR * 2) / ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.drawImage(image!, c - w / 2, c - h / 2, w, h);
  } else {
    // Fallback: coloured disc + initial.
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
    ctx.fillRect(c - discR, c - discR, discR * 2, discR * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${Math.round(discR * 0.95)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = S * 0.03;
    ctx.fillText(
      (initial || "?").toUpperCase().slice(0, 1),
      c,
      c + discR * 0.06
    );
  }
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
  imageSrc,
  className,
}: {
  frame: Frame | null;
  initial: string;
  size?: number;
  spin?: boolean;
  baseColor?: string;
  imageSrc?: string | null;
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
    let cancelled = false;
    let image: HTMLImageElement | null = null;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animate = spin && frame?.animated && !reduceMotion;
    const start = performance.now();

    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const angle = animate
        ? -Math.PI / 2 + ((now - start) / 4000) * Math.PI * 2
        : -Math.PI / 2;
      drawFramedAvatar(ctx, { frame, initial, baseColor: color, size, angle, image });
    };
    // Exactly one animation loop (it reads `image`, so the photo appears when it
    // loads); non-animated frames draw once and redraw only on image load.
    const loop = (now: number) => {
      if (cancelled) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    };

    if (imageSrc) {
      const im = new Image();
      im.onload = () => {
        if (cancelled) return;
        image = im;
        if (!animate) draw(performance.now());
      };
      im.onerror = () => !cancelled && !animate && draw(performance.now());
      im.src = imageSrc;
    }

    if (animate) loop(start);
    else draw(start);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [frame, initial, size, spin, baseColor, imageSrc]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className={className}
      aria-label={frame ? `${frame.name} frame` : "avatar"}
    />
  );
}

/**
 * Read a picked image file, cover-crop it to a `size`px square, and return a
 * compressed JPEG data URL small enough to store on the user record.
 */
export async function fileToAvatarDataUrl(
  file: File,
  size = 256
): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode failed"));
    i.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  const scale = Math.max(
    size / img.naturalWidth,
    size / img.naturalHeight
  );
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}
