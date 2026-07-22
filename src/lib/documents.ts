/**
 * Office-document + flashcard-file parsing. PPTX/DOCX are just zipped XML, so we
 * read the run text directly with JSZip — no native deps, works offline.
 */
import JSZip from "jszip";

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

async function zipRunText(
  buffer: Buffer,
  match: (name: string) => boolean,
  tagRe: RegExp
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter(match)
    .sort(
      (a, b) =>
        parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10) -
        parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10)
    );
  const parts: string[] = [];
  for (const name of names) {
    const xml = await zip.files[name].async("string");
    const runs = [...xml.matchAll(tagRe)]
      .map((m) => decodeXml(m[1]))
      .filter(Boolean);
    if (runs.length) parts.push(runs.join(" "));
  }
  return parts.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** Slide text in order, from `ppt/slides/slideN.xml` (`<a:t>` runs). */
export async function extractPptxText(buffer: Buffer): Promise<string> {
  return zipRunText(
    buffer,
    (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n),
    /<a:t>([\s\S]*?)<\/a:t>/g
  );
}

/** Body text from `word/document.xml` (`<w:t>` runs). */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  return zipRunText(
    buffer,
    (n) => n === "word/document.xml",
    /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
  );
}

export interface FlashPair {
  front: string;
  back: string;
}

function splitCsvLine(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim);
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a flashcard file into front/back pairs. Accepts JSON (array of
 * {front/question/term, back/answer/definition}), CSV, TSV, or one-per-line
 * "front <sep> back" where sep is a dash, colon, pipe, =>, or ::.
 */
export function parseFlashcards(raw: string): FlashPair[] {
  const text = raw.trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data)
        ? data
        : data.cards || data.flashcards || [];
      const pairs = (arr as Record<string, unknown>[])
        .map((o) => ({
          front: String(o.front ?? o.question ?? o.term ?? o.q ?? "").trim(),
          back: String(o.back ?? o.answer ?? o.definition ?? o.a ?? "").trim(),
        }))
        .filter((p) => p.front && p.back);
      if (pairs.length) return pairs;
    } catch {
      /* not JSON — fall through to delimited parsing */
    }
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pairs: FlashPair[] = [];

  // Split each line on its own separator so a deck can mix formats: tab wins,
  // then a spaced dash/colon/pipe/=>/:: (won't trip on hyphenated words), then a
  // comma (CSV), then a bare dash/colon as a last resort.
  lines.forEach((line, i) => {
    let front = "";
    let back = "";
    const tabIdx = line.indexOf("\t");
    const spaced = line.match(/^(.+?)\s+(?:=>|::|[-–—:|])\s+(.+)$/);
    if (tabIdx > 0) {
      front = line.slice(0, tabIdx);
      back = line.slice(tabIdx + 1);
    } else if (spaced) {
      front = spaced[1];
      back = spaced[2];
    } else if (line.includes(",")) {
      const cols = splitCsvLine(line, ",");
      front = cols[0] ?? "";
      back = cols.slice(1).join(", ");
    } else {
      const bare = line.match(/^([^-:|=]{1,80})\s*[-:|]\s*(.+)$/);
      if (bare) {
        front = bare[1];
        back = bare[2];
      }
    }
    front = front.trim();
    back = back.trim();

    // Drop an obvious header row.
    if (
      i === 0 &&
      /^(front|term|question|q)$/i.test(front) &&
      /^(back|definition|answer|a)$/i.test(back)
    ) {
      return;
    }
    if (front && back) pairs.push({ front, back });
  });

  return pairs;
}
