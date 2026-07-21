import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { MaterialActions } from "./MaterialActions";

type Params = { params: Promise<{ materialId: string }> };

export default async function MaterialDetailPage({ params }: Params) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { materialId } = await params;

  const db = await readDb();
  const material = db.materials.find(
    (m) => m.id === materialId && m.userId === user.id
  );
  if (!material) notFound();

  const concepts = db.concepts
    .filter((c) => c.materialId === materialId)
    .map((c) => ({
      ...c,
      card: db.cards.find((card) => card.conceptId === c.id) || null,
    }));

  return (
    <>
      <Nav email={user.email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/library" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          ← Library
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-4xl">
              {material.title}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)] capitalize">
              {material.sourceType}
              {material.sourceUrl ? (
                <>
                  {" · "}
                  <a
                    href={material.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="normal-case text-[var(--accent)] hover:underline"
                  >
                    source
                  </a>
                </>
              ) : null}
              {" · "}
              {material.status}
              {material.errorMessage ? ` — ${material.errorMessage}` : ""}
            </p>
          </div>
          <MaterialActions
            materialId={material.id}
            status={material.status}
            hasCards={concepts.length > 0}
          />
        </div>

        {concepts.length > 0 && (
          <p className="mt-4">
            <Link
              href={`/curve?materialId=${material.id}`}
              className="text-sm text-[var(--accent)] hover:underline"
            >
              View forgetting curve for this material →
            </Link>
          </p>
        )}

        {material.status === "processing" && (
          <p className="panel mt-8 p-6 text-[var(--muted)]">
            Extracting → chunking → embedding → generating cards via LLM7…
            Refresh in a few seconds.
          </p>
        )}

        <ul className="mt-8 space-y-3">
          {concepts.map((c) => {
            const learns = c.learnCount ?? 0;
            return (
              <li key={c.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-medium">{c.title}</h2>
                  <span
                    title={
                      learns === 0
                        ? "Not learned yet"
                        : `Learned ${learns} time${learns === 1 ? "" : "s"}`
                    }
                    className={`learn-badge ${learns === 0 ? "is-new" : ""}`}
                  >
                    ×{learns}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{c.definition}</p>
                {c.card && (
                  <div className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="eyebrow text-[var(--muted)]">Front</p>
                      <p className="mt-1">{c.card.front}</p>
                    </div>
                    <div>
                      <p className="eyebrow text-[var(--muted)]">Back</p>
                      <p className="mt-1">{c.card.back}</p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
