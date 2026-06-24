import { readFileSync, writeFileSync, existsSync } from "fs";

const C = { rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m", ylw: "\x1b[33m", dim: "\x1b[2m" };
const BASE = "https://pkrokosz.github.io/smartbuyers";

export async function generateNewsletter() {
  if (!existsSync("generated.json")) { console.log(`  ${C.ylw}→ Newsletter: brak generated.json${C.rst}`); return; }
  const gen = JSON.parse(readFileSync("generated.json", "utf8"));
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = Object.entries(gen).filter(([, info]) => new Date(info.date).getTime() > weekAgo).sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "")).slice(0, 5);
  if (recent.length === 0) { console.log(`  ${C.dim}→ Newsletter: brak artykułów z ostatniego tygodnia${C.rst}`); return; }
  const items = recent.map(([url, info]) => `<li><a href="${BASE}/articles/${info.slug}.html">${info.slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80)}</a> <small>(${new Date(info.date).toLocaleDateString("pl-PL")})</small></li>`).join("\n");
  const today = new Date().toLocaleDateString("pl-PL");
  const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Newsletter SmartBuyers — ${today}</title><style>body{font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:2rem;line-height:1.6;color:#222}h1{color:#159957;font-size:1.5rem;border-bottom:2px solid #159957;padding-bottom:.5rem}ul{padding-left:1.2rem}li{margin:.8rem 0}a{color:#159957}.footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.8rem;color:#999}</style></head><body><h1>📬 SmartBuyers — Przegląd tygodnia</h1><p>Najciekawsze artykuły z ostatnich 7 dni:</p><ul>${items}</ul><p class="footer">Wygenerowano automatycznie · ${today} · <a href="${BASE}/">SmartBuyers</a></p></body></html>`;
  writeFileSync("articles/newsletter-latest.html", html, "utf8");
  console.log(`  ${C.grn}→ Newsletter: articles/newsletter-latest.html (${recent.length} artykułów)${C.rst}`);
}
