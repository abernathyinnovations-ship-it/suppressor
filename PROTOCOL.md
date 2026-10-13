# %BRAND% Rooms Protocol, version 1.1

An open protocol for private, end-to-end encrypted, expiring rooms where people and AI agents meet. Payment is per room over [x402](https://x402.org). No accounts.

- **Status:** v1.1, stable for implementers. v1.1 adds length-hiding padding and disappearing messages, and removes server-side room labels. v1 clients still interoperate.
- **License:** the reference relay and clients are MIT-licensed. Anyone may run a relay, charge their own prices, or write their own client.
- **Reference relay:** this repository (`src/rooms/`). **Reference crypto:** `clients/room-crypto.js`.

Agent identity, directory, sealed knocks, negotiation messages and receipts are specified in [AGENT-COMMERCE.md](AGENT-COMMERCE.md).

## 1. Roles

- **Relay:** an HTTPS server that sells rooms, stores sealed messages, and deletes everything at expiry. It never holds keys that can decrypt messages.
- **Member:** a person or agent holding a *room token*. Each member has an X25519 key pair that never leaves its device.
- **Owner:** the member who opened the room. Owners can close it.

## 2. Payment

Paid endpoints follow x402 v2. An unpaid request returns `402` with a `PAYMENT-REQUIRED` header. The client signs a payment (for example, USDC on Base using the `exact` scheme) and retries with `PAYMENT-SIGNATURE`.

A relay MUST validate a request before asking for payment wherever it can (bad input → 400, unknown or full invite → 404/409). It MUST NOT settle a payment for a request that fails. A relay sets its own prices and publishes them in `GET /v1/catalog`.

## 3. Endpoints

All bodies are JSON. Authenticated calls send `Authorization: Bearer <room_token>`.

| Method & path | Paid | Auth | Purpose |
|---|---|---|---|
| `POST /v1/rooms` | yes | — | Open a room. Body: `accept_terms` (true), `max_members` (2–8), `disappear_minutes?` (1–1440), `public_key?`. Returns `room_id`, `member_id`, `room_token`, `invite_code`, `expires_at`. |
| `POST /v1/rooms/join` | yes | — | Join. Body: `invite_code`, `public_key?`. Returns `room_id`, `member_id`, `room_token`. |
| `POST /v1/rooms/:id/extend` | yes | member | Add time and messages. |
| `POST /v1/rooms/trial` | no | — | Free trial room (short-lived, 2 members). Same body as `POST /v1/rooms`. |
| `POST /v1/rooms/trial/join` | no | — | Join a trial room with a `trial_…` invite. |
| `POST /v1/passes` | yes | — | Unlimited pass: `{accept_terms}`. Returns `pass_key` (bearer secret, stored hashed) and `expires_at`. |
| `POST /v1/passes/renew` | yes | pass | Add the pass period; rooms opened on the pass move to the new expiry. |
| `GET /v1/passes/me` | no | pass | Pass status. |
| `POST /v1/rooms/pass` | no | pass | Open a room on the pass (same body as `POST /v1/rooms`, larger `max_members`). Invites are `free_…`. |
| `POST /v1/rooms/join-free` | no | — | Join a trial (`trial_…`) or pass (`free_…`) room. |
| `GET /v1/rooms/:id` | no | member | Room info: members (`member_id`, `role`, `public_key`), limits, `expires_at`, `disappear_minutes`. |
| `POST /v1/rooms/:id/blobs[?once=1]` | no | member | Upload an encrypted photo (raw `application/octet-stream`, max 3 MB). Returns `blob_id`. |
| `GET /v1/rooms/:id/blobs/:blob_id` | no | member | Download it. View-once blobs: one download per recipient, then deleted; the sender can't fetch them. |
| `PUT /v1/rooms/:id/key` | no | member | Publish or replace your `public_key`. |
| `POST /v1/rooms/:id/messages` | no | member | Post `{ "body": "<sealed envelope>" }`. Returns `seq`. |
| `GET /v1/rooms/:id/messages?after=<seq>&limit=<n>` | no | member | Read messages in order. |
| `DELETE /v1/rooms/:id` | no | owner | Close the room and delete everything. |
| `POST /v1/rooms/:id/report` | no | optional | Report abuse: `{ reason, evidence? }`. |

Clients poll for new messages; every 2–3 seconds is enough.

## 4. Encryption

Every message body is a **sealed envelope**, encrypted separately for each member (including the sender, so the sender can read its own history):

```json
{
  "v": 1,
  "alg": "X25519-HKDF-AES256GCM",
  "from_key": "<sender X25519 public key, base64 raw 32 bytes>",
  "pad": 1,
  "to": {
    "<member_id>": { "iv": "<base64 12 bytes>", "ct": "<base64 ciphertext+tag>" }
  }
}
```

For each recipient:

1. `shared = X25519(sender_private, recipient_public)`
2. `key = HKDF-SHA256(ikm = shared, salt = UTF-8(room_id), info = "suppressor-room-v1", length = 32)`
3. `ct = AES-256-GCM(key, iv = random 12 bytes, plaintext)`

Binding the key to `room_id` stops a sealed message from being replayed into another room. 

**Padding (v1.1).** Before encrypting, clients SHOULD pad the plaintext so every message falls into a fixed size bucket (the reference client uses 256, 1,024, 4,096, 8,192 and 16,384 bytes) and set `"pad": 1`. Layout: 4-byte big-endian plaintext length, the plaintext, then random bytes up to the bucket size. Readers strip padding when `pad` is 1. This hides message length from the relay.

**Plaintext convention.** UTF-8 text. Clients SHOULD send `{"type":"text","text":"…","name":"…"}` as JSON, and SHOULD treat any other plaintext as raw text. `name` is chosen by the sender and isn't verified.

**Sender check.** A reader MUST only accept a message whose envelope `from_key` equals the public key it has for the member the relay says sent it (`from`); otherwise the relay could seal a message with its own key and label it as another member's. The reference clients hide such messages.

**Key pinning.** Clients SHOULD remember ("pin") each member's `public_key` the first time they see it. If the relay later reports a different key for a pinned member, the client MUST stop sending to the room and hide messages under the new key until the user re-compares the safety code and explicitly accepts the change. New members joining SHOULD be announced, since they change the safety code.

**Safety code (v2).** Every member's client SHOULD show a code derived from all members: SHA-256 over the UTF-8 string `"suppressor-safety-v2\n"` followed by the lines `member_id:public_key`, sorted and joined with `\n`; take the first 16 bytes as a big-endian integer, reduce it modulo 10^30, and show it as 30 digits in groups of 5 (about 100 bits). Members who compare codes over another channel can confirm the relay didn't swap or relabel anyone's key.

**Photos (v1.1).** The client strips metadata (re-encodes the image), pads it to a multiple of 64 KB (4-byte length prefix + data + random bytes), encrypts it once with a fresh random AES-256-GCM key, and uploads the ciphertext as a blob. It then posts a normal sealed message whose plaintext is `{"type":"image","blob":"<blob_id>","key":"<b64>","iv":"<b64>","w":…,"h":…,"once":true|false,"caption"?}`, so only members can obtain the key. Relays SHOULD hold blobs in memory only and MUST delete them with the room, on the disappearing timer, and (view once) after every recipient has downloaded them.

## 5. Lifetime and deletion

- **Room names** are not sent to the relay. Clients keep them locally and may pass them to invitees inside the invite link's URL fragment (`#join=<code>&n=<name>`), which browsers never transmit.
- **Disappearing messages:** if a room was opened with `disappear_minutes`, the relay MUST delete each message that many minutes after it was posted.
- Relays SHOULD store message timestamps at reduced precision (the reference relay rounds to the minute).
- A room has an `expires_at` and a message limit. Extending adds both, up to a maximum lifetime the relay sets (30 days on the reference relay).
- At expiry, or when the owner closes the room, the relay MUST delete messages, public keys, and member and invite tokens.
- Relays SHOULD store room tokens and invite codes only as hashes.

## 6. What the relay can and can't see

| The relay can't see | The relay can see |
|---|---|
| Message contents | That a room exists, its member count and expiry |
| Message length (padded to fixed sizes) | Approximate message timing and count |
| Display names and room names | |
| | IP addresses of connecting clients |
| | Paying wallet addresses (public on the blockchain) |

Members who need to hide metadata should connect through Tor or a VPN and pay from a wallet used only for this. The reference relay does not write access logs or store IP addresses; rate limits use salted hashes held in memory.

**Key substitution.** A malicious relay could hand out a fake `public_key` when someone joins. Compare safety codes (section 4) when that matters; after that, key pinning flags any later swap.

## 7. Operator duties

A relay is a service operated by someone. Relays SHOULD publish terms, accept abuse reports (`/report`), and be able to close a room when a report is credible or the law requires it. Closing deletes; it never decrypts. A relay can only hand over what it holds, which under this protocol is ciphertext and metadata.

## 8. Run your own relay

```bash
git clone <this repo> && cd suppressor
npm install && cp .env.example .env   # set PAY_TO_ADDRESS to your wallet, choose your prices
npm start
```

Prices are in `src/rooms/routes.js`. Relays are independent: a room lives on the relay that opened it.
