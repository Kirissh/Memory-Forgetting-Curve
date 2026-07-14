import { readFileSync } from "fs";
import { resolve } from "path";
import { regenerateCards } from "../src/lib/pipeline";

// Load .env.local without dotenv
const envPath = resolve(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const value = trimmed.slice(eq + 1);
  if (!process.env[key]) process.env[key] = value;
}

const materialId = process.argv[2];
if (!materialId) {
  console.error("Usage: npx tsx scripts/reprocess.ts <materialId>");
  process.exit(1);
}

regenerateCards(materialId)
  .then(() => {
    console.log("Done reprocessing", materialId);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
