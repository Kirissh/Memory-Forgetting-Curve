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
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,rgba(7,10,16,0.95)_100%)]" />
          <div className="absolute -right-20 top-10 h-[60vh] w-[50vw] rounded-full bg-[radial-gradient(circle,var(--accent),transparent_65%)] opacity-15 blur-3xl" />
          <div className="absolute left-[-10%] bottom-0 h-[45vh] w-[45vw] rounded-full bg-[radial-gradient(circle,var(--accent-2),transparent_70%)] opacity-10 blur-3xl" />
        </div>

        <section className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col justify-center px-4 py-16">
          <p className="animate-rise eyebrow text-aurora">
            Recall
          </p>
          <h1
            className="animate-rise text-aurora-anim mt-4 max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[1.05] tracking-tight sm:text-7xl"
            style={{ animationDelay: "80ms" }}
          >
            Revise what you&apos;re about to forget.
          </h1>
          <p
            className="animate-rise mt-6 max-w-xl text-lg text-[var(--muted)]"
            style={{ animationDelay: "160ms" }}
          >
            Upload notes. Auto-generate cards. A trained half-life regression
            model ranks today&apos;s queue by predicted recall.
          </p>
          <div
            className="animate-rise mt-10 flex flex-wrap gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              href="/signup"
              className="btn-primary px-6 py-3 text-sm font-semibold"
            >
              Start free
            </Link>
            <Link
              href="/login"
              className="btn-ghost px-6 py-3 text-sm"
            >
              Sign in
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
