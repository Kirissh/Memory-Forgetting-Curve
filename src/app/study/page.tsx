"use client";

import { FlashcardView } from "@/components/FlashcardView";
import type { QueueItem } from "@/components/QueueList";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function StudyPage() {
  const router = useRouter();
  const [deck, setDeck] = useState<QueueItem[] | null>(null);

  useEffect(() => {
    fetch("/api/queue/today?limit=30")
      .then(async (r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setDeck(data.items || []);
      });
  }, [router]);

  if (!deck) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Loading session…
      </div>
    );
  }

  return (
    <FlashcardView deck={deck} onExit={() => router.push("/queue")} />
  );
}
