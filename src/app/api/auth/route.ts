import { NextRequest } from "next/server";
import { login, setSession, signup } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, password, name } = body as {
      action: "login" | "signup";
      email: string;
      password: string;
      name?: string;
    };

    if (!email || !password) return jsonError("Email and password required");

    if (action === "signup") {
      const user = await signup(email, password, name || "");
      await setSession(user.id);
      return jsonOk({
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    const user = await login(email, password);
    if (!user) return jsonError("Invalid credentials", 401);
    await setSession(user.id);
    return jsonOk({
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Auth failed", 400);
  }
}
