import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";
import {
  createMaterialFromAudio,
  createMaterialFromFlashcards,
  createMaterialFromPdf,
  createMaterialFromText,
  createMaterialFromUrl,
} from "@/lib/pipeline";
import {
  extractDocxText,
  extractPptxText,
  parseFlashcards,
} from "@/lib/documents";
import type { MaterialSourceType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

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

/** No NUL bytes in the first 1KB → safe to treat as UTF-8 text. */
function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 1024);
  for (const b of sample) if (b === 0) return false;
  return true;
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
      const name = (file.name || "").toLowerCase();
      const stem = (file.name || "file").replace(/\.[^.]+$/, "");

      // Flashcard import (CSV / TSV / JSON of front→back) — no LLM, instantly ready.
      if (kind === "flashcards" || /\.(csv|tsv|json)$/.test(name)) {
        const pairs = parseFlashcards(buffer.toString("utf8"));
        if (pairs.length === 0) {
          return jsonError(
            "No flashcards found. Use CSV/TSV (front,back per line) or JSON [{front, back}]."
          );
        }
        const material = await createMaterialFromFlashcards(user.id, title, pairs);
        return jsonOk({ material }, { status: 201 });
      }

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

      if (kind === "pptx" || name.endsWith(".pptx")) {
        const text = await extractPptxText(buffer);
        if (text.length < 40) {
          return jsonError("Couldn't read enough text from that slide deck.");
        }
        const material = await createMaterialFromText(user.id, title || stem, text, {
          sourceType: "pptx",
        });
        return jsonOk({ material }, { status: 201 });
      }

      if (kind === "docx" || name.endsWith(".docx")) {
        const text = await extractDocxText(buffer);
        if (text.length < 40) {
          return jsonError("Couldn't read enough text from that document.");
        }
        const material = await createMaterialFromText(user.id, title || stem, text, {
          sourceType: "docx",
        });
        return jsonOk({ material }, { status: 201 });
      }

      // Plain-text-ish files (.txt/.md/.rtf) or anything that decodes as text.
      if (
        kind === "text" ||
        /\.(txt|md|markdown|text|rtf|org|tex)$/.test(name) ||
        isProbablyText(buffer)
      ) {
        const text = buffer.toString("utf8").trim();
        if (text.length < 40) {
          return jsonError("That file has too little text to make cards from.");
        }
        const material = await createMaterialFromText(user.id, title || stem, text, {
          sourceType: "text",
        });
        return jsonOk({ material }, { status: 201 });
      }

      return jsonError(
        "Unsupported file. Try PDF, PPTX, DOCX, a flashcard CSV/JSON, a text file, or audio."
      );
    }

    const body = await req.json();
    const title = String(body.title || "").trim();
    const url = String(body.url || "").trim();

    // Pasted flashcards (raw text or an array of pairs).
    if (body.flashcardsText || Array.isArray(body.flashcards)) {
      const pairs = Array.isArray(body.flashcards)
        ? body.flashcards
            .map((o: Record<string, unknown>) => ({
              front: String(o.front ?? o.question ?? o.term ?? "").trim(),
              back: String(o.back ?? o.answer ?? o.definition ?? "").trim(),
            }))
            .filter((p: { front: string; back: string }) => p.front && p.back)
        : parseFlashcards(String(body.flashcardsText || ""));
      if (pairs.length === 0) {
        return jsonError(
          "No flashcards found. Use one 'front, back' per line, or JSON pairs."
        );
      }
      const material = await createMaterialFromFlashcards(user.id, title, pairs);
      return jsonOk({ material }, { status: 201 });
    }

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
