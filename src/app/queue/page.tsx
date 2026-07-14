"use client";

import { Nav } from "@/components/Nav";
import { FlashcardView } from "@/components/FlashcardView";
import { QueueList, useQueue } from "@/components/QueueList";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function QueuePage() {
  const { items, weakTopics, horizonDays, model, loading } = useQueue();
  const [studying, setStudying] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/me")
      .then((r) => {
        if (!r.ok) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) setEmail(data.user.email);
      });
  }, [router]);

  if (studying) {
    return (
      <FlashcardView
        deck={items}
        onExit={() => {
          setStudying(false);
          window.location.reload();
        }}
      />
    );
  }

  const improvement =
    model &&
    typeof model.heldOutLogLoss === "number" &&
    typeof model.baselineLogLoss === "number"
      ? (
          ((model.baselineLogLoss as number) -
            (model.heldOutLogLoss as number)) /
          (model.baselineLogLoss as number)
        ) * 100
      : null;

  return (
    <>
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
          Retention queue
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl sm:text-5xl">
          Today&apos;s focus
        </h1>
        <p className="mt-3 max-w-xl text-[var(--muted)]">
          1 Generate cards → 2 Learn → 3 Rate difficulty → 4 Meaning test → 5
          See what the half-life model says you&apos;re fading on. Scores come
          from{" "}
          <span className="text-[var(--ink)]/80">
            P = 2<sup>−Δt/h</sup>
          </span>
          , not a flat guess.
        </p>

        {model && (
          <p className="mt-4 text-xs text-[var(--muted)]">
            {model.usingPrior
              ? "Cold-start prior weights (need ≥10 tests to personalize)."
              : `Personalized on ${model.trainedOnReviewCount} tests.`}
            {improvement != null && Number.isFinite(improvement) && (
              <> Held-out log-loss {improvement.toFixed(1)}% better than prior.</>
            )}
          </p>
        )}

        <div className="mt-8">
          {loading ? (
            <p className="text-[var(--muted)]">Loading queue…</p>
          ) : (
            <QueueList
              items={items}
              weakTopics={weakTopics}
              horizonDays={horizonDays}
              onStart={() => setStudying(true)}
            />
          )}
        </div>
      </main>
    </>
  );
}
