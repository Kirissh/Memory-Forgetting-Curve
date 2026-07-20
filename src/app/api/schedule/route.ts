import { getCurrentUser } from "@/lib/auth";
import { getSchedule } from "@/lib/hlr";
import { jsonOk, unauthorized } from "@/lib/api";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const t = Number(url.searchParams.get("target"));
  const cap = Number(url.searchParams.get("cap"));

  const data = await getSchedule(user.id, {
    targetRetention: Number.isFinite(t) ? t : undefined,
    dailyCap: Number.isFinite(cap) ? cap : undefined,
  });
  return jsonOk(data);
}
