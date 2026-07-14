"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function MaterialActions({
  materialId,
  status,
  hasCards,
}: {
  materialId: string;
  status: string;
  hasCards: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (status !== "processing") return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [status, router]);

  async function remove() {
    if (!confirm("Delete this material and its cards?")) return;
    setDeleting(true);
    await fetch(`/api/materials/${materialId}`, { method: "DELETE" });
    router.push("/library");
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      {hasCards && (
        <Link
          href="/queue"
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#06110a]"
        >
          Study queue
        </Link>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--danger)]"
      >
        Delete
      </button>
    </div>
  );
}
