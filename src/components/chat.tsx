"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { Answer, Language } from "@/lib/rag/answer-contract";

type Exchange = { id: string; question: string; answer?: Answer };
const examples = [
  { label: "Understand WBC", question: "WBC ka matlab kya hai?", icon: "01" },
  { label: "Know your platelets", question: "Platelets khoon mein kya kaam kartay hain?", icon: "02" },
  { label: "Decode MCV", question: "MCV aur RDW mein kya farq hai?", icon: "03" },
  { label: "Read with context", question: "Lab report ki reference range kya hoti hai?", icon: "04" },
];

function AnswerView({ answer, id }: { answer: Answer; id: string }) {
  function reveal(sourceId: number) {
    const element = document.getElementById(`source-${id}-${sourceId}`) as HTMLDetailsElement | null;
    if (element) { element.open = true; element.scrollIntoView({ block: "nearest" }); }
  }
  return (
    <div className="answer-body">
      <div className="answer-label"><span className="assistant-symbol" aria-hidden="true">✦</span> LabLens <span className="answer-tag">{answer.status === "answered" ? "With references" : answer.status === "out_of_scope" ? "Outside this demo’s scope" : "More evidence needed"}</span></div>
      {answer.paragraphs.map((paragraph, index) => <p className="answer-paragraph" key={index}>{paragraph.text}{[...new Set(paragraph.citationIds)].map((sourceId) => <button key={sourceId} className="citation" onClick={() => reveal(sourceId)} aria-label={`Read source ${sourceId}`}>[{sourceId}]</button>)}</p>)}
      {answer.sources.length > 0 && <div className="sources"><p className="sources-label">SUPPORTING SOURCES <span>{answer.sources.length}</span></p>{answer.sources.map((source) => <details className="source" id={`source-${id}-${source.id}`} key={source.id}>
        <summary><span className="source-index">{source.id}</span><span><strong>{source.title}</strong><small>{source.section}</small></span><span className="source-expand" aria-hidden="true">+</span></summary>
        <div className="source-content"><p className="passage-label">Original reference passage · English</p><blockquote>{source.passage}</blockquote><a href={source.url} target="_blank" rel="noopener noreferrer">Read on MedlinePlus ↗</a><p className="attribution">{source.attribution}</p></div>
      </details>)}</div>}
    </div>
  );
}

export default function Chat() {
  const [language, setLanguage] = useState<Language>("roman-urdu");
  const [input, setInput] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastQuestion = useRef("");
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (exchanges.length) bottom.current?.scrollIntoView({ block: "nearest" }); }, [exchanges.length, pending]);

  async function send(question: string, retry = false) {
    const text = question.trim();
    if (!text || text.length > 1000 || controller.current) return;
    const id = retry ? exchanges.at(-1)!.id : crypto.randomUUID();
    if (!retry) setExchanges((previous) => [...previous, { id, question: text }]);
    lastQuestion.current = text;
    setInput(""); setError(""); setPending(true);
    const current = new AbortController();
    controller.current = current;
    const timeout = setTimeout(() => current.abort(), 90000);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, language }), signal: current.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Jawab nahi mil saka. Dobara try karein.");
      if (!Array.isArray(data.paragraphs) || !Array.isArray(data.sources)) throw new Error("Jawab ka format theek nahi tha. Dobara try karein.");
      if (controller.current === current) setExchanges((previous) => previous.map((item) => item.id === id ? { ...item, answer: data } : item));
    } catch (failure) {
      if (controller.current === current) setError(current.signal.aborted ? "Request ruk gayi ya waqt zyada lag gaya. Dobara try karein." : failure instanceof Error ? failure.message : "Connection nahi ho saka.");
    } finally {
      clearTimeout(timeout);
      if (controller.current === current) { controller.current = null; setPending(false); }
    }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); }
  }
  function clear() {
    controller.current?.abort(); controller.current = null; setPending(false); setExchanges([]); setError(""); setInput(""); inputRef.current?.focus();
  }

  return (
    <div className="app-shell">
      <header className="app-header"><a className="brand" href="/" aria-label="LabLens home"><span className="brand-icon" aria-hidden="true">L<span>+</span></span>LabLens<span className="brand-dot">.</span></a><div className="header-right"><span className="educational-badge"><span /> Educational preview</span><button className="new-chat" onClick={clear}>＋ New chat</button></div></header>
      <div className="workspace">
        <aside className="sidebar"><p className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</p><h1>Your lab terms,<br /><span>made clearer.</span></h1><p className="sidebar-description">Explore the language of a complete blood count, with explanations you can trace back to the source.</p>
          <div className="library-card"><div className="library-heading"><span className="library-icon" aria-hidden="true">▤</span><span>Your reference library</span></div><p>MedlinePlus · National Library of Medicine</p><div className="library-stats"><span><strong>10</strong> references</span><span><strong>CBC</strong> focused</span></div><div className="topic-list">{["RBC & WBC", "Hemoglobin", "Platelets", "MCV & RDW", "Reference ranges"].map((topic) => <span key={topic}>{topic}</span>)}</div></div>
          <div className="scope-note"><span aria-hidden="true">ⓘ</span><p>For understanding terminology. A clinician should interpret personal results and advise on treatment.</p></div>
        </aside>
        <main className="chat-panel"><div className="chat-topline"><span><span className="tiny-spark" aria-hidden="true">✦</span> CBC companion</span><label className="language-control">Answer in<select aria-label="Answer language" value={language} onChange={(event) => setLanguage(event.target.value as Language)} disabled={pending}><option value="roman-urdu">Roman Urdu</option><option value="english">English</option></select></label></div>
          <section className="conversation" aria-label="Questions and answers" aria-live="polite" aria-busy={pending}>
            {!exchanges.length ? <div className="welcome"><div className="welcome-symbol" aria-hidden="true">✦</div><p className="eyebrow">LET’S MAKE SENSE OF IT</p><h2>Aik sawal se shuru karein.</h2><p>CBC ke kisi term ke bare mein poochhein.<br />Jawab ke saath original reference bhi milega.</p><div className="example-grid">{examples.map((example) => <button key={example.icon} className="example" onClick={() => void send(example.question)}><span className="example-number">{example.icon}</span><span><small>{example.label}</small><strong>{example.question}</strong></span><span className="example-arrow" aria-hidden="true">↗</span></button>)}</div></div> : <div className="thread">{exchanges.map((exchange) => <article className="exchange" key={exchange.id}><div className="user-message">{exchange.question}</div>{exchange.answer && <AnswerView answer={exchange.answer} id={exchange.id} />}</article>)}</div>}
            {pending && <div className="loading" role="status"><span className="loading-dot" /><span>References dekh kar jawab tayyar ho raha hai…</span><button onClick={() => controller.current?.abort()}>Stop</button></div>}
            {error && <div className="chat-error" role="alert"><p>{error}</p><button onClick={() => void send(lastQuestion.current, true)}>Dobara try karein ↗</button></div>}
            <div ref={bottom} />
          </section>
          <div className="composer-area"><form className="composer" onSubmit={submit}><label className="sr-only" htmlFor="question">Your CBC question</label><textarea ref={inputRef} id="question" placeholder="Misal: WBC ka matlab kya hai?" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={keyboard} maxLength={1000} rows={2} disabled={pending} /><div className="composer-footer"><span>Har sawal mukammal likhein <span aria-hidden="true">·</span> {input.length}/1000</span><button className="send" type="submit" aria-label="Send question" disabled={pending || !input.trim()}><span>Ask LabLens</span><span aria-hidden="true">↑</span></button></div></form><p className="privacy-note">Sawal OpenAI ko processing ke liye bheja jata hai. Personal reports ya identifying details share na karein.</p></div>
        </main>
      </div>
      <footer className="app-footer"><span>Clarity, with a source.</span><span>AI-generated explanations · Verify important information with a clinician.</span></footer>
    </div>
  );
}
