import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { prepareReference, referenceMaxBytes } from "./prepare-reference.ts";

export const referenceFileMaxBytes = 5 * 1024 * 1024;
export const referenceFileAccept = ".md,.txt,.pdf,.doc,.docx";

const workerCode = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  try {
    const bytes = Buffer.from(workerData.bytes);
    let text;
    if (workerData.extension === ".pdf") {
      const { PDFParse } = require(workerData.modulePath);
      const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
      try {
        const info = await parser.getInfo();
        if (info.total > 100) throw new Error("PDF exceeds 100 pages");
        text = (await parser.getText({ pageJoiner: "" })).text;
      } finally {
        await parser.destroy();
      }
    } else {
      const WordExtractor = require(workerData.modulePath);
      text = (await new WordExtractor().extract(bytes)).getBody();
    }
    if (Buffer.byteLength(text, "utf8") > workerData.textLimit) {
      parentPort.postMessage({ error: "Extracted text exceeds 128 KiB. Split the document into smaller references." });
    } else {
      parentPort.postMessage({ text });
    }
  } catch {
    parentPort.postMessage({ error: "Document could not be read. Use an unencrypted PDF (up to 100 pages) or a valid Word document." });
  }
})();
`;

function extractBinary(extension: string, bytes: Uint8Array): Promise<string> {
  const nodeRequire = process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`);
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      execArgv: [],
      workerData: {
        extension, bytes,
        modulePath: nodeRequire.resolve(extension === ".pdf" ? "pdf-parse" : "word-extractor"),
        textLimit: referenceMaxBytes,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      stdout: true, stderr: true,
    });
    // Parser output is intentionally excluded from application logs.
    worker.stdout?.resume();
    worker.stderr?.resume();
    const timer = setTimeout(() => {
      reject(new Error("Document extraction timed out. Try a smaller document."));
      void worker.terminate();
    }, 30000);
    worker.once("message", (result: { text?: string; error?: string }) => {
      clearTimeout(timer);
      if (typeof result.text === "string") resolve(result.text);
      else reject(new Error(result.error || "Document extraction failed."));
      void worker.terminate();
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Document extraction failed. Check the file or try a smaller document."));
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Document extraction stopped before completion."));
    });
  });
}

export async function prepareFileReference(
  file: string, bytes: Uint8Array, values: Parameters<typeof prepareReference>[2],
) {
  const extension = (file.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!referenceFileAccept.split(",").includes(extension)) throw new Error("Expected a .pdf, .doc, .docx, .md or .txt file");
  if (!bytes.length || bytes.length > referenceFileMaxBytes) throw new Error("Provide a nonempty file up to 5 MiB");
  if (extension === ".md" || extension === ".txt") return prepareReference(file, bytes, values);

  // Validate metadata before starting binary extraction.
  prepareReference("validation.txt", new TextEncoder().encode("Reference"), values);
  const header = Buffer.from(bytes.subarray(0, 8));
  const validSignature = extension === ".pdf" ? header.toString("ascii").startsWith("%PDF-")
    : extension === ".docx" ? header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    : header.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (!validSignature) throw new Error("File contents do not match the selected PDF or Word format.");
  const text = (await extractBinary(extension, bytes)).replace(/\r\n?/g, "\n").replace(/\f/g, "\n\n").trim();
  if (!/[\p{L}\p{N}]/u.test(text)) {
    throw new Error("No readable text found. Scanned or image-only documents need OCR before upload.");
  }
  const prepared = prepareReference(`${file}.txt`, new TextEncoder().encode(text), values);
  return {
    ...prepared,
    document: {
      ...prepared.document,
      contentPath: file.split(/[\\/]/).at(-1)!,
      originalFileSha256: createHash("sha256").update(bytes).digest("hex"),
      extraction: { format: extension.slice(1), version: "local-text-v1", offsetUnit: "utf16_extracted_text" },
    },
  };
}
