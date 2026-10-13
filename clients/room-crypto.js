// End-to-end encryption helper for private rooms (open protocol, see PROTOCOL.md).
// Works in Node 20+ and modern browsers (WebCrypto X25519 + HKDF + AES-256-GCM).
// Photos: encryptBlob / decryptBlob (random per-photo key, sent inside a sealed message).
// The server only ever sees the sealed JSON string; it can't read it.
// Messages are padded to fixed size buckets so the relay can't infer message length.
//
//   const me = await generateIdentity();            // keep me.privateKeyPkcs8 secret
//   // share me.publicKey via PUT /v1/rooms/:id/key (or when creating/joining)
//   const body = await seal(roomId, me, room.members, "hello");   // POST as {body}
//   const text = await open(roomId, me, myMemberId, senderPublicKey, body);

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function generateIdentity() {
  const kp = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  return {
    publicKey: b64(await subtle.exportKey("raw", kp.publicKey)),
    privateKeyPkcs8: b64(await subtle.exportKey("pkcs8", kp.privateKey)),
  };
}

async function sharedKey(roomId, myPrivatePkcs8, theirPublicB64) {
  const priv = await subtle.importKey("pkcs8", unb64(myPrivatePkcs8), { name: "X25519" }, false, ["deriveBits"]);
  const pub = await subtle.importKey("raw", unb64(theirPublicB64), { name: "X25519" }, false, []);
  const bits = await subtle.deriveBits({ name: "X25519", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(roomId), info: enc.encode("suppressor-room-v1") },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Length-hiding padding: [4-byte big-endian length][UTF-8 text][random bytes] up to a bucket
// of 256, 1024, 4096, 8192, 16384… bytes.
export function padBucket(n) { let b = 256; while (b < n) b *= b < 4096 ? 4 : 2; return b; }
function pad(text) {
  const t = enc.encode(text);
  const out = new Uint8Array(padBucket(t.length + 4));
  globalThis.crypto.getRandomValues(out);
  new DataView(out.buffer).setUint32(0, t.length);
  out.set(t, 4);
  return out;
}
function unpad(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (n > bytes.length - 4) throw new Error("bad padding");
  return dec.decode(bytes.subarray(4, 4 + n));
}

// Encrypt once per recipient: every member with a public key, including yourself
// (so you can read your own history back). Needs at least one OTHER member's key.
export async function seal(roomId, me, members, plaintext) {
  if (!members.some((m) => m.public_key && m.public_key !== me.publicKey))
    throw new Error("No other member has published a public key yet.");
  const to = {};
  const padded = pad(plaintext);
  for (const m of members) {
    if (!m.public_key) continue;
    const key = await sharedKey(roomId, me.privateKeyPkcs8, m.public_key);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, padded);
    to[m.member_id] = { iv: b64(iv), ct: b64(ct) };
  }
  return JSON.stringify({ v: 1, alg: "X25519-HKDF-AES256GCM", pad: 1, from_key: me.publicKey, to });
}

// expectedFromKey: the sender's public key as you know it (pinned when they joined).
// Pass it whenever you can: without it, a dishonest relay could seal a message with its own key
// and label it as coming from another member. A mismatch throws SenderKeyMismatch.
export class SenderKeyMismatch extends Error {}
export async function open(roomId, me, myMemberId, body, expectedFromKey) {
  const env = JSON.parse(body);
  const box = env.to?.[myMemberId];
  if (!box) return null; // not addressed to me
  if (expectedFromKey !== undefined && env.from_key !== expectedFromKey) throw new SenderKeyMismatch("The message's sender key doesn't match that member's key");
  const key = await sharedKey(roomId, me.privateKeyPkcs8, env.from_key);
  const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct)));
  return env.pad ? unpad(pt) : dec.decode(pt); // unpadded = older clients
}

// ---- photos / files (v1.1) ----------------------------------------------------------
// A photo is encrypted ONCE with a fresh random AES-256-GCM key. Only that small key travels
// inside a normal sealed message, so each member gets it through their own end-to-end box.
// Size is padded up to a multiple of 64 KB so the relay learns only a rough size.
const BLOB_STEP = 64 * 1024;
export async function encryptBlob(bytes) {
  const raw = new Uint8Array(bytes);
  const size = Math.ceil((raw.length + 4) / BLOB_STEP) * BLOB_STEP;
  const padded = new Uint8Array(size);
  globalThis.crypto.getRandomValues(padded.subarray(0, Math.min(size, 65536)));
  for (let i = 65536; i < size; i += 65536) globalThis.crypto.getRandomValues(padded.subarray(i, Math.min(size, i + 65536)));
  new DataView(padded.buffer).setUint32(0, raw.length);
  padded.set(raw, 4);
  const keyBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const data = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, padded));
  padded.fill(0);
  const out = { data, key: b64(keyBytes), iv: b64(iv) };
  keyBytes.fill(0);
  return out;
}
export async function decryptBlob(data, keyB64, ivB64) {
  const key = await subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["decrypt"]);
  const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, data));
  const n = new DataView(pt.buffer).getUint32(0);
  if (n > pt.length - 4) throw new Error("bad padding");
  const out = pt.slice(4, 4 + n);
  pt.fill(0);
  return out;
}

// ---- verification: key pinning + safety code (PROTOCOL.md §4) -------------------------------------
// Pin each member's key the first time you see it. If the relay later shows a different key for
// someone already pinned, that's a possible interception: stop and re-compare the safety code.
// Returns the updated pins, members new since last time, and members whose key changed.
export function checkPins(pins = {}, members = []) {
  const next = { ...pins }, added = [], changed = [];
  for (const m of members) {
    if (!m.public_key) continue;
    if (!(m.member_id in next)) { next[m.member_id] = m.public_key; added.push(m.member_id); }
    else if (next[m.member_id] !== m.public_key) changed.push({ member_id: m.member_id, pinned: next[m.member_id], shown: m.public_key });
  }
  return { pins: next, added, changed };
}

// Safety code: about 100 bits, shown as 30 digits (6 groups of 5). Covers every member's id and
// key, so the relay can't swap or relabel a key without the codes differing.
export async function safetyCode(members) {
  const entries = members.filter((m) => m.public_key).map((m) => `${m.member_id}:${m.public_key}`).sort().join("\n");
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode("suppressor-safety-v2\n" + entries)));
  let n = 0n;
  for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(h[i]);
  return (n % 10n ** 30n).toString().padStart(30, "0").match(/.{5}/g).join(" ");
}
