"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FramedAvatar,
  downloadFramedAvatar,
} from "@/components/FramedAvatar";
import {
  getFrame,
  RARITY_COLOR,
  RARITY_LABEL,
  type Frame,
  type FrameRarity,
} from "@/lib/frames";

type ShopFrame = Frame & { owned: boolean; equipped: boolean };
type ShopData = {
  balance: number;
  ownedFrames: string[];
  equippedFrame: string | null;
  frames: ShopFrame[];
};

export default function ShopPage() {
  const router = useRouter();
  const [data, setData] = useState<ShopData | null>(null);
  const [initial, setInitial] = useState("Y");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        const name = d?.user?.name || d?.user?.email || "You";
        setInitial(String(name).trim().charAt(0) || "Y");
      })
      .catch(() => {});
    fetch("/api/shop")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [router]);

  const act = useCallback(
    async (action: "buy" | "equip", frameId: string | null) => {
      setBusy(frameId ?? "bare");
      setError(null);
      try {
        const res = await fetch("/api/shop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, frameId }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(d?.error || "Something went wrong");
          return;
        }
        setData(d);
        router.refresh(); // update the nav Brains pill
      } finally {
        setBusy(null);
      }
    },
    [router]
  );

  if (!data) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center px-4">
        <p className="text-[var(--muted)]">Loading shop…</p>
      </main>
    );
  }

  const equipped = getFrame(data.equippedFrame);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <p className="eyebrow text-aurora">Brain shop</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
        Spend your <span className="text-aurora">Brains</span> on drip
      </h1>
      <p className="mt-3 max-w-2xl text-[var(--muted)]">
        Brain Frames wrap your avatar. Buy with 🧠, equip your favourite, and
        download it as a PNG to wear anywhere.
      </p>

      {/* Hero: equipped avatar + download */}
      <section className="panel mt-8 flex flex-col items-center gap-4 p-6 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-5">
          <FramedAvatar frame={equipped} initial={initial} size={104} spin />
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Wearing
            </p>
            <p className="font-[family-name:var(--font-display)] text-2xl">
              {equipped ? equipped.name : "Bare avatar"}
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="chip px-3 py-1 tabular-nums text-[var(--accent)]">
                🧠 {data.balance}
              </span>
              {data.equippedFrame && (
                <button
                  type="button"
                  onClick={() => act("equip", null)}
                  disabled={busy != null}
                  className="text-xs text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  Remove frame
                </button>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => downloadFramedAvatar(equipped, initial)}
          className="btn-soft px-5 py-3 text-sm font-medium"
        >
          ↓ Download PNG
        </button>
      </section>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
      )}

      {/* Grid */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.frames.map((f) => {
          const rarity = f.rarity as FrameRarity;
          const affordable = data.balance >= f.price;
          const isBusy = busy === f.id;
          return (
            <div
              key={f.id}
              className="panel flex flex-col items-center gap-3 p-5 text-center"
              style={{
                borderColor: f.equipped
                  ? RARITY_COLOR[rarity]
                  : undefined,
              }}
            >
              <FramedAvatar frame={f} initial={initial} size={92} spin />
              <div>
                <p className="font-[family-name:var(--font-display)] text-lg">
                  {f.name}
                </p>
                <p
                  className="text-[11px] uppercase tracking-[0.16em]"
                  style={{ color: RARITY_COLOR[rarity] }}
                >
                  {RARITY_LABEL[rarity]}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">{f.blurb}</p>
              </div>

              {f.equipped ? (
                <span className="chip px-4 py-2 text-sm text-[var(--accent)]">
                  ✓ Equipped
                </span>
              ) : f.owned ? (
                <button
                  type="button"
                  onClick={() => act("equip", f.id)}
                  disabled={busy != null}
                  className="btn-soft w-full py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {isBusy ? "…" : "Equip"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => act("buy", f.id)}
                  disabled={busy != null || !affordable}
                  className="btn-primary w-full py-2.5 text-sm font-semibold disabled:opacity-40"
                  title={affordable ? "" : "Not enough Brains"}
                >
                  {isBusy
                    ? "…"
                    : affordable
                      ? `Buy · 🧠 ${f.price}`
                      : `🧠 ${f.price}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
