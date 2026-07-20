"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function Nav({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const hideOnStudy = pathname?.startsWith("/study");

  if (hideOnStudy) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(7,11,18,0.75)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href={email ? "/library" : "/"}
          className="font-[family-name:var(--font-display)] text-xl tracking-tight"
        >
          Recall
        </Link>
        {email ? (
          <nav className="flex items-center gap-5 text-sm text-[var(--muted)]">
            <Link href="/library" className="hover:text-[var(--ink)] transition-colors">
              Library
            </Link>
            <Link href="/queue" className="hover:text-[var(--ink)] transition-colors">
              Today&apos;s Queue
            </Link>
            <Link href="/curve" className="hover:text-[var(--ink)] transition-colors">
              Curve
            </Link>
            <Link href="/schedule" className="hover:text-[var(--ink)] transition-colors">
              Schedule
            </Link>
            <Link href="/insights" className="hover:text-[var(--ink)] transition-colors">
              Insights
            </Link>
            <button
              type="button"
              onClick={logout}
              className="hover:text-[var(--ink)] transition-colors"
            >
              Log out
            </button>
          </nav>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[#06110a]"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
