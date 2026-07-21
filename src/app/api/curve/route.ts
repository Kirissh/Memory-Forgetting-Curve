import { getCurrentUser } from "@/lib/auth";
import { getForgettingCurve } from "@/lib/hlr";
import { jsonOk, unauthorized } from "@/lib/api";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const rawThreshold = Number(url.searchParams.get("threshold"));
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : 0.5;
  const materialId = url.searchParams.get("materialId") || null;

  const curve = await getForgettingCurve(user.id, { threshold, materialId });
  return jsonOk(curve);
}
