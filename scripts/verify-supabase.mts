import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

async function verify() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
  const project = new URL(url);
  if (project.protocol !== "https:" || !project.hostname.endsWith(".supabase.co") || project.username || project.password || !["", "/"].includes(project.pathname) || project.search || project.hash) {
    throw new Error("SUPABASE_URL must be a hosted Supabase project HTTPS URL.");
  }
  if (!key.startsWith("sb_secret_")) throw new Error("Expected a server-side sb_secret_ key.");
  const headers = { apikey: key, Accept: "application/json" };
  const root = await fetch(new URL("/rest/v1/", project), { headers, signal: AbortSignal.timeout(20000) });
  if (!root.ok) throw new Error(`Supabase Data API authentication failed (HTTP ${root.status}).`);
  await root.body?.cancel();
  console.log("PASS: Supabase Data API reachable; configured API key accepted.");
  for (const table of ["lablens_sources", "lablens_chunks"]) {
    const response = await fetch(new URL(`/rest/v1/${table}?select=id&limit=1`, project), { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { code?: string };
      throw new Error(`Schema check failed for ${table} (HTTP ${response.status}, code ${body.code || "unknown"}).`);
    }
    await response.body?.cancel();
    console.log(`PASS: ${table} available to the backend.`);
  }
  const query = [1, ...Array<number>(1535).fill(0)];
  const rpc = await fetch(new URL("/rest/v1/rpc/match_lablens_chunks", project), {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query_embedding: query, match_count: 1, min_similarity: 0 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!rpc.ok) {
    const body = await rpc.json().catch(() => ({})) as { code?: string };
    throw new Error(`Vector RPC check failed (HTTP ${rpc.status}, code ${body.code || "unknown"}).`);
  }
  const matches: unknown = await rpc.json();
  if (!Array.isArray(matches)) throw new Error("Vector RPC returned an unexpected response.");
  console.log("PASS: 1536-dimensional vector search RPC executed (read-only synthetic vector; no embeddings written).");
}

try {
  await verify();
} catch (error) {
  if (error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
    console.error("Supabase verification could not complete: network, DNS, or timeout failure.");
  } else {
    console.error(error instanceof Error ? error.message : "Supabase verification failed.");
  }
  process.exitCode = 1;
}
