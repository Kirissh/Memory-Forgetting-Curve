import { promises as fs } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { updateDb } from "./db";
import { chunkText, embed } from "./embeddings";
import { buildCloze } from "./probes";
import { generateFlashcards } from "./llm";
import { extractPdfText } from "./pdf";
import { extractYouTubeTranscript, isYouTubeUrl } from "./youtube";
import { extractWebPage } from "./web";
import { transcribeWav } from "./audio";
import type { Chunk, Material, MaterialSourceType } from "./types";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export interface TextMaterialOptions {
  sourceType?: MaterialSourceType;
  sourceUrl?: string | null;
}

export async function createMaterialFromText(
  userId: string,
  title: string,
  text: string,
  options: TextMaterialOptions = {}
): Promise<Material> {
  const materialId = uuid();
  const sourceType = options.sourceType || "text";
  const material: Material = {
    id: materialId,
    userId,
    title: title || defaultTitle(sourceType),
    status: "processing",
    sourceType,
    sourceUrl: options.sourceUrl || null,
    storagePath: null,
    createdAt: new Date().toISOString(),
  };

  await updateDb((db) => {
    db.materials.push(material);
  });

  // Process inline (free-stack: no workers)
  processMaterial(materialId, text).catch(async (err) => {
    console.error("processMaterial failed", err);
    await updateDb((db) => {
      const m = db.materials.find((x) => x.id === materialId);
      if (m) {
        m.status = "error";
        m.errorMessage = err instanceof Error ? err.message : "Processing failed";
      }
    });
  });

  return material;
}

function defaultTitle(sourceType: MaterialSourceType): string {
  switch (sourceType) {
    case "transcript":
      return "Video transcript";
    case "youtube":
      return "YouTube video";
    case "url":
      return "Web page";
    case "audio":
      return "Audio lecture";
    case "image":
      return "Image notes";
    default:
      return "Pasted notes";
  }
}

/**
 * Resolve a YouTube or article URL to text, then enqueue the same card pipeline.
 */
export async function createMaterialFromUrl(
  userId: string,
  title: string,
  rawUrl: string
): Promise<Material> {
  if (isYouTubeUrl(rawUrl)) {
    const extracted = await extractYouTubeTranscript(rawUrl);
    return createMaterialFromText(
      userId,
      title || extracted.title,
      extracted.text,
      { sourceType: "youtube", sourceUrl: extracted.sourceUrl }
    );
  }

  const extracted = await extractWebPage(rawUrl);
  return createMaterialFromText(
    userId,
    title || extracted.title,
    extracted.text,
    { sourceType: "url", sourceUrl: extracted.sourceUrl }
  );
}

export async function createMaterialFromPdf(
  userId: string,
  title: string,
  buffer: Buffer,
  filename: string
): Promise<Material> {
  await ensureUploadDir();
  const materialId = uuid();
  const storagePath = path.join(UPLOAD_DIR, `${materialId}.pdf`);
  await fs.writeFile(storagePath, buffer);

  const material: Material = {
    id: materialId,
    userId,
    title: title || filename.replace(/\.pdf$/i, "") || "Uploaded PDF",
    status: "processing",
    sourceType: "pdf",
    sourceUrl: null,
    storagePath,
    createdAt: new Date().toISOString(),
  };

  await updateDb((db) => {
    db.materials.push(material);
  });

  (async () => {
    try {
      const text = await extractPdfText(buffer);
      if (!text || text.length < 40) {
        throw new Error("Could not extract enough text from this PDF");
      }
      await processMaterial(materialId, text);
    } catch (err) {
      console.error(err);
      await updateDb((db) => {
        const m = db.materials.find((x) => x.id === materialId);
        if (m) {
          m.status = "error";
          m.errorMessage =
            err instanceof Error ? err.message : "PDF processing failed";
        }
      });
    }
  })();

  return material;
}

/**
 * Save a WAV clip, transcribe with local Whisper, then run the usual card pipeline.
 */
export async function createMaterialFromAudio(
  userId: string,
  title: string,
  buffer: Buffer,
  filename: string
): Promise<Material> {
  await ensureUploadDir();
  const materialId = uuid();
  const ext = filename.toLowerCase().endsWith(".wav") ? "wav" : "wav";
  const storagePath = path.join(UPLOAD_DIR, `${materialId}.${ext}`);
  await fs.writeFile(storagePath, buffer);

  const material: Material = {
    id: materialId,
    userId,
    title:
      title ||
      filename.replace(/\.(wav|mp3|m4a|webm|ogg|mpeg)$/i, "") ||
      "Audio lecture",
    status: "processing",
    sourceType: "audio",
    sourceUrl: null,
    storagePath,
    createdAt: new Date().toISOString(),
  };

  await updateDb((db) => {
    db.materials.push(material);
  });

  (async () => {
    try {
      const text = await transcribeWav(buffer);
      await processMaterial(materialId, text);
    } catch (err) {
      console.error(err);
      await updateDb((db) => {
        const m = db.materials.find((x) => x.id === materialId);
        if (m) {
          m.status = "error";
          m.errorMessage =
            err instanceof Error ? err.message : "Audio transcription failed";
        }
      });
    }
  })();

  return material;
}

export async function processMaterial(materialId: string, text: string) {
  const chunks = chunkText(text).slice(0, 8); // keep free LLM budget sane
  if (chunks.length === 0) throw new Error("No text to process");

  const chunkRecords: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embed(chunks[i]);
    chunkRecords.push({
      id: uuid(),
      materialId,
      content: chunks[i],
      chunkIndex: i,
      embedding,
    });
  }

  await updateDb((db) => {
    db.chunks.push(...chunkRecords);
  });

  for (const chunk of chunkRecords) {
    try {
      const cards = await generateFlashcards(chunk.content);
      await updateDb((db) => {
        for (const item of cards) {
          const conceptId = uuid();
          db.concepts.push({
            id: conceptId,
            materialId,
            chunkId: chunk.id,
            title: item.concept.slice(0, 120),
            definition: item.definition,
            recallProbability: 0.5,
            halfLifeDays: 3,
            correctStreak: 0,
            incorrectCount: 0,
            totalReviews: 0,
            avgDaysBetweenReviews: 0,
            lastReviewedAt: null,
            createdAt: new Date().toISOString(),
          });
          const cloze = buildCloze(item.definition);
          db.cards.push({
            id: uuid(),
            conceptId,
            materialId,
            front: item.flashcard_front,
            back: item.flashcard_back,
            clozeText: cloze?.clozeText,
            clozeAnswer: cloze?.clozeAnswer,
            createdAt: new Date().toISOString(),
          });
        }
      });
      // polite rate limit for LLM7 free tier
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      console.warn("chunk generation failed", chunk.id, err);
    }
  }

  await finalizeMaterial(materialId);
}

/** Re-run flashcard generation on existing chunks (e.g. after fixing LLM config). */
export async function regenerateCards(materialId: string) {
  const { readDb } = await import("./db");
  const db = await readDb();
  const chunks = db.chunks
    .filter((c) => c.materialId === materialId)
    .sort((a, b) => a.chunkIndex - b.chunkIndex);

  if (chunks.length === 0) {
    throw new Error("No chunks to regenerate from — re-upload the material");
  }

  await updateDb((db) => {
    db.cards = db.cards.filter((c) => c.materialId !== materialId);
    db.concepts = db.concepts.filter((c) => c.materialId !== materialId);
    const m = db.materials.find((x) => x.id === materialId);
    if (m) {
      m.status = "processing";
      delete m.errorMessage;
    }
  });

  for (const chunk of chunks) {
    try {
      const cards = await generateFlashcards(chunk.content);
      await updateDb((db) => {
        for (const item of cards) {
          const conceptId = uuid();
          db.concepts.push({
            id: conceptId,
            materialId,
            chunkId: chunk.id,
            title: item.concept.slice(0, 120),
            definition: item.definition,
            recallProbability: 0.5,
            halfLifeDays: 3,
            correctStreak: 0,
            incorrectCount: 0,
            totalReviews: 0,
            avgDaysBetweenReviews: 0,
            lastReviewedAt: null,
            createdAt: new Date().toISOString(),
          });
          const cloze = buildCloze(item.definition);
          db.cards.push({
            id: uuid(),
            conceptId,
            materialId,
            front: item.flashcard_front,
            back: item.flashcard_back,
            clozeText: cloze?.clozeText,
            clozeAnswer: cloze?.clozeAnswer,
            createdAt: new Date().toISOString(),
          });
        }
      });
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      console.warn("chunk generation failed", chunk.id, err);
    }
  }

  await finalizeMaterial(materialId);
}

async function finalizeMaterial(materialId: string) {
  await updateDb((db) => {
    const m = db.materials.find((x) => x.id === materialId);
    if (m) {
      const cardCount = db.cards.filter((c) => c.materialId === materialId).length;
      if (cardCount === 0) {
        m.status = "error";
        m.errorMessage =
          "No flashcards generated. Check LLM7_API_KEY / LLM7_MODEL or try different text.";
      } else {
        m.status = "ready";
        delete m.errorMessage;
      }
    }
  });
}
