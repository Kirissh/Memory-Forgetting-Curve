import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "./db";
import type { User } from "./types";
import { STARTING_POKER_CREDITS, STARTING_BRAINS } from "./types";

const SESSION_COOKIE = "recall_session";

function hashPassword(password: string, salt?: string): string {
  const s = salt || randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(`${s}:${password}`).digest("hex");
  return `${s}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const attempt = hashPassword(password, salt);
  const a = Buffer.from(attempt);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function signup(
  email: string,
  password: string,
  name: string
): Promise<User> {
  const normalized = email.trim().toLowerCase();
  let created: User | null = null;

  await updateDb((db) => {
    if (db.users.some((u) => u.email === normalized)) {
      throw new Error("Email already registered");
    }
    created = {
      id: uuid(),
      email: normalized,
      name: name.trim() || normalized.split("@")[0],
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      pokerCredits: STARTING_POKER_CREDITS,
      recallBrains: STARTING_BRAINS,
      activity: [],
    };
    db.users.push(created);
  });

  return created!;
}

export async function login(
  email: string,
  password: string
): Promise<User | null> {
  const db = await readDb();
  const user = db.users.find(
    (u) => u.email === email.trim().toLowerCase()
  );
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

/** Password-free login for local testing, driven by DEMO_USER_EMAIL.
 *
 * The NODE_ENV check is deliberately not configurable: a DEMO_USER_EMAIL that
 * survives into a production env must never become an auth bypass.
 */
export function demoLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    Boolean(process.env.DEMO_USER_EMAIL?.trim())
  );
}

export async function demoLogin(): Promise<User | null> {
  if (!demoLoginEnabled()) return null;
  const email = process.env.DEMO_USER_EMAIL!.trim().toLowerCase();
  const db = await readDb();
  return db.users.find((u) => u.email === email) ?? null;
}

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const db = await readDb();
  return db.users.find((u) => u.id === id) ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}
