// Read-only on-chain checks: did a USDC transfer of at least N go to address X in tx T?
// Suppressor never sends transactions or holds keys here; it only reads public chain data.
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

export const USDC_BY_NETWORK = {
  "eip155:8453": { chain: base, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rpc: "https://mainnet.base.org", explorer: "https://basescan.org/tx/" },
  "eip155:84532": { chain: baseSepolia, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org/tx/" },
};
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const clients = new Map();

// from (optional): count only transfers sent BY this address, so nobody can claim
// someone else's payment as their own.
export async function verifyUsdcTransfer({ network, tx, to, min_usd, from: payer }) {
  const cfg = USDC_BY_NETWORK[network];
  if (!cfg) return { ok: false, error: `Unsupported network ${network}` };
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx || "")) return { ok: false, error: "tx must be a 0x transaction hash" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(to || "")) return { ok: false, error: "to must be a 0x address" };
  if (payer != null && !/^0x[0-9a-fA-F]{40}$/.test(payer)) return { ok: false, error: "from must be a 0x address" };
  if (min_usd != null && min_usd !== "" && !(Number(min_usd) > 0 && Number.isFinite(Number(min_usd)))) return { ok: false, error: "min_usd must be a positive number" };
  if (!clients.has(network)) clients.set(network, createPublicClient({ chain: cfg.chain, transport: http(process.env[`RPC_${network.replace(":", "_")}`] || cfg.rpc, { timeout: 8000 }) }));
  let receipt;
  try { receipt = await clients.get(network).getTransactionReceipt({ hash: tx }); } catch { return { ok: false, error: "Transaction not found (yet). Try again in a few seconds." }; }
  if (receipt.status !== "success") return { ok: false, error: "Transaction failed on-chain" };
  const toTopic = "0x" + to.toLowerCase().slice(2).padStart(64, "0");
  const fromTopic = payer ? "0x" + payer.toLowerCase().slice(2).padStart(64, "0") : null;
  let total = 0n, from = null;
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== cfg.usdc.toLowerCase() || l.topics[0] !== TRANSFER || l.topics[2]?.toLowerCase() !== toTopic) continue;
    if (fromTopic && l.topics[1]?.toLowerCase() !== fromTopic) continue;
    total += BigInt(l.data);
    from = "0x" + l.topics[1].slice(26);
  }
  const amount_usd = Number(total) / 1e6;
  if (!total) return { ok: false, error: payer ? "No USDC transfer from that payer to that address in this transaction" : "No USDC transfer to that address in this transaction" };
  if (min_usd != null && amount_usd + 1e-9 < Number(min_usd)) return { ok: false, error: `Transfer was $${amount_usd}, less than $${min_usd}`, amount_usd };
  return { ok: true, network, tx, from, to, amount_usd, block: Number(receipt.blockNumber), explorer: cfg.explorer + tx };
}
