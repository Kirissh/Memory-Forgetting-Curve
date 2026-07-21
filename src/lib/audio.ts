/**
 * Local Whisper transcription via transformers.js (same stack as MiniLM embeddings).
 * Expects mono/stereo PCM WAV; callers should convert browser recordings first.
 */

import { WaveFile } from "wavefile";

const WHISPER_MODEL = "Xenova/whisper-tiny.en";

type Transcriber = (
  audio: Float32Array,
  opts?: { chunk_length_s?: number; stride_length_s?: number }
) => Promise<{ text?: string } | string>;

let transcriberPromise: Promise<Transcriber> | null = null;

async function getTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = import("@xenova/transformers")
      .then(async (mod) => {
        mod.env.allowLocalModels = false;
        return (await mod.pipeline(
          "automatic-speech-recognition",
          WHISPER_MODEL,
          { quantized: true }
        )) as unknown as Transcriber;
      })
      .catch((err) => {
        transcriberPromise = null;
        throw err;
      });
  }
  return transcriberPromise;
}

/** Decode a WAV buffer to 16 kHz Float32 mono for Whisper. */
export function wavBufferToFloat32(buffer: Buffer): Float32Array {
  const wav = new WaveFile(buffer);
  wav.toBitDepth("32f");
  wav.toSampleRate(16000);
  const raw = wav.getSamples(false, Float32Array) as unknown;
  let samples: Float32Array;
  if (Array.isArray(raw)) {
    const channels = raw as Float32Array[];
    const left = channels[0];
    const right = channels[1] || channels[0];
    samples = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      samples[i] = (left[i] + right[i]) / 2;
    }
  } else {
    samples = raw as Float32Array;
  }
  return samples;
}

/**
 * Transcribe English speech from a WAV file buffer.
 * First call downloads ~40MB whisper-tiny — cached afterward.
 */
export async function transcribeWav(buffer: Buffer): Promise<string> {
  const audio = wavBufferToFloat32(buffer);
  if (audio.length < 1600) {
    throw new Error("Audio is too short to transcribe");
  }
  // Cap ~10 minutes at 16 kHz to keep free-stack memory sane
  const maxSamples = 16_000 * 60 * 10;
  const clipped =
    audio.length > maxSamples ? audio.subarray(0, maxSamples) : audio;

  const transcriber = await getTranscriber();
  const out = await transcriber(clipped, {
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const text = typeof out === "string" ? out : out?.text || "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 20) {
    throw new Error(
      "Could not hear enough speech in this clip. Try a clearer recording or paste the text instead."
    );
  }
  return cleaned;
}
