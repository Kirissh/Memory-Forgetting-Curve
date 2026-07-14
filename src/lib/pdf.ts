import { extractPdfText as extract } from "./pdf-impl";

export async function extractPdfText(buffer: Buffer): Promise<string> {
  return extract(buffer);
}
