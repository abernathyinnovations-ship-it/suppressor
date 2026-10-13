// On-device speech-to-text (Whisper tiny, English) for voice typing.
// Everything runs inside this browser worker. Audio is never uploaded anywhere: the model and
// runtime are downloaded once from our own server, then cached by the browser.
import { pipeline, env } from "/voice/lib/transformers.min.js";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/voice/models/";
env.backends.onnx.wasm.wasmPaths = "/voice/lib/";
env.backends.onnx.wasm.numThreads = 1;

let asr = null;
const files = {};
function load() {
  asr ??= pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
    device: "wasm",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        files[p.file] = [p.loaded, p.total];
        let a = 0, b = 0;
        for (const [l, t] of Object.values(files)) { a += l; b += t; }
        postMessage({ type: "progress", pct: Math.round((a / b) * 100) });
      }
    },
  }).then((p) => { postMessage({ type: "ready" }); return p; }).catch((e) => { asr = null; throw e; });
  return asr;
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "load") await load();
    if (m.type === "transcribe") {
      const run = await load();
      const out = await run(m.audio, { chunk_length_s: 30, stride_length_s: 5 });
      m.audio.fill(0);
      postMessage({ type: "text", id: m.id, text: (out.text || "").trim() });
    }
  } catch (err) {
    postMessage({ type: "error", id: m.id, error: String(err?.message || err) });
  }
};
