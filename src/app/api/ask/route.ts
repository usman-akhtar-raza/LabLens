import OpenAI from "openai";
import { askSchema } from "@/lib/rag/answer-contract";
import { answerQuestion } from "@/lib/rag/answer";
import { getServerClients } from "@/lib/server/clients";

export const maxDuration = 90;
let windowStart = 0;
let requests = 0;
let active = 0;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const target = new URL(request.url);
  let originAllowed = !origin || origin === target.origin;
  if (origin && process.env.NODE_ENV === "development") {
    // Next's internal URL can use localhost while the browser uses 127.0.0.1.
    try {
      const browserOrigin = new URL(origin);
      originAllowed ||= browserOrigin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(browserOrigin.hostname) && browserOrigin.port === target.port;
    } catch { /* Malformed origins remain blocked. */ }
  }
  if (!originAllowed) return json({ error: "Request origin allowed nahi hai." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON request required hai." }, 415);
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Sawal likhein." }, 400);
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return json({ error: "Request bohat lambi hai." }, 413); }
      text += decoder.decode(value, { stream: true });
    }
    body = JSON.parse(text + decoder.decode());
  } catch { return json({ error: "Request samajh nahi aayi. Dobara sawal bhejein." }, 400); }
  const parsed = askSchema.safeParse(body);
  if (!parsed.success) return json({ error: "1 se 1000 characters ka sawal aur valid language select karein." }, 400);
  const now = Date.now();
  if (now - windowStart > 60000) { windowStart = now; requests = 0; }
  if (requests >= 12 || active >= 2) return json({ error: "Filhaal requests zyada hain. Thori dair baad dobara try karein." }, 429);
  requests++; active++;
  try {
    const answer = await answerQuestion(parsed.data.question, parsed.data.language, getServerClients(), request.signal);
    return json(answer);
  } catch (error) {
    // Do not log prompts, credentials, SDK error objects, or medical questions.
    if (error instanceof Error && error.message === "SERVER_CONFIGURATION_MISSING") {
      return json({ error: "Server ki API configuration missing hai. .env.local check karein." }, 503);
    }
    if (error instanceof OpenAI.APIError && error.status === 401) {
      const message = process.env.NODE_ENV === "development"
        ? "OpenAI API key reject ho gayi. .env.local mein valid OPENAI_API_KEY set karke dev server restart karein."
        : "Jawab dene wali service filhaal available nahi hai.";
      return json({ error: message }, 503);
    }
    return json({ error: "Jawab generate nahi ho saka. Thori dair baad dobara try karein." }, 502);
  } finally { active--; }
}
