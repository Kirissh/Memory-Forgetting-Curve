// Separate CJS require so Next/webpack can externalize pdf-parse cleanly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (
  data: Buffer
) => Promise<{ text: string }>;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return (data.text || "").replace(/\s+\n/g, "\n").trim();
}
