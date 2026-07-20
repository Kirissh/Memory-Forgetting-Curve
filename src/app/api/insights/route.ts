import { getCurrentUser } from "@/lib/auth";
import { getInsights } from "@/lib/hlr";
import { jsonOk, unauthorized } from "@/lib/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const data = await getInsights(user.id);
  return jsonOk(data);
}
