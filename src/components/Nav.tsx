"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string };
type Tab =
  | { kind: "link"; href: string; label: string }
  | { kind: "menu"; label: string; items: Item[] };

// Four top-level tabs; secondary pages live under the two dropdown menus.
const TABS: Tab[] = [
  { kind: "link", href: "/library", label: "Library" },
  {
    kind: "menu",
    label: "Study",
    items: [
      { href: "/queue", label: "Today's Queue" },
      { href: "/study?mode=poker", label: "Poker" },
    ],
  },
  {
    kind: "menu",
    label: "Progress",
    items: [
      { href: "/insights", label: "Insights" },
      { href: "/curve", label: "Curve" },
      { href: "/schedule", label: "Schedule" },
      { href: "/leaderboard", label: "Leaderboard" },
      { href: "/model", label: "The model" },
      { href: "/how-it-works", label: "How it works" },
    ],
  },
  { kind: "link", href: "/shop", label: "Shop" },
];

// Routes that render their own full-bleed experience (or the auth screens).
const HIDE_ON = ["/study", "/login", "/signup"];

function path(href: string): string {
  return href.split("?")[0];
}
function isActive(pathname: string | null, href: string): boolean {
  const p = path(href);
  if (!pathname) return false;
  return p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`);
}

function ActiveUnderline() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[image:var(--grad-aurora)]"
    />
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`relative shrink-0 whitespace-nowrap transition-colors ${
        active ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
      {active && <ActiveUnderline />}
    </Link>
  );
}

function TabMenu({
  tab,
  pathname,
  open,
  onToggle,
  onClose,
}: {
  tab: Extract<Tab, { kind: "menu" }>;
  pathname: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const active = tab.items.some((it) => isActive(pathname, it.href));
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`relative flex items-center gap-1 whitespace-nowrap transition-colors ${
          active || open ? "text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"
        }`}
      >
        {tab.label}
        <span
          aria-hidden
          className={`text-[0.6rem] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
        {active && <ActiveUnderline />}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] rounded-xl border border-[var(--line)] bg-[rgba(8,12,20,0.98)] p-1 shadow-xl backdrop-blur-md"
        >
          {tab.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={onClose}
              className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive(pathname, it.href)
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--bg-panel-2)] hover:text-[var(--ink)]"
              }`}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Nav({
  email,
  streak,
  brains,
}: {
  email?: string | null;
  streak?: number;
  brains?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close any open dropdown on navigation, outside-click, or Escape.
  useEffect(() => setOpenMenu(null), [pathname]);
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  if (HIDE_ON.some((p) => pathname?.startsWith(p))) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header
      // Inline z-index: the unlayered `body > * { z-index:1 }` rule in globals.css
      // outranks the Tailwind z-40 utility (layered), which would otherwise let the
      // page's <main> paint over the sticky header and its dropdowns. Inline wins.
      style={{ zIndex: 50 }}
      className="sticky top-0 border-b border-[var(--line)] bg-[rgba(5,8,15,0.78)] backdrop-blur-md"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[image:var(--grad-aurora)] opacity-30"
      />
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-6 px-4">
        <Link
          href={email ? "/library" : "/"}
          className="shrink-0 font-[family-name:var(--font-display)] text-xl tracking-tight text-aurora"
        >
          Recall
        </Link>
        {email ? (
          <nav ref={navRef} className="flex items-center gap-5 text-sm text-[var(--muted)]">
            {TABS.map((tab) =>
              tab.kind === "link" ? (
                <TabLink
                  key={tab.label}
                  href={tab.href}
                  label={tab.label}
                  active={isActive(pathname, tab.href)}
                />
              ) : (
                <TabMenu
                  key={tab.label}
                  tab={tab}
                  pathname={pathname}
                  open={openMenu === tab.label}
                  onToggle={() =>
                    setOpenMenu((m) => (m === tab.label ? null : tab.label))
                  }
                  onClose={() => setOpenMenu(null)}
                />
              )
            )}
            {typeof brains === "number" && (
              <Link
                href="/queue#brains"
                title={`${streak ?? 0}-day streak · ${brains} Recall Brains`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1 text-xs tabular-nums transition-colors hover:border-[var(--accent)]"
              >
                <span className={streak ? "" : "opacity-40 grayscale"}>
                  🔥<span className="ml-1 text-[var(--ink)]">{streak ?? 0}</span>
                </span>
                <span className="text-[var(--line)]">·</span>
                <span>
                  🧠<span className="ml-1 text-[var(--accent)]">{brains}</span>
                </span>
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="shrink-0 whitespace-nowrap text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              Log out
            </button>
          </nav>
        ) : (
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/how-it-works"
              className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              How it works
            </Link>
            <Link
              href="/model"
              className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              The model
            </Link>
            <Link href="/login" className="btn-primary px-4 py-1.5 text-sm">
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
