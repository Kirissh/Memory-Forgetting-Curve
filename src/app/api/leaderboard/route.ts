import { getCurrentUser } from "@/lib/auth";
import { readDb } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/api";
import { buildLeaderboard } from "@/lib/leaderboard";

/** Study-time + efficiency leaderboard across real accounts and poker rivals. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const db = await readDb();
  return jsonOk({ rows: buildLeaderboard(db.users, db.reviews, user.id) });
}
