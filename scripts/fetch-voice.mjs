// Downloads the on-device voice-typing files so OUR server hosts them (no third party ever
// sees a user's request). Runs during the Docker build; safe to re-run (skips existing files).
// If a download fails, the site still works and the mic button simply stays hidden.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "site", "voice");
const TJS = "3.8.1";
const MODEL = "onnx-community/whisper-tiny.en";
const REV = "2575352d61be1bf7225cf8f8b268a4678025fc58"; // pinned model version

const files = [
  ...["transformers.min.js", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"].map((f) => [
    `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJS}/dist/${f}`, path.join(OUT, "lib", f)]),
  ...["config.json", "generation_config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json",
    "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"].map((f) => [
    `https://huggingface.co/${MODEL}/resolve/${REV}/${f}`, path.join(OUT, "models", MODEL, f)]),
];

let ok = true;
for (const [url, dest] of files) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    console.log(`voice: ${path.relative(ROOT, dest)} (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    ok = false;
    console.warn(`voice: could not fetch ${url}: ${e.message}`);
  }
}
console.log(ok ? "voice: ready" : "voice: incomplete, voice typing will be hidden");
