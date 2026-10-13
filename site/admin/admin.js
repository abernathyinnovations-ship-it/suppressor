// Suppressor owner control panel. All data comes from /admin/* with the ADMIN_TOKEN.
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var token = null, timer = null, data = null;
  var store = {
    get: function () { try { return localStorage.getItem("sup.admin") || sessionStorage.getItem("sup.admin"); } catch (e) { return null; } },
    set: function (t, remember) { try { (remember ? localStorage : sessionStorage).setItem("sup.admin", t); } catch (e) {} },
    clear: function () { try { ["sup.admin"].forEach(function (k) { localStorage.removeItem(k); sessionStorage.removeItem(k); }); } catch (e) {} }
  };
  var usd = function (n) { return n == null ? "—" : "$" + Number(n).toFixed(2); };
  var esc = function (s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
  var short = function (a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—"; };
  var when = function (iso) { var d = new Date(iso); return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  var left = function (iso) { var m = Math.round((new Date(iso) - Date.now()) / 60000); return m < 60 ? m + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " days"; };
  var kv = function (pairs) { var h = ""; for (var i = 0; i < pairs.length; i += 2) h += "<span>" + esc(pairs[i]) + "</span>" + (typeof pairs[i + 1] === "object" && pairs[i + 1] ? '<span class="' + pairs[i + 1].c + '">' + esc(pairs[i + 1].t) + "</span>" : "<span>" + esc(pairs[i + 1]) + "</span>"); return h; };
  var good = function (ok, yes, no) { return { c: ok ? "good" : "bad", t: ok ? "✓ " + yes : "✗ " + no }; };
  var NAMES = { "room-create": "Room opened", "room-join": "Room joined", "room-extend": "Room extended", "pass-buy": "Monthly pass", "pass-renew": "Pass renewed" };

  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3500); }

  function api(method, path, body) {
    return fetch(path, { method: method, headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (r.status === 404 && path.indexOf("/admin") === 0 && method === "GET") throw new Error("auth");
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "HTTP " + r.status); return j; });
      });
  }

  function render(d) {
    data = d;
    var s = d.sales, st = d.status, c = d.controls || {};
    $("#live").textContent = st.mainnet ? "● Live · real USDC" : "● Test network";
    $("#live").className = "pill " + (st.mainnet ? "ok" : "warn");
    var allOn = c.new_rooms && c.trials && c.joins;
    $("#state").hidden = false;
    $("#state").textContent = !c.new_rooms && !c.joins ? "Paused" : allOn ? "Open for business" : "Partly paused";
    $("#state").className = "pill " + (allOn ? "ok" : "warn");
    $("#updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    $("#bal").innerHTML = d.wallet.usdc == null ? "—" : usd(d.wallet.usdc) + "<small>USDC</small>";
    if (d.wallet.explorer) $("#wallet-link").href = d.wallet.explorer;
    $("#today").textContent = usd(s.today.usd); $("#today-n").textContent = s.today.count + " sale" + (s.today.count === 1 ? "" : "s");
    $("#week").textContent = usd(s.last_7_days.usd); $("#week-n").textContent = s.last_7_days.count + " sales";
    $("#all").textContent = usd(s.all_time.usd); $("#all-n").textContent = s.all_time.count + " sales · " + s.unique_customers + " customer" + (s.unique_customers === 1 ? "" : "s");

    // alerts
    var alerts = [];
    if (d.reports.length) alerts.push(["hot", "You have <b>" + d.reports.length + " open abuse report(s)</b>. Review them below."]);
    if (!c.new_rooms) alerts.push(["hot", "<b>New rooms are paused.</b> Customers can't open or pay for rooms until you switch it back on."]);
    if (!c.joins) alerts.push(["hot", "<b>Joining is paused.</b> Invite links won't work until you switch it back on."]);
    if (c.notice) alerts.push(["", "Notice showing on the site: “" + esc(c.notice) + "”"]);
    if (!st.persistent_storage) alerts.push(["hot", "Rooms and sales aren't on a persistent volume, so a restart wipes them. In Railway, add a Volume at <b>/data</b>."]);
    if (!st.mainnet) alerts.push(["", "You're on the <b>test network</b>. Real customers can't pay until NETWORK is eip155:8453."]);
    if (s.all_time.count === 0) alerts.push(["", "No real sales yet. The first settled payment lists you in Coinbase Bazaar, PayAI and x402scan."]);
    $("#alerts").innerHTML = alerts.map(function (a) { return '<div class="alert ' + a[0] + '">' + a[1] + "</div>"; }).join("");

    // controls
    document.querySelectorAll("[data-ctl]").forEach(function (b) { b.setAttribute("aria-pressed", c[b.dataset.ctl] ? "true" : "false"); });
    if (document.activeElement !== $("#notice")) $("#notice").value = c.notice || "";

    var r = d.rooms;
    $("#now").innerHTML = kv(["Active rooms", r.active_rooms, "Free trial rooms", r.active_trial_rooms, "Active unlimited passes", r.active_passes, "People / agents in rooms", r.members, "Encrypted messages stored", r.stored_messages, "Free trials started today", r.trials_started_today, "Open reports", r.open_reports]);
    $("#prices").innerHTML = kv(Object.keys(d.prices).reduce(function (a, k) { return a.concat([NAMES[k] || k, d.prices[k]]); }, ["Free trial", "$0"]));

    // live rooms
    var L = d.room_list || [];
    $("#room-count").textContent = L.length + " open";
    $("#rooms").innerHTML = L.length ? "<table><tr><th>Room</th><th>Type</th><th class='num'>Members</th><th class='num'>Messages</th><th>Disappearing</th><th>Opened</th><th>Ends in</th><th></th></tr>" + L.map(function (x) {
      return "<tr><td class='mono'>" + esc(x.room_id) + (x.reports ? ' <span class="tag flag">' + x.reports + " report" + (x.reports > 1 ? "s" : "") + "</span>" : "") + "</td><td>" + (x.trial ? '<span class="tag trial">free trial</span>' : x.pass ? '<span class="tag trial">pass</span>' : '<span class="tag">paid</span>') +
        "</td><td class='num'>" + x.members + "/" + x.max_members + "</td><td class='num'>" + x.messages_used + (x.pass ? "" : "/" + x.message_limit) + "</td><td>" + (x.disappear_minutes ? x.disappear_minutes + " min" : "off") +
        "</td><td>" + when(x.created_at) + "</td><td>" + left(x.expires_at) + '</td><td><button class="btn line small" data-shut="' + esc(x.room_id) + '">Shut down</button></td></tr>';
    }).join("") + "</table>" : '<div class="empty">No rooms open right now.</div>';

    // reports
    $("#rep-count").textContent = d.reports.length ? d.reports.length + " open" : "";
    $("#reports").innerHTML = d.reports.length ? d.reports.map(function (x) {
      return '<div class="report"><div class="sub mono">' + when(x.at) + " · " + esc(x.room_id) + " · from " + esc(x.from) + (x.room_found ? "" : " · room already gone") + '</div><div class="r">' + esc(x.reason) + (x.evidence ? '<div class="sub">Evidence: ' + esc(x.evidence.slice(0, 400)) + "</div>" : "") +
        '</div><button class="btn danger small" data-shut="' + esc(x.room_id) + '" data-rep="' + esc(x.id) + '">Shut down room</button> <button class="btn line small" data-dismiss="' + esc(x.id) + '">Dismiss</button></div>';
    }).join("") : '<div class="empty">No open reports.</div>';

    // sales
    $("#excluded").textContent = s.excluded_test_sales ? s.excluded_test_sales + " test sale(s) not counted" : "";
    var recent = s.recent.filter(function (x) { return NAMES[x.product]; });
    $("#sales").innerHTML = recent.length ? "<table><tr><th>When</th><th>What</th><th>Buyer</th><th class='num'>Amount</th></tr>" + recent.map(function (x) {
      var amt = x.tx && d.explorer_tx ? '<a target="_blank" rel="noopener" href="' + d.explorer_tx + esc(x.tx) + '">' + usd(x.amount_usd) + "</a>" : usd(x.amount_usd);
      return "<tr><td>" + when(x.at) + "</td><td>" + esc(NAMES[x.product] || x.product) + (x.test ? ' <span class="tag test">test</span>' : "") + "</td><td class='mono'>" + short(x.payer) + "</td><td class='num'>" + amt + "</td></tr>";
    }).join("") + "</table>" : '<div class="empty">No sales yet. They show up the moment a payment settles.</div>';
    var bp = Object.keys(s.by_product).filter(function (k) { return NAMES[k]; });
    $("#by-product").innerHTML = bp.length ? "<table><tr><th>Product</th><th class='num'>Sales</th><th class='num'>Revenue</th></tr>" + bp.map(function (k) {
      return "<tr><td>" + esc(NAMES[k]) + "</td><td class='num'>" + s.by_product[k].count + "</td><td class='num'>" + usd(s.by_product[k].usd) + "</td></tr>";
    }).join("") + "</table>" : "";

    $("#server").innerHTML = kv(["Network", st.network + (st.mainnet ? " (Base mainnet)" : " (test)"), "Payment processor", st.facilitator, "Public address", st.public_url, "Uptime since restart", st.uptime_hours + " h", "Deployed version", st.version || "—", "Receiving wallet", d.wallet.address]);

    var u = st.public_url;
    var links = [["Your site"], ["Homepage", u + "/"], ["Rooms app", u + "/rooms/"], ["Privacy page", u + "/privacy.html"], ["Terms", u + "/terms.html"], ["MCP for agents", u + "/mcp/"], ["llms.txt", u + "/llms.txt"], ["Catalog (JSON)", u + "/v1/catalog"], ["Open protocol", u + "/PROTOCOL.md"], ["Health check", u + "/health"],
      ["Your accounts"], ["Railway (server)", "https://railway.com/dashboard"], ["GitHub (code)", "https://github.com/abernathyinnovations-ship-it/abernathy-x402"], ["Wallet on BaseScan", d.wallet.explorer], ["Coinbase Developer Portal", "https://portal.cdp.coinbase.com"], ["Trademark search", "https://tmsearch.uspto.gov"],
      ["Get listed"], ["x402scan", "https://www.x402scan.com"], ["x402-list", "https://x402-list.com"], ["PayAI", "https://facilitator.payai.network"], ["Coinbase Bazaar docs", "https://docs.cdp.coinbase.com/x402/bazaar"]];
    $("#links").innerHTML = links.map(function (l) { return l.length === 1 ? "<b>" + esc(l[0]) + "</b>" : l[1] ? '<a target="_blank" rel="noopener" href="' + esc(l[1]) + '">' + esc(l[0]) + " ↗</a>" : ""; }).join("");
  }

  // Live checks against our own site: headers and settings that protect users.
  function checks() {
    var st = data.status;
    return fetch("/", { method: "HEAD", cache: "no-store" }).then(function (r) {
      var h = function (k) { return r.headers.get(k) || ""; };
      var https = location.protocol === "https:";
      $("#checks").innerHTML = kv([
        "Encryption", { c: "good", t: "✓ On device (X25519 + AES-256-GCM)" },
        "Security policy (CSP)", good(/default-src 'self'/.test(h("content-security-policy")), "Only our own files load", "Missing"),
        "Referrer", good(h("referrer-policy") === "no-referrer", "Never sent to other sites", "Missing"),
        "HTTPS only (HSTS)", https ? good(!!h("strict-transport-security"), "On", "Missing") : { c: "", t: "— (local)" },
        "Embedding blocked", good(h("x-frame-options") === "DENY", "Yes", "No"),
        "Persistent storage", good(st.persistent_storage, "Volume attached", "No volume"),
        "Real payments", good(st.mainnet && st.payments, "Base mainnet", "Test mode"),
        "Trackers / outside scripts", { c: "good", t: "✓ None" }
      ]);
    }).catch(function () { $("#checks").innerHTML = kv(["Checks", { c: "bad", t: "Couldn't run" }]); });
  }

  function renderAgents(x, d) {
    var st = x.stats;
    $("#dir-count").textContent = st.listed_agents + " listed";
    $("#checkout-state").textContent = d.deal_checkout ? "ON for all sellers" : "off";
    $("#dir-stats").innerHTML = kv(["Listed agents", st.listed_agents, "Verified deals (receipts)", st.verified_deals, "Contact requests waiting", st.pending_knocks, "Deal checkouts paid", st.checkouts_paid, "Open agent reports", st.open_agent_reports]);
    $("#agent-reports").innerHTML = x.reports.map(function (rp) {
      return '<div class="report"><div class="sub mono">' + when(rp.at) + " · " + esc(rp.agent_id) + '</div><div class="r">' + esc(rp.reason) + '</div><button class="btn danger small" data-delist="' + esc(rp.agent_id) + '" data-arep="' + esc(rp.id) + '">Remove listing</button> <button class="btn line small" data-adismiss="' + esc(rp.id) + '">Dismiss</button></div>';
    }).join("");
    $("#agents").innerHTML = x.agents.length ? "<table><tr><th>Agent</th><th>Name</th><th class='num'>Services</th><th class='num'>Deals</th><th>Listed</th><th></th></tr>" + x.agents.map(function (g) {
      return "<tr><td class='mono'>" + esc(g.agent_id) + "</td><td>" + esc(g.name) + "</td><td class='num'>" + g.services + "</td><td class='num'>" + g.verified_deals + "</td><td>" + when(g.listed_since) + '</td><td><button class="btn line small" data-delist="' + esc(g.agent_id) + '">Remove</button></td></tr>';
    }).join("") + "</table>" : '<div class="empty">No agents listed yet.</div>';
  }
  function load() {
    return api("GET", "/admin/overview").then(function (d) { render(d); checks(); return api("GET", "/admin/agents").then(function (x) { renderAgents(x, d); }).catch(function () {}); }).catch(function (e) {
      if (e.message === "auth") lock("Wrong password.");
      else { $("#live").textContent = "● Unreachable"; $("#live").className = "pill err"; }
    });
  }
  function unlock(t) {
    token = t;
    return api("GET", "/admin/overview").then(function (d) {
      $("#login").hidden = true; $("#dash").hidden = false; $("#refresh").hidden = false; $("#logout").hidden = false;
      render(d); checks(); api("GET", "/admin/agents").then(function (x) { renderAgents(x, d); }).catch(function () {}); clearInterval(timer); timer = setInterval(load, 30000);
    });
  }
  function lock(msg) {
    token = null; store.clear(); clearInterval(timer);
    $("#login").hidden = false; $("#dash").hidden = true; $("#refresh").hidden = true; $("#logout").hidden = true; $("#state").hidden = true;
    $("#login-status").textContent = msg || ""; $("#login-status").className = "status" + (msg ? " err" : "");
    $("#live").textContent = "Locked"; $("#live").className = "pill";
  }
  function setControls(patch, msg) {
    return api("POST", "/admin/controls", patch).then(function () { toast(msg); return load(); }).catch(function (e) { toast("Didn't save: " + e.message); load(); });
  }
  function shutdown(id, rep) {
    if (!/^rm_[\w-]+$/.test(id)) return toast("That doesn't look like a room ID (rm_…).");
    if (!confirm("Shut down " + id + "? The room and everything in it is deleted for all members.")) return;
    api("POST", "/admin/rooms/" + encodeURIComponent(id) + "/shutdown").then(function (r) {
      toast(r.shutdown ? "Room " + id + " shut down and deleted." : "No open room with that ID.");
      return rep ? api("POST", "/admin/reports/" + rep, { status: "resolved: room shut down" }) : null;
    }).then(load).catch(function (e) { toast(e.message); });
  }

  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = $("#token").value.trim(); if (!t) return;
    $("#login-status").textContent = "Checking…"; $("#login-status").className = "status";
    unlock(t).then(function () { store.set(t, $("#remember").checked); $("#token").value = ""; }).catch(function (err) { lock(err.message === "auth" ? "Wrong password." : "Couldn't reach the server."); });
  });
  $("#refresh").addEventListener("click", function () { load().then(function () { toast("Refreshed."); }); });
  $("#logout").addEventListener("click", function () { lock(""); });
  $("#save-notice").addEventListener("click", function () { var v = $("#notice").value.trim(); if (!v) return toast("Type a notice first."); setControls({ notice: v }, "Notice is now showing on the site."); });
  $("#clear-notice").addEventListener("click", function () { $("#notice").value = ""; setControls({ notice: "" }, "Notice removed."); });
  $("#shut-btn").addEventListener("click", function () { shutdown($("#shut-id").value.trim()); });
  $("#close-all").addEventListener("click", function () {
    if ($("#close-all-confirm").value.trim() !== "CLOSE ALL") return toast("Type CLOSE ALL in the box to confirm.");
    if (!confirm("Last check: delete EVERY room right now?")) return;
    api("POST", "/admin/rooms/shutdown-all", { confirm: "CLOSE ALL" }).then(function (r) { $("#close-all-confirm").value = ""; toast(r.closed + " room(s) closed and deleted."); return load(); }).catch(function (e) { toast(e.message); });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ctl) {
      var on = b.getAttribute("aria-pressed") !== "true", patch = {}, label = { new_rooms: "New rooms", trials: "Free trials", joins: "Joining" }[b.dataset.ctl];
      patch[b.dataset.ctl] = on;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      setControls(patch, label + (on ? " switched ON." : " PAUSED."));
    } else if (b.dataset.shut) shutdown(b.dataset.shut, b.dataset.rep);
    else if (b.dataset.delist) {
      if (!confirm("Remove agent " + b.dataset.delist + " from the directory?")) return;
      api("POST", "/admin/agents/" + b.dataset.delist + "/delist").then(function () { return b.dataset.arep ? api("POST", "/admin/agent-reports/" + b.dataset.arep, { status: "resolved: delisted" }) : null; }).then(function () { toast("Listing removed."); return load(); });
    } else if (b.dataset.adismiss) api("POST", "/admin/agent-reports/" + b.dataset.adismiss, { status: "dismissed" }).then(function () { toast("Report dismissed."); return load(); });
    else if (b.dataset.dismiss) api("POST", "/admin/reports/" + b.dataset.dismiss, { status: "dismissed" }).then(function () { toast("Report dismissed."); return load(); });
  });

  var saved = store.get();
  if (saved) unlock(saved).catch(function () { lock(""); }); else lock("");
})();
