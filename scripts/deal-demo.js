// Two agents do a full private deal through Suppressor:
// discover -> verify -> connect privately -> negotiate -> authorize -> pay -> deliver -> confirm -> receipt.
// Usage: node scripts/deal-demo.js [base_url]
// Needs BUYER_PRIVATE_KEY (a throwaway wallet with test USDC) and a server with DEAL_CHECKOUT=1.
// SELLER_PAY_TO = where the seller gets paid (defaults to PAY_TO_ADDRESS, for the demo only).
import "dotenv/config";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { SuppressorAgent, SpendingPolicy } from "../clients/suppressor-sdk.js";

const base = (process.argv[2] || process.env.PUBLIC_URL || "http://localhost:4021").replace(/\/$/, "");
const network = process.env.NETWORK || "eip155:84532";
const payTo = process.env.SELLER_PAY_TO || process.env.PAY_TO_ADDRESS;
const log = (who, ...a) => console.log(who.padEnd(7), ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const buyerWallet = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY);
const payFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:*", client: new ExactEvmScheme(buyerWallet) }], spendControls: { maxAmountPerPayment: "$2" } });

const seller = await SuppressorAgent.create({ baseUrl: base });
const buyer = await SuppressorAgent.create({
  baseUrl: base, payFetch,
  policy: new SpendingPolicy({ max_per_payment_usd: 1, max_per_day_usd: 3, require_approval_over_usd: 0.75, allowed_categories: ["research"] }),
  approve: async ({ usd, reason }) => { log("OWNER", `approval asked: ${reason} -> approved`); return true; },
});

// 1. DISCOVER: the seller lists a signed business card.
await seller.publish({
  name: "Northwind Research (demo)", description: "Short market briefs on any niche, delivered in minutes.", tags: ["research", "markets"],
  services: [{ id: "market-brief", title: "Market brief", category: "research", description: "1-page brief: size, players, pricing, risks.", price: { model: "fixed", usd: 0.5 }, output: "markdown", turnaround: "5 minutes" }],
  payment: { network, asset: "USDC", pay_to: payTo },
});
log("SELLER", "listed as", seller.agentId);

// 2. VERIFY: the buyer searches and checks signatures itself.
const hits = await buyer.search({ q: "market brief", category: "research", max_usd: 1 });
const found = hits.find((h) => h.agent_id === seller.agentId);
log("BUYER", `found ${hits.length} verified listing(s); picked ${found.card.name}`, JSON.stringify(found.trust.verified_deals), "prior deals");

// 3. CONNECT PRIVATELY: open a room and knock on the seller's sealed inbox.
const broom = await buyer.openRoom({ mode: "trial" });
await buyer.knock(seller.agentId, broom, { note: "Need a brief on EV charging startups" });
const [k] = await seller.inbox();
log("SELLER", `knock from ${k.from} (signature ${k.verified ? "verified" : "NOT verified"}): "${k.note}"`);
const sroom = await seller.joinRoom(k.invite_code);
await wait(500);
await buyer.read(broom);

// 4. NEGOTIATE: offer, counter, accept. Every step is signed and encrypted.
const t1 = await buyer.propose(broom, { buyer: buyer.agentId, seller: seller.agentId, service: "market-brief", category: "research", deliverable: "1-page brief on EV charging startups in the US Southeast", price_usd: 0.4, pay_to: payTo, network });
log("BUYER", `offer $${t1.price_usd}`);
await seller.read(sroom);
const t2 = await seller.counter(sroom, t1.deal_id, { price_usd: 0.8 });
log("SELLER", `counter $${t2.price_usd}`);
await buyer.counter(broom, t1.deal_id, { price_usd: 0.6 });
log("BUYER", "counter $0.6");
await seller.accept(sroom, t1.deal_id);
log("SELLER", "accepted $0.6");
let d = await buyer.deal(broom, t1.deal_id);
log("BUYER", `deal is ${d.status}; signed by ${Object.keys(d.signatures).length} parties`);

// 5. AUTHORIZE + PAY: spending policy checked in code, then x402 pays the seller directly.
const paid = await buyer.pay(broom, t1.deal_id);
log("BUYER", `paid $0.6 straight to the seller: tx ${paid.tx}`);

// 6. EXCHANGE: the seller verifies payment on-chain, then delivers.
await wait(1500);
const v = await seller.verifyPayment(sroom, t1.deal_id);
log("SELLER", `payment on-chain: ${v.ok ? `$${v.amount_usd} from ${v.from}` : v.error}`);
await seller.deliver(sroom, t1.deal_id, "# EV charging startups, US Southeast\n- Demo content: a real seller would deliver its research here\n- Sections: market size, key players, pricing, risks");
log("SELLER", "delivered (hash recorded in the signed message)");

// 7. VERIFY DELIVERY: buyer checks the hash and signs; seller countersigns; receipt goes public.
await buyer.confirm(broom, t1.deal_id);
log("BUYER", "confirmed delivery");
await seller.countersign(sroom, t1.deal_id);
const rec = await seller.submitReceipt(sroom, t1.deal_id);
log("SELLER", `receipt recorded: seller now has ${rec.seller_trust.verified_deals} verified deal(s)`);

// Guardrail check: a deal over the policy limit is refused in code.
const t3 = await seller.propose(sroom, { buyer: buyer.agentId, seller: seller.agentId, service: "market-brief", category: "research", deliverable: "Full report", price_usd: 5, pay_to: payTo, network });
await buyer.accept(broom, t3.deal_id);
try { await buyer.pay(broom, t3.deal_id); } catch (e) { log("BUYER", "refused:", e.message); }
d = await buyer.deal(broom, t1.deal_id);
console.log(JSON.stringify({ deal: d.deal_id, status: d.status, price: d.terms.price_usd, tx: d.payment.tx, receipt_sigs: Object.keys(d.receipt.sigs) }));
await seller.unpublish();
