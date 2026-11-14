"use client";

import { useEffect, useRef, useState } from "react";

type Recording = {
  abort: AbortController;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setTimeout>;
};

function release(recording: Recording) {
  clearTimeout(recording.timer);
  recording.stream?.getTracks().forEach((track) => track.stop());
}

export function VoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [error, setError] = useState("");
  const current = useRef<Recording | null>(null);

  useEffect(() => () => {
    const recording = current.current;
    if (recording) {
      recording.abort.abort();
      release(recording);
      current.current = null;
    }
  }, []);

  function cancel() {
    const recording = current.current;
    current.current = null;
    if (recording) {
      recording.abort.abort();
      release(recording);
    }
    setState("idle");
  }

  async function start() {
    if (current.current) return;
    const recording: Recording = { abort: new AbortController() };
    current.current = recording;
    setError("");
    setState("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Is browser mein mic recording available nahi hai.");
      }
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("Is browser mein supported audio format available nahi hai.");
      recording.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.current !== recording) {
        release(recording);
        return;
      }
      const recorder = new MediaRecorder(recording.stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      recording.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onerror = () => {
        if (current.current !== recording) return;
        cancel();
        setError("Recording ruk gayi. Dobara try karein.");
      };
      recorder.onstop = async () => {
        release(recording);
        if (current.current !== recording) return;
        setState("transcribing");
        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            body: new Blob(chunks, { type: mime }),
            signal: recording.abort.signal,
          });
          const data = await response.json();
          if (!response.ok || typeof data.text !== "string" || !data.text.trim()) {
            throw new Error(data.error || "Transcript nahi mila.");
          }
          if (current.current === recording) onTranscript(data.text);
        } catch (failure) {
          if (current.current === recording) {
            setError(failure instanceof Error ? failure.message : "Transcript nahi mila.");
          }
        } finally {
          if (current.current === recording) cancel();
        }
      };
      recorder.start();
      recording.timer = setTimeout(() => stop(), 30000);
      setState("recording");
    } catch (failure) {
      if (current.current !== recording) return;
      cancel();
      setError(failure instanceof DOMException ? "Mic access nahi mila. Browser permissions check karein." :
        failure instanceof Error ? failure.message : "Recording shuru nahi hui.");
    }
  }

  function stop() {
    const recording = current.current;
    if (recording?.recorder?.state === "recording") recording.recorder.stop();
    if (recording) release(recording);
  }

  return <div className="voice-input">
    {state === "idle" && <button type="button" onClick={() => void start()}>Record question</button>}
    {state === "recording" && <button type="button" onClick={stop}>Stop recording</button>}
    {state !== "idle" && <button type="button" onClick={cancel}>Cancel voice</button>}
    <span role="status">{state === "starting" ? "Mic access ka intezar…" : state === "recording" ? "Recording · max 30s" : state === "transcribing" ? "Transcript ban raha hai…" : ""}</span>
    {error && <span role="alert">{error}</span>}
  </div>;
}
