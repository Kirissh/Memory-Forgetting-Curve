import { getCurrentUser } from "@/lib/auth";
import { jsonOk, unauthorized } from "@/lib/api";
import { brainsSummary } from "@/lib/brains";

/** Recall Brains summary: balance, streak, and the contribution grid. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return jsonOk(brainsSummary(user));
}
