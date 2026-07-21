import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";
import {
  createMaterialFromAudio,
  createMaterialFromPdf,
  createMaterialFromText,
  createMaterialFromUrl,
} from "@/lib/pipeline";
import type { MaterialSourceType } from "@/lib/types";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const db = await readDb();
  const materials = db.materials
    .filter((m) => m.userId === user.id)
    .map((m) => ({
      ...m,
      cardCount: db.cards.filter((c) => c.materialId === m.id).length,
      conceptCount: db.concepts.filter((c) => c.materialId === m.id).length,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  return jsonOk({ materials });
}

function looksLikeAudio(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("audio/") ||
    /\.(wav|mp3|m4a|webm|ogg|mpeg|mp4)$/i.test(name)
  );
}

function looksLikePdf(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const title = String(form.get("title") || "");
      const kind = String(form.get("kind") || "");
      if (!(file instanceof File)) return jsonError("File required");

      const buffer = Buffer.from(await file.arrayBuffer());

      if (kind === "audio" || looksLikeAudio(file)) {
        const material = await createMaterialFromAudio(
          user.id,
          title,
          buffer,
          file.name || "lecture.wav"
        );
        return jsonOk({ material }, { status: 201 });
      }

      if (kind === "pdf" || looksLikePdf(file)) {
        const material = await createMaterialFromPdf(
          user.id,
          title,
          buffer,
          file.name
        );
        return jsonOk({ material }, { status: 201 });
      }

      return jsonError("Unsupported file type — use PDF or audio");
    }

    const body = await req.json();
    const title = String(body.title || "").trim();
    const url = String(body.url || "").trim();

    if (url) {
      const material = await createMaterialFromUrl(user.id, title, url);
      return jsonOk({ material }, { status: 201 });
    }

    const text = String(body.text || "").trim();
    if (text.length < 40) {
      return jsonError("Paste at least ~40 characters, or provide a link / file");
    }

    const allowed: MaterialSourceType[] = [
      "text",
      "transcript",
      "audio",
      "image",
    ];
    const sourceType: MaterialSourceType = allowed.includes(body.sourceType)
      ? body.sourceType
      : "text";

    const material = await createMaterialFromText(
      user.id,
      title,
      text,
      { sourceType }
    );
    return jsonOk({ material }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Upload failed", 500);
  }
}
