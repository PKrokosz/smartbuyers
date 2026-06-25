import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const C = { rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m", ylw: "\x1b[33m", dim: "\x1b[2m", cyn: "\x1b[36m" };
const BASE = "https://pkrokosz.github.io/smartbuyers";

const NB_NEWS_ID = "5dd3bcd8-fc51-481e-bffa-fab231a378c3";
const NB_AUDIO_ID = "992ecd72-3d82-4232-82e0-b5ecbd0a7755";

function nbCli(...args) {
  try {
    const out = execSync(`python "${new URL('./engines/nb_runner.py', import.meta.url).pathname}" ${args.map(a => `"${String(a).replace(/"/g,'\\"')}"`).join(" ")}`, { encoding:"utf8", timeout:300000 });
    return JSON.parse(out.trim());
  } catch (e) { return { error: e.message }; }
}

export async function generateNbReport(digest = false) {
  const gen = existsSync("generated.json") ? JSON.parse(readFileSync("generated.json", "utf8")) : {};
  const entries = Object.entries(gen);
  if (entries.length === 0) { console.log(`  ${C.ylw}→ NB Report: brak artykułów${C.rst}`); return null; }
  console.log(`  ${C.cyn}→ NB: generowanie raportu z ${entries.length} artykułów...${C.rst}`);
  const result = nbCli("generate-report", NB_NEWS_ID, "--format", digest ? "briefing-doc" : "blog-post");
  if (result.error) { console.log(`  ${C.red}→ NB Report: ${result.error}${C.rst}`); return null; }
  console.log(`  ${C.grn}→ NB Report: wygenerowany${C.rst}`);
  return result;
}

export async function generateNbAudio() {
  const gen = existsSync("generated.json") ? JSON.parse(readFileSync("generated.json", "utf8")) : {};
  const entries = Object.entries(gen);
  if (entries.length === 0) { console.log(`  ${C.ylw}→ NB Audio: brak artykułów${C.rst}`); return null; }
  console.log(`  ${C.cyn}→ NB: generowanie podcastu z ${entries.length} artykułów...${C.rst}`);
  const result = nbCli("generate-audio", NB_AUDIO_ID, "--format", "deep-dive");
  if (result.error) { console.log(`  ${C.red}→ NB Audio: ${result.error}${C.rst}`); return null; }
  console.log(`  ${C.grn}→ NB Audio: podcast wygenerowany${C.rst}`);
  return result;
}

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
  // NB integration: push sources then optionally generate report/audio
  try {
    for (const [url] of recent) {
      nbCli("source-add", NB_NEWS_ID, url, "--type", "url");
    }
    console.log(`  ${C.dim}→ NB: źródła dodane do News Digest${C.rst}`);
  } catch (e) { console.log(`  ${C.dim}→ NB skip: ${e.message?.slice(0,60)}${C.rst}`); }
  console.log(`  ${C.dim}→ NB Audio: użyj Tile UI → NotebookLM → Studio → Generate Audio${C.rst}`);
}
