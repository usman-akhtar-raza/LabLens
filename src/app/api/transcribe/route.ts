import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const maxBytes = 4 * 1024 * 1024;
let active = false;

function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (process.env.NODE_ENV !== "development" || !loopback.has(url.hostname)
    || !host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    || origin !== `${url.protocol}//${host}`) {
    return reply({ error: "Voice recording sirf local dev app mein available hai." }, 403);
  }
  const mime = request.headers.get("content-type")?.split(";")[0];
  if (!request.body || !mime || !/^(audio|video)\/(webm|mp4|ogg|wav)$/.test(mime)) {
    return reply({ error: "Recording format supported nahi hai." }, 415);
  }
  if (active) return reply({ error: "Aik recording pehle se process ho rahi hai." }, 429);
  active = true;
  let directory: string | undefined;
  try {
    const chunks: Uint8Array[] = [];
    const reader = request.body.getReader();
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return reply({ error: "Recording 4 MB se bari hai." }, 413);
      }
      chunks.push(value);
    }
    if (!size) return reply({ error: "Recording khaali hai." }, 400);

    directory = await mkdtemp(join(tmpdir(), "lablens-stt-"));
    const input = join(directory, "input");
    const wav = join(directory, "speech.wav");
    const output = join(directory, "transcript");
    await writeFile(input, Buffer.concat(chunks));
    try {
      await run(process.env.FFMPEG_BIN || "ffmpeg", [
        "-nostdin", "-v", "error", "-protocol_whitelist", "file",
        "-f", mime.endsWith("webm") ? "matroska" : mime.endsWith("mp4") ? "mov" : mime.split("/")[1],
        "-i", input, "-t", "30", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
      ], { timeout: 10000, signal: request.signal });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "number") throw error;
      return reply({ error: "Recording parhi nahi ja saki. Dobara record karein." }, 422);
    }
    await run(process.env.WHISPER_BIN || "whisper-cli", [
      "-m", resolve(process.env.WHISPER_MODEL_PATH || ".whisper/ggml-base.bin"),
      "-f", wav, "-l", "auto", "-nt", "-otxt", "-of", output,
    ], { timeout: 60000, signal: request.signal });
    const text = (await readFile(`${output}.txt`, "utf8")).trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text.replace(/\[[^\]]*\]|\([^)]*\)/g, ""))) {
      return reply({ error: "Koi alfaaz samajh nahi aaye. Dobara record karein." }, 422);
    }
    return reply({ text: text.slice(0, 1000) });
  } catch {
    return reply({ error: "Local transcription nahi ho saki. Whisper setup check karein ya sawal type karein." }, 503);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    active = false;
  }
}
