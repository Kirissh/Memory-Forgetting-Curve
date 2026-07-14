import { promises as fs } from "fs";
import path from "path";
import type { Database } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const emptyDb = (): Database => ({
  users: [],
  materials: [],
  chunks: [],
  concepts: [],
  cards: [],
  reviews: [],
  encodings: [],
  modelWeights: [],
});

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(emptyDb(), null, 2));
  }
}

export async function readDb(): Promise<Database> {
  await ensureStore();
  const raw = await fs.readFile(DB_PATH, "utf-8");
  const db = JSON.parse(raw) as Database;
  if (!db.encodings) db.encodings = [];
  return db;
}

export async function writeDb(db: Database): Promise<void> {
  await ensureStore();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

export async function updateDb(
  mutator: (db: Database) => void | Promise<void>
): Promise<Database> {
  const db = await readDb();
  await mutator(db);
  await writeDb(db);
  return db;
}
