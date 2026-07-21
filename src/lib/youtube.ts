/**
 * Pull captions from a YouTube URL (no API key). Needs captions to exist on the video.
 */

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "music.youtube.com",
]);

export function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return YT_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Extract an 11-char video id from common YouTube URL shapes. */
export function parseYouTubeVideoId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();

    if (host === "youtu.be" || host === "www.youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return isVideoId(id) ? id : null;
    }

    const v = u.searchParams.get("v");
    if (isVideoId(v)) return v;

    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function isVideoId(id: string | null | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}

export interface YouTubeExtract {
  videoId: string;
  title: string;
  text: string;
  sourceUrl: string;
}

export async function extractYouTubeTranscript(
  rawUrl: string
): Promise<YouTubeExtract> {
  const videoId = parseYouTubeVideoId(rawUrl);
  if (!videoId) {
    throw new Error("That doesn't look like a YouTube video link");
  }

  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Dynamic import keeps the route edge-friendly if the package is CJS-only.
  const { YoutubeTranscript } = await import("youtube-transcript");

  let segments: { text: string }[];
  try {
    segments = await YoutubeTranscript.fetchTranscript(videoId);
  } catch {
    throw new Error(
      "No captions found for this video. Try one with subtitles, or paste a transcript."
    );
  }

  const text = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 40) {
    throw new Error("Transcript was too short to build flashcards from");
  }

  const title = await fetchYouTubeTitle(videoId).catch(() => `YouTube ${videoId}`);

  return { videoId, title, text, sourceUrl };
}

async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; RecallEngine/0.1; +https://github.com/Kirissh/Memory-Forgetting-Curve)",
      "Accept-Language": "en-US,en;q=0.8",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error("title fetch failed");
  const html = await res.text();
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (og?.[1]) return decodeHtml(og[1]).trim();
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTag?.[1]) {
    return decodeHtml(titleTag[1])
      .replace(/\s*-\s*YouTube\s*$/i, "")
      .trim();
  }
  throw new Error("no title");
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
