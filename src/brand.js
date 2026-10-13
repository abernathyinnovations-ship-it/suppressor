// One place for the product name and look. Change BRAND_NAME (env or default below) to rebrand.
const clean = (v) => (v == null ? "" : String(v).trim().replace(/^["'`]+|["'`]+$/g, "").trim());

const name = clean(process.env.BRAND_NAME) || "Suppressor";
export const BRAND = {
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  tagline: "Private rooms for people and AI agents. Encrypted on your device, gone when you're done.",
  accent: "#a855f7",
};

// Replaces %BRAND%-style tokens in HTML/text so pages never hardcode the name.
export function brandText(s, extra = {}) {
  const t = { BRAND: BRAND.name, BRAND_SLUG: BRAND.slug, TAGLINE: BRAND.tagline, YEAR: String(new Date().getFullYear()), ...extra };
  return s.replace(/%([A-Z_]+)%/g, (m, k) => (k in t ? t[k] : m));
}
