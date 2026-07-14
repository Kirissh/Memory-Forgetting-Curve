import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/library");

  return (
    <>
      <Nav />
      <main className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,rgba(7,11,18,0.95)_100%)]" />
          <div className="absolute -right-20 top-10 h-[70vh] w-[55vw] rounded-full bg-[radial-gradient(circle,rgba(125,255,179,0.18),transparent_65%)] blur-2xl" />
          <div className="absolute left-[-10%] bottom-0 h-[50vh] w-[50vw] bg-[radial-gradient(circle,rgba(90,140,255,0.12),transparent_70%)]" />
        </div>

        <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col justify-center px-4 py-16">
          <p className="animate-rise text-sm uppercase tracking-[0.3em] text-[var(--accent)]">
            Recall
          </p>
          <h1
            className="animate-rise mt-4 max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[1.05] tracking-tight sm:text-7xl"
            style={{ animationDelay: "80ms" }}
          >
            Revise what you&apos;re about to forget.
          </h1>
          <p
            className="animate-rise mt-6 max-w-xl text-lg text-[var(--muted)]"
            style={{ animationDelay: "160ms" }}
          >
            Upload notes. Auto-generate cards. A trained half-life regression
            model ranks today&apos;s queue by predicted recall — not a static due date.
          </p>
          <div
            className="animate-rise mt-10 flex flex-wrap gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              href="/signup"
              className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[#06110a]"
            >
              Start free
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-[var(--line)] px-6 py-3 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Sign in
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
