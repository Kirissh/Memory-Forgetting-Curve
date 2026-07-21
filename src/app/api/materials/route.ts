import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/api";
import {
  createMaterialFromPdf,
  createMaterialFromText,
  createMaterialFromUrl,
} from "@/lib/pipeline";

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

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const title = String(form.get("title") || "");
      if (!(file instanceof File)) return jsonError("PDF file required");
      const buffer = Buffer.from(await file.arrayBuffer());
      const material = await createMaterialFromPdf(
        user.id,
        title,
        buffer,
        file.name
      );
      return jsonOk({ material }, { status: 201 });
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
      return jsonError("Paste at least ~40 characters, or provide a link");
    }

    const sourceType =
      body.sourceType === "transcript" ? "transcript" : "text";
    const material = await createMaterialFromText(
      user.id,
      title || (sourceType === "transcript" ? "Video transcript" : "Pasted notes"),
      text,
      { sourceType }
    );
    return jsonOk({ material }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Upload failed", 500);
  }
}
