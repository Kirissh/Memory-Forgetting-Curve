/**
 * Fetch a public web page and pull readable text for flashcard generation.
 * Lightweight HTML strip — no browser engine. Best on articles / docs / blog posts.
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

export interface WebExtract {
  title: string;
  text: string;
  sourceUrl: string;
}

export function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste a link");
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("That doesn't look like a valid link");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) links are supported");
  }
  const host = u.hostname.toLowerCase();
  if (
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("That link isn't reachable from here");
  }
  return u.toString();
}

export async function extractWebPage(rawUrl: string): Promise<WebExtract> {
  const sourceUrl = normalizeHttpUrl(rawUrl);

  const res = await fetch(sourceUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RecallEngine/0.1; +https://github.com/Kirissh/Memory-Forgetting-Curve)",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Couldn't fetch that page (${res.status})`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/xhtml")
  ) {
    throw new Error("That link isn't an HTML page we can read");
  }

  const html = await res.text();
  if (html.length > 2_500_000) {
    throw new Error("Page is too large to process");
  }

  const title = extractTitle(html) || new URL(sourceUrl).hostname;
  const text = htmlToText(html);

  if (text.length < 40) {
    throw new Error(
      "Couldn't extract enough readable text. Try pasting the article, or a different link."
    );
  }

  // Cap so LLM + chunking stay bounded on huge docs
  const capped =
    text.length > 80_000
      ? text.slice(0, 80_000) + "\n\n[Truncated for length.]"
      : text;

  return { title, text: capped, sourceUrl };
}

function extractTitle(html: string): string | null {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (og?.[1]) return decodeHtml(og[1]).trim();
  const tw = html.match(
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (tw?.[1]) return decodeHtml(tw[1]).trim();
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTag?.[1]) return decodeHtml(titleTag[1]).trim();
  return null;
}

function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer main / article if present
  const main =
    s.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    s.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
    s;

  s = main
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");

  s = decodeHtml(s)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return s;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
