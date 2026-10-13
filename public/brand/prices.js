// Fills [data-price] elements with live prices from /health, and shows the owner's notice banner.
fetch("/health").then((r) => r.json()).then((h) => {
  document.querySelectorAll("[data-price]").forEach((el) => {
    const p = h.room_prices && h.room_prices[el.dataset.price];
    if (p) el.textContent = p;
  });
  const n = document.getElementById("site-notice");
  if (n && h.notice) { n.textContent = h.notice; n.hidden = false; }
}).catch(() => {});
