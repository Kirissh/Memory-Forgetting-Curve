import { Nav } from "@/components/Nav";
import { UploadDropzone } from "@/components/UploadDropzone";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";

function statusPill(status: string) {
  if (status === "ready")
    return "bg-[var(--accent-dim)] text-[var(--accent)]";
  if (status === "processing")
    return "bg-[rgba(255,200,87,0.12)] text-[var(--warn)]";
  return "bg-[var(--danger-dim)] text-[var(--danger)]";
}

export default async function LibraryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const db = await readDb();
  const materials = db.materials
    .filter((m) => m.userId === user.id)
    .map((m) => ({
      ...m,
      cardCount: db.cards.filter((c) => c.materialId === m.id).length,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  return (
    <>
      <Nav email={user.email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-aurora">Your materials</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              <span className="text-aurora">Library</span>
            </h1>
            <p className="mt-2 text-[var(--muted)]">
              Upload a PDF, paste notes or a transcript, or drop a YouTube / article
              link. We&apos;ll extract concepts and cards.
            </p>
          </div>
          <UploadDropzone />
        </div>

        {materials.length === 0 ? (
          <div className="panel mt-16 border-dashed p-16 text-center">
            <p className="font-[family-name:var(--font-display)] text-2xl">
              Nothing here yet
            </p>
            <p className="mt-2 text-[var(--muted)]">
              Upload your first material to seed the retention engine.
            </p>
          </div>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {materials.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/library/${m.id}`}
                  className="panel-lift block p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-medium leading-snug">{m.title}</h2>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs capitalize ${statusPill(m.status)}`}
                    >
                      {m.status === "processing" ? "Processing…" : m.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {m.cardCount} card{m.cardCount === 1 ? "" : "s"} · {m.sourceType}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
