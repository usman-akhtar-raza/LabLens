import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export function createClients() {
  const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (existsSync(envFile)) loadEnvFile(envFile);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const url = process.env.SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!apiKey || !url || !secret) throw new Error("Configure OPENAI_API_KEY, SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  const project = new URL(url);
  if (project.protocol !== "https:" || !project.hostname.endsWith(".supabase.co") || project.username || project.password || !["", "/"].includes(project.pathname) || project.search || project.hash || !secret.startsWith("sb_secret_")) {
    throw new Error("Invalid hosted Supabase project URL or server key");
  }
  return {
    openai: new OpenAI({ apiKey, timeout: 30000, maxRetries: 1 }),
    supabase: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) } }),
  };
}

export function reportFailure(error: unknown) {
  // Never print SDK error objects, request headers, environment values or raw responses.
  if (error instanceof OpenAI.APIError) {
    const category = error.code === "insufficient_quota" ? "insufficient_quota" : "request_failed";
    console.error(`OpenAI request failed (HTTP ${error.status ?? "unknown"}, ${category}). Check API access/billing or retry later.`);
  } else if (error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))) {
    console.error("Request failed: network, DNS or timeout issue.");
  } else if (error instanceof Error && error.name === "ZodError") {
    console.error("Data validation failed; no raw data printed.");
  } else {
    console.error(error instanceof Error ? error.message : "Operation failed.");
  }
  process.exitCode = 1;
}
