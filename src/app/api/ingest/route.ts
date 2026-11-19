import OpenAI from "openai";
import { prepareFileReference, referenceFileMaxBytes } from "@/lib/rag/extract-reference";
import { ingestDocuments } from "@/lib/rag/ingest";
import { getServerClients } from "@/lib/server/clients";

export const maxDuration = 300;
let active = false;
const reply = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function POST(request: Request) {
  const host = request.headers.get("host");
  if (process.env.NODE_ENV !== "development" || !host
    || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    || request.headers.get("origin") !== `http://${host}`) {
    return reply({ error: "Upload local development app mein available hai." }, 403);
  }
  if (active) return reply({ error: "Aik upload process ho raha hai. Thori dair baad try karein." }, 429);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) {
    return reply({ error: "File upload required hai." }, 415);
  }
  active = true;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "File select karein." }, 400);
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > referenceFileMaxBytes + 16384) {
        await reader.cancel();
        return reply({ error: "Upload bohat bara hai. File limit 5 MiB hai." }, 413);
      }
      parts.push(value);
    }
    let prepared: Awaited<ReturnType<typeof prepareFileReference>>;
    try {
      const form = await new Response(Buffer.concat(parts), {
        headers: { "Content-Type": request.headers.get("content-type")! },
      }).formData();
      const files = form.getAll("file");
      if (files.length !== 1 || !(files[0] instanceof File)) throw new Error("Select one PDF, Word, Markdown or text file.");
      const file = files[0];
      prepared = await prepareFileReference(file.name, new Uint8Array(await file.arrayBuffer()), {
        title: String(form.get("title") ?? "").trim(),
        url: String(form.get("url") ?? "").trim(),
        accessedOn: String(form.get("accessedOn") ?? ""),
        topics: String(form.get("topics") ?? "").split(",").map((topic) => topic.trim()).filter(Boolean),
      });
    } catch (error) {
      return reply({ error: error instanceof Error && error.name !== "ZodError"
        ? error.message : "Title, source URL aur access date check karein." }, 400);
    }
    const { document, chunks } = prepared;
    try {
      const result = await ingestDocuments(getServerClients(), [document], chunks);
      return reply({ sourceId: document.id, title: document.title, chunks: result.count, newEmbeddings: result.created });
    } catch (error) {
      if (error instanceof Error && /stored source differs|Stored chunks differ/.test(error.message)) {
        return reply({ error: "Yeh source pehle se different content ya metadata ke saath indexed hai. Document replacement required hai." }, 409);
      }
      if (error instanceof OpenAI.APIError) return reply({ error: "Embedding service available nahi hai. API access aur billing check karein." }, 503);
      return reply({ error: "Ingestion complete nahi hui. Configuration aur connection check karein, phir same file se retry karein." }, 502);
    }
  } catch {
    return reply({ error: "Upload receive nahi ho saki. File dobara select karke try karein." }, 400);
  } finally {
    active = false;
  }
}
