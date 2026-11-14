import "server-only";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export function getServerClients() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!apiKey || !url || !key) throw new Error("SERVER_CONFIGURATION_MISSING");
  const project = new URL(url);
  if (project.protocol !== "https:" || !project.hostname.endsWith(".supabase.co") || project.username || project.password || !["", "/"].includes(project.pathname) || project.search || project.hash) throw new Error("SERVER_CONFIGURATION_MISSING");
  return {
    openai: new OpenAI({ apiKey, timeout: 30000, maxRetries: 0 }),
    supabase: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } }),
  };
}
