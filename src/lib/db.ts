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
    await writeDb(emptyDb());
  }
}

export async function readDb(): Promise<Database> {
  await ensureStore();
  const raw = await fs.readFile(DB_PATH, "utf-8");
  const db = JSON.parse(raw) as Database;
  if (!db.encodings) db.encodings = [];
  return db;
}

let tmpCounter = 0;

export async function writeDb(db: Database): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Write to a unique temp file then atomically rename, so a reader (or a crash
  // mid-write) never sees a truncated / partially-written db.json.
  const tmp = `${DB_PATH}.${process.pid}.${tmpCounter++}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DB_PATH);
}

// Single-process write mutex: serialize every read-modify-write so two concurrent
// requests can't both read the same snapshot and clobber each other's mutation
// (last-write-wins lost updates). Each updateDb waits for the previous to finish.
let writeChain: Promise<unknown> = Promise.resolve();

export async function updateDb(
  mutator: (db: Database) => void | Promise<void>
): Promise<Database> {
  const run = writeChain.then(async () => {
    const db = await readDb();
    await mutator(db);
    await writeDb(db);
    return db;
  });
  // Keep the chain alive even if this mutation rejects.
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
