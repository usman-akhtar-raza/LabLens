"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

type Result = { sourceId: string; title: string; chunks: number; newEmbeddings: number };

export default function ReferenceUpload() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ingest", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Upload complete nahi hui.");
      setResult(body);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Connection nahi ho saka.");
    } finally {
      setPending(false);
    }
  }

  return <main className="upload-page">
    <Link href="/">← Back to LabLens chat</Link>
    <h1>Add a reference</h1>
    <p>Verified MedlinePlus medical-test excerpts upload karein. PDF, Word (.doc/.docx), Markdown ya text file select karein. PDF/Word limit 5 MiB, Markdown/text limit 128 KiB hai.</p>
    <p>Scanned PDF ke liye pehle OCR karein taake text extract ho sake.</p>
    <form onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={pending}>
        <label>Reference file<input name="file" type="file" accept=".md,.txt,.pdf,.doc,.docx" required /></label>
        <label>Source title<input name="title" required maxLength={250} placeholder="Reticulocyte Count" /></label>
        <label>Source URL<input name="url" type="url" required placeholder="https://medlineplus.gov/lab-tests/reticulocyte-count/" /></label>
        <label>Date you checked the source<input name="accessedOn" type="date" required /></label>
        <label>Topics (optional, comma separated)<input name="topics" maxLength={500} placeholder="Red blood cells, CBC" /></label>
        <button type="submit">{pending ? "Ingesting reference…" : "Ingest reference"}</button>
      </fieldset>
    </form>
    {pending && <p role="status">Text validate ho raha hai, chunks aur embeddings save ho rahi hain. Is mein kuch waqt lag sakta hai.</p>}
    {error && <p className="upload-error" role="alert">{error}</p>}
    {result && <section className="upload-success" role="status">
      <h2>{result.title} indexed</h2>
      <p>{result.chunks} chunks saved · {result.newEmbeddings} new embeddings</p>
      <p>Ab is reference se related sawal chat mein pooch sakte hain.</p>
      <Link href="/">Ask LabLens →</Link>
    </section>}
  </main>;
}
