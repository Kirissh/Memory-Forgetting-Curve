"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadDropzone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"pdf" | "text">("text");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (tab === "text") {
        res = await fetch("/api/materials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, text }),
        });
      } else {
        if (!file) throw new Error("Choose a PDF");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        res = await fetch("/api/materials", { method: "POST", body: form });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setOpen(false);
      setText("");
      setFile(null);
      setTitle("");
      router.push(`/library/${data.material.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[#06110a] transition hover:brightness-110"
      >
        Upload
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-[var(--line)] bg-[var(--bg-elevated)] p-6 shadow-2xl animate-rise">
            <div className="flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">
                Add material
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setTab("text")}
                className={`rounded-full px-3 py-1 ${tab === "text" ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--muted)]"}`}
              >
                Paste text
              </button>
              <button
                type="button"
                onClick={() => setTab("pdf")}
                className={`rounded-full px-3 py-1 ${tab === "pdf" ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--muted)]"}`}
              >
                PDF
              </button>
            </div>

            <input
              className="mt-4 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            {tab === "text" ? (
              <textarea
                className="mt-3 h-40 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                placeholder="Paste lecture notes or a textbook excerpt…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            ) : (
              <label className="mt-3 flex h-40 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] text-sm text-[var(--muted)] hover:border-[var(--accent)]">
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file ? file.name : "Drop a PDF or click to choose"}
              </label>
            )}

            {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="mt-5 w-full rounded-full bg-[var(--accent)] py-2.5 text-sm font-semibold text-[#06110a] disabled:opacity-50"
            >
              {busy ? "Starting…" : "Generate flashcards"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
