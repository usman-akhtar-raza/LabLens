import { retrieveChunks } from "../src/lib/rag/retrieve.ts";
import { createClients, reportFailure } from "./ai-runtime.mts";

async function search() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) throw new Error('Usage: npm run rag:search -- "What does WBC measure?"');
  const results = await retrieveChunks(question, createClients(), 3);
  console.log(JSON.stringify({ question, results }, null, 2));
}
search().catch(reportFailure);
