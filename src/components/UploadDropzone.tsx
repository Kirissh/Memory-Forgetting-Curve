"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { audioFileToWav16k } from "@/lib/browserMedia";

type Tab = "text" | "doc" | "cards" | "audio" | "image" | "link";

export function UploadDropzone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [cardsText, setCardsText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ocrImage(image: File): Promise<string> {
    setStatus("Reading text from image…");
    const Tesseract = await import("tesseract.js");
    const result = await Tesseract.recognize(image, "eng", {
      logger: () => undefined,
    });
    return (result.data.text || "").replace(/\s+/g, " ").trim();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      let res: Response;

      if (tab === "doc") {
        if (!file) throw new Error("Choose a file (PDF, PPTX, DOCX, or text)");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        setStatus("Reading document…");
        res = await fetch("/api/materials", { method: "POST", body: form });
      } else if (tab === "cards") {
        if (file) {
          const form = new FormData();
          form.append("file", file);
          form.append("title", title);
          form.append("kind", "flashcards");
          setStatus("Importing flashcards…");
          res = await fetch("/api/materials", { method: "POST", body: form });
        } else {
          if (cardsText.trim().length < 3) {
            throw new Error("Paste some 'front, back' lines or choose a CSV/JSON file");
          }
          setStatus("Importing flashcards…");
          res = await fetch("/api/materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, flashcardsText: cardsText }),
          });
        }
      } else if (tab === "audio") {
        if (!file) throw new Error("Choose an audio file");
        setStatus("Converting audio…");
        const wav = await audioFileToWav16k(file);
        const form = new FormData();
        form.append(
          "file",
          new File(
            [wav],
            (file.name || "lecture").replace(/\.\w+$/, "") + ".wav",
            { type: "audio/wav" }
          )
        );
        form.append("title", title);
        form.append("kind", "audio");
        setStatus(
          "Transcribing with Whisper (first time may download the model)…"
        );
        res = await fetch("/api/materials", { method: "POST", body: form });
      } else if (tab === "image") {
        if (!file) throw new Error("Choose an image of your notes or slides");
        const extracted = await ocrImage(file);
        if (extracted.length < 40) {
          throw new Error(
            "Couldn’t read enough text from that image. Try a sharper photo or paste the text."
          );
        }
        setStatus("Generating flashcards…");
        res = await fetch("/api/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title || file.name.replace(/\.\w+$/, ""),
            text: extracted,
            sourceType: "image",
          }),
        });
      } else if (tab === "link") {
        setStatus("Fetching…");
        res = await fetch("/api/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, url }),
        });
      } else {
        setStatus("Generating flashcards…");
        res = await fetch("/api/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            text,
            sourceType: "text",
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setOpen(false);
      setText("");
      setCardsText("");
      setUrl("");
      setFile(null);
      setTitle("");
      setStatus(null);
      router.push(`/library/${data.material.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: "text", label: "Paste text", hint: "Notes, captions, anything typed" },
    { id: "doc", label: "File", hint: "PDF, PPTX, DOCX, or a text file" },
    {
      id: "cards",
      label: "Flashcards",
      hint: "Import a CSV/JSON deck, or paste front → back",
    },
    { id: "audio", label: "Audio", hint: "Upload a lecture clip" },
    {
      id: "image",
      label: "Image",
      hint: "Photo of slides or handwritten notes",
    },
    { id: "link", label: "Link", hint: "YouTube or article URL" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary px-5 py-2.5 text-sm"
      >
        Add material
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="panel max-h-[90vh] w-full max-w-lg overflow-y-auto p-6 shadow-2xl animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">
                Add material
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  onClick={() => {
                    setTab(t.id);
                    setFile(null);
                    setError(null);
                  }}
                  className={`rounded-full px-3 py-1 transition ${
                    tab === t.id
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {tabs.find((t) => t.id === tab)?.hint}
            </p>

            <input
              className="field mt-4 px-3 py-2 text-sm"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            {tab === "text" ? (
              <textarea
                className="field mt-3 h-40 resize-none px-3 py-2 text-sm"
                placeholder="Paste lecture notes, a transcript, or any study text…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            ) : null}

            {tab === "audio" ? (
              <div className="mt-3 space-y-2">
                <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-4 text-center text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  {file
                    ? file.name
                    : "Drop an audio file (mp3, wav, m4a, webm)"}
                </label>
                <p className="text-xs text-[var(--muted)]">
                  Transcribed locally with Whisper tiny — keep clips under ~10
                  minutes.
                </p>
              </div>
            ) : null}

            {tab === "image" ? (
              <div className="mt-3 space-y-2">
                <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-4 text-center text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
                  <input
                    type="file"
                    accept="image/*,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  {file
                    ? file.name
                    : "Drop a photo of slides, whiteboard, or notes"}
                </label>
                <p className="text-xs text-[var(--muted)]">
                  We OCR the image in your browser, then build flashcards from
                  the text.
                </p>
              </div>
            ) : null}

            {tab === "link" ? (
              <div className="mt-3 space-y-2">
                <input
                  className="field w-full px-3 py-2 text-sm"
                  placeholder="https://youtube.com/watch?v=… or any article URL"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-xs text-[var(--muted)]">
                  YouTube needs captions. Articles work best as public HTML
                  (not paywalled PDFs).
                </p>
              </div>
            ) : null}

            {tab === "doc" ? (
              <div className="mt-3 space-y-2">
                <label className="flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-4 text-center text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
                  <input
                    type="file"
                    accept=".pdf,.pptx,.docx,.txt,.md,.rtf,application/pdf"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  {file ? file.name : "Drop a PDF, PPTX, DOCX, or text file"}
                </label>
                <p className="text-xs text-[var(--muted)]">
                  Slides, readings, and documents — we extract the text and build
                  cards.
                </p>
              </div>
            ) : null}

            {tab === "cards" ? (
              <div className="mt-3 space-y-2">
                <textarea
                  className="field h-28 resize-none px-3 py-2 text-sm"
                  placeholder={
                    "Paste one card per line:\nWhat is ATP? , the energy currency of the cell\nOsmosis - water diffusion across a membrane"
                  }
                  value={cardsText}
                  onChange={(e) => setCardsText(e.target.value)}
                />
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-4 py-3 text-center text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
                  <input
                    type="file"
                    accept=".csv,.tsv,.json,.txt"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  {file ? file.name : "…or upload a CSV / TSV / JSON deck"}
                </label>
                <p className="text-xs text-[var(--muted)]">
                  Front and back split by a comma, tab, dash, or colon. No AI
                  needed — imported instantly.
                </p>
              </div>
            ) : null}

            {status && (
              <p className="mt-3 text-sm text-[var(--accent)]">{status}</p>
            )}
            {error && (
              <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="btn-primary mt-5 w-full py-2.5 text-sm"
            >
              {busy
                ? status || "Working…"
                : tab === "cards"
                  ? "Import flashcards"
                  : "Generate flashcards"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
