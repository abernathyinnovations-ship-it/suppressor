// Sales ledger: records every payment the facilitator actually settled.
// Source of truth is still the blockchain; this is a convenient, fast index for the owner dashboard.
import fs from "node:fs";
import path from "node:path";

let file = null;
let sales = [];
let dirty = false;

export function initSales(dataDir) {
  if (!dataDir) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, "sales.json");
    if (fs.existsSync(file)) sales = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("[sales] can't use data dir:", e.message);
    file = null;
  }
  setInterval(save, 10000).unref();
  for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, save);
}

function save() {
  if (!file || !dirty) return;
  try {
    fs.writeFileSync(file + ".tmp", JSON.stringify(sales));
    fs.renameSync(file + ".tmp", file);
    dirty = false;
  } catch (e) {
    console.error("[sales] save failed:", e.message);
  }
}

export function recordSale(s) {
  if (s.tx && sales.some((x) => x.tx === s.tx)) return;
  sales.push(s);
  if (sales.length > 50000) sales = sales.slice(-50000);
  dirty = true;
  console.log(`[sale] ${s.product} $${s.amount_usd.toFixed(2)} from ${s.payer?.slice(0, 10)}… tx ${s.tx?.slice(0, 12)}…`);
}

// Express middleware: after a paid route finishes, read the facilitator's settlement header.
export function salesRecorder(skus, network) {
  const matchers = skus.map((p) => ({
    p,
    re: new RegExp("^" + p.path.replace(/:[a-zA-Z_]+/g, "[^/]+") + "$"),
    usd: Number(String(p.price).replace(/[^0-9.]/g, "")),
  }));
  return (req, res, next) => {
    const m = matchers.find((x) => x.p.method === req.method && x.re.test(req.path));
    if (!m) return next();
    res.on("finish", () => {
      if (res.statusCode !== 200) return;
      const h = res.getHeader("PAYMENT-RESPONSE") || res.getHeader("X-PAYMENT-RESPONSE");
      if (!h) return; // not a paid call (e.g. payments off)
      try {
        const s = JSON.parse(Buffer.from(String(h), "base64").toString("utf8"));
        if (s.success === false) return;
        recordSale({ at: new Date().toISOString(), product: m.p.id, amount_usd: m.usd, payer: s.payer || null, tx: s.transaction || null, network: s.network || network });
      } catch (e) {
        console.error("[sales] could not read settlement header:", e.message);
      }
    });
    next();
  };
}

export function salesSummary(excludePayers = []) {
  const ex = new Set(excludePayers.map((a) => a.toLowerCase()));
  const real = sales.filter((s) => !s.payer || !ex.has(s.payer.toLowerCase()));
  const now = Date.now();
  const sum = (arr) => Math.round(arr.reduce((a, s) => a + s.amount_usd, 0) * 100) / 100;
  const since = (ms) => real.filter((s) => now - Date.parse(s.at) < ms);
  const byProduct = {};
  for (const s of real) {
    byProduct[s.product] ??= { count: 0, usd: 0 };
    byProduct[s.product].count++;
    byProduct[s.product].usd = Math.round((byProduct[s.product].usd + s.amount_usd) * 100) / 100;
  }
  const payers = new Set(real.map((s) => s.payer).filter(Boolean));
  return {
    today: { count: since(86400e3).length, usd: sum(since(86400e3)) },
    last_7_days: { count: since(7 * 86400e3).length, usd: sum(since(7 * 86400e3)) },
    all_time: { count: real.length, usd: sum(real) },
    unique_customers: payers.size,
    by_product: byProduct,
    excluded_test_sales: sales.length - real.length,
    recent: sales.slice(-50).reverse().map((s) => ({ ...s, test: !!(s.payer && ex.has(s.payer.toLowerCase())) })),
  };
}
