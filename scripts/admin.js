// Operator console. Reads PUBLIC_URL and ADMIN_TOKEN from .env.
//   npm run admin -- stats
//   npm run admin -- reports
//   npm run admin -- shutdown rm_xxxxx
//   npm run admin -- resolve rp_xxxxx [resolved|dismissed]
import "dotenv/config";

const base = (process.env.PUBLIC_URL || "http://localhost:4021").replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!token) { console.error("Set ADMIN_TOKEN in .env"); process.exit(1); }
const [cmd, arg, arg2] = process.argv.slice(2);

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && path.startsWith("/admin")) throw new Error("Not found. Check ADMIN_TOKEN matches the server's.");
  return res.json();
};

if (cmd === "stats") console.log(await call("GET", "/admin/stats"));
else if (cmd === "reports") {
  const reps = await call("GET", "/admin/reports");
  const open = reps.filter((r) => r.status === "open");
  console.log(`${open.length} open of ${reps.length} total`);
  for (const r of open) console.log(`\n${r.id}  room=${r.room_id}  ${r.at}  from=${r.from}  room_live=${r.room_found}\n  ${r.reason}${r.evidence ? "\n  evidence: " + r.evidence.slice(0, 500) : ""}`);
} else if (cmd === "shutdown" && arg) console.log(await call("POST", `/admin/rooms/${arg}/shutdown`));
else if (cmd === "resolve" && arg) console.log(await call("POST", `/admin/reports/${arg}`, { status: arg2 || "resolved" }));
else console.log("Commands: stats | reports | shutdown <room_id> | resolve <report_id> [resolved|dismissed]");
