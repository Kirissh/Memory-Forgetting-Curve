"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  audioFileToWav16k,
  getSpeechRecognition,
  type SpeechRecognitionLike,
} from "@/lib/browserMedia";

type Tab = "text" | "audio" | "image" | "link" | "pdf";

export function UploadDropzone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function startListening() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError(
        "Live dictate needs Chrome or Edge. Upload an audio file instead."
      );
      return;
    }
    setError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let finalChunk = text;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalChunk += piece + " ";
        else interim += piece;
      }
      setText((finalChunk + interim).trimStart());
    };
    rec.onerror = (ev) => {
      setError(ev.error === "not-allowed" ? "Mic permission denied" : ev.error);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

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
    stopListening();
    try {
      let res: Response;

      if (tab === "pdf") {
        if (!file) throw new Error("Choose a PDF");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        form.append("kind", "pdf");
        setStatus("Uploading PDF…");
        res = await fetch("/api/materials", { method: "POST", body: form });
      } else if (tab === "audio") {
        if (text.trim().length >= 40) {
          // Dictation path — already have speech-to-text
          setStatus("Saving lecture notes…");
          res = await fetch("/api/materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title,
              text: text.trim(),
              sourceType: "audio",
            }),
          });
        } else if (file) {
          setStatus("Converting audio…");
          const wav = await audioFileToWav16k(file);
          const form = new FormData();
          form.append(
            "file",
            new File([wav], (file.name || "lecture").replace(/\.\w+$/, "") + ".wav", {
              type: "audio/wav",
            })
          );
          form.append("title", title);
          form.append("kind", "audio");
          setStatus("Transcribing with Whisper (first time may download the model)…");
          res = await fetch("/api/materials", { method: "POST", body: form });
        } else {
          throw new Error("Record / dictate some speech, or upload an audio file");
        }
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
    { id: "audio", label: "Audio", hint: "Dictate or upload a lecture clip" },
    { id: "image", label: "Image", hint: "Photo of slides or handwritten notes" },
    { id: "link", label: "Link", hint: "YouTube or article URL" },
    { id: "pdf", label: "PDF", hint: "Lecture slides or a reading" },
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
                onClick={() => {
                  stopListening();
                  setOpen(false);
                }}
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
                    stopListening();
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
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      listening ? stopListening() : startListening()
                    }
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      listening
                        ? "bg-[var(--danger-dim)] text-[var(--danger)]"
                        : "border border-[var(--line)] text-[var(--ink)] hover:border-[var(--accent)]"
                    }`}
                  >
                    {listening ? "Stop dictate" : "Dictate with mic"}
                  </button>
                </div>
                <textarea
                  className="field h-28 resize-none px-3 py-2 text-sm"
                  placeholder="Live transcript appears here — or leave empty and upload a file below"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.025)] px-4 text-center text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                  {file
                    ? file.name
                    : "Or drop an audio file (mp3, wav, m4a, webm)"}
                </label>
                <p className="text-xs text-[var(--muted)]">
                  Uploads are transcribed locally with Whisper tiny — keep clips
                  under ~10 minutes.
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

            {tab === "pdf" ? (
              <label className="mt-3 flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.025)] text-sm text-[var(--muted)] transition-colors hover:border-[var(--accent)]">
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file ? file.name : "Drop a PDF or click to choose"}
              </label>
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
              {busy ? status || "Working…" : "Generate flashcards"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
