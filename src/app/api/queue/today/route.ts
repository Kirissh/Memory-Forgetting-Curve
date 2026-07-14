import { getCurrentUser } from "@/lib/auth";
import { getTodayQueue } from "@/lib/hlr";
import { jsonOk, unauthorized } from "@/lib/api";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 20);
  const queue = await getTodayQueue(user.id, limit);
  return jsonOk(queue);
}
