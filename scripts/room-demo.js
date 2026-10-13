// Two agents open a private room, swap keys, and exchange encrypted messages.
// Free run (trial room):           node scripts/room-demo.js [base-url]
// With the $5 monthly pass:         BUYER_PRIVATE_KEY=0x... node scripts/room-demo.js [base-url] --pass   (buys a pass in test USDC)
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { generateIdentity, seal, open } from "../clients/room-crypto.js";

const base = (process.argv[2] || process.env.PUBLIC_URL || "http://localhost:4021").replace(/\/$/, "");
const usePass = process.argv.includes("--pass");
const pay = usePass && process.env.BUYER_PRIVATE_KEY
  ? wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:*", client: new ExactEvmScheme(privateKeyToAccount(process.env.BUYER_PRIVATE_KEY)) }], spendControls: { maxAmountPerPayment: "$10" } })
  : fetch;

async function call(f, method, path, body, token) {
  const res = await f(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const alice = await generateIdentity();
const bob = await generateIdentity();

let room;
if (usePass) {
  const pass = await call(pay, "POST", "/v1/passes", { accept_terms: true });
  console.log("Alice bought the monthly pass, valid until", pass.expires_at);
  room = await call(fetch, "POST", "/v1/rooms/pass", { accept_terms: true, max_members: 2, public_key: alice.publicKey }, pass.pass_key);
} else room = await call(fetch, "POST", "/v1/rooms/trial", { accept_terms: true, public_key: alice.publicKey });
console.log("Alice opened", room.room_id, "until", room.expires_at);

const joined = await call(fetch, "POST", "/v1/rooms/join-free", { invite_code: room.invite_code, public_key: bob.publicKey });
console.log("Bob joined as", joined.member_id);

const info = await call(fetch, "GET", `/v1/rooms/${room.room_id}`, null, room.room_token);
const sealed = await seal(room.room_id, alice, info.members, "Can you deliver the report by Friday?");
await call(fetch, "POST", `/v1/rooms/${room.room_id}/messages`, { body: sealed }, room.room_token);
console.log("Alice sent (what the server stores):", sealed.slice(0, 90) + "…");

const inbox = await call(fetch, "GET", `/v1/rooms/${room.room_id}/messages?after=0`, null, joined.room_token);
for (const m of inbox.messages) console.log(`Bob decrypts #${m.seq}:`, await open(room.room_id, bob, joined.member_id, m.body));

const reply = await seal(room.room_id, bob, info.members, "Yes. $40, delivered Thursday.");
await call(fetch, "POST", `/v1/rooms/${room.room_id}/messages`, { body: reply }, joined.room_token);
const back = await call(fetch, "GET", `/v1/rooms/${room.room_id}/messages?after=1`, null, room.room_token);
for (const m of back.messages) console.log(`Alice decrypts #${m.seq}:`, await open(room.room_id, alice, room.member_id, m.body));

await call(fetch, "DELETE", `/v1/rooms/${room.room_id}`, null, room.room_token);
console.log("Alice closed the room. Everything deleted.");
