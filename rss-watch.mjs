import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import Parser from "rss-parser";
import { C, esc, safeHref, ts, stepReset, step, log, loadGen, isGen, markGen, ollamaPs, FORMATS, PERSONAS, TONES, LANGS, DEF_FORMAT, DEF_PERSONA, DEF_TONE, DEF_LANG, buildPrompt, validate, streamResponse, slugify, buildHtml, gitPush, generateIndex, generateSitemap } from "./lib/shared.mjs";

const FEEDS_FILE = "feeds.json";
const MODEL = "qwen2.5:1.5b";
const MAX_ITEMS_PER_FEED = 5;
const verb = process.argv.includes("--verbose") || process.argv.includes("-v");
const flagReview = process.argv.includes("--review");

// content flags
const fv = (flag, dict, def) => { const i = process.argv.indexOf(flag); if (i >= 0 && i + 1 < process.argv.length && dict[process.argv[i + 1]]) return process.argv[i + 1]; return def; };
const optFormat  = fv("--format",  FORMATS,  DEF_FORMAT);
const optPersona = fv("--persona", PERSONAS, DEF_PERSONA);
const optTone    = fv("--tone",    TONES,    DEF_TONE);
const optLang    = fv("--lang",    LANGS,    DEF_LANG);

// --- generation with retry ---
async function generate(itemTitle, snippet, attempt = 0) {
  const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, rssTitle: itemTitle, rssSnippet: snippet });
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: bp.system },
      { role: "user", content: bp.user },
    ],
    temperature: 0.3, max_tokens: 8192, stream: true,
    response_format: { type: "json_object" }, think: false,
  };
  if (attempt > 0) console.log(`    ${C.ylw}RETRY ${attempt + 1}/2${C.rst}`);
  const t0 = Date.now();
  const res = await fetch("http://localhost:11434/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`); }
  const raw = await streamResponse(res, "    ");
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    → ${dt}s | ${res.status} | ${raw.length} znaków`);

  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) { console.log(`    ${C.ylw}→ JSON niepoprawny${C.rst}`); return { data: null, raw }; }
  console.log(`    → title: "${(data.title || "").slice(0, 50)}" | body: ${(data.body || "").length} znaków`);
  const v = validate(data, raw, LANGS[optLang].minWords);
  console.log(`    → Słowa: ${v.words} | H2: ${v.hasH2 ? "✅" : "❌"}`);
  if (!v.ok && attempt < 1) { console.log(`    ${C.ylw}→ ${v.issues.join(", ")} — ponawiam${C.rst}`); return generate(itemTitle, snippet, attempt + 1); }
  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- main ---
async function main() {
  const start = Date.now();
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     RSS → AI → Blog v2                   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Tryb:   ${verb ? "verbose" : "normalny"}${flagReview ? " + review" : " (auto)"}`);
  console.log(`  Model:  ${MODEL} | Streaming + JSON mode | Temp: 0.3`);
  console.log(`  Ollama: ${ollamaPs() || "brak aktywnych modeli"}\n`);

  stepReset(99); step("Wczytywanie konfiguracji feedów");
  if (!existsSync(FEEDS_FILE)) { log("ERR", `Brak ${FEEDS_FILE}`, C.red); process.exit(1); }
  const feeds = JSON.parse(readFileSync(FEEDS_FILE, "utf8"));
  log("INFO", `${feeds.length} feed(ów)`);
  feeds.forEach((f, i) => console.log(`  ${i + 1}. ${f.name || f.url} | lastGuid: ${f.lastGuid ? f.lastGuid.slice(0, 40) + "..." : "BRAK"}`));

  const parser = new Parser();
  let totalGenerated = 0;

  for (const [fi, feed] of feeds.entries()) {
    step(`[Feed ${fi + 1}/${feeds.length}] Pobieranie: ${feed.name || feed.url}`, C.ylw);
    console.log(`  URL: ${feed.url}`);

    let parsed;
    const t0 = Date.now();
    try {
      parsed = await parser.parseURL(feed.url);
      console.log(`  OK (${((Date.now() - t0) / 1000).toFixed(1)}s) | ${parsed.items.length} wpisów`);
    } catch (e) { log("ERR", `Feed failed: ${e.message}`, C.red); continue; }
    if (parsed.items.length === 0) { console.log("  → Brak wpisów"); continue; }

    step(`[Feed ${fi + 1}] Analiza lastGuid`);
    const newest = parsed.items[0];
    const newestGuid = newest.guid || newest.link || newest.title;
    if (!newestGuid) { log("WARN", "Brak GUID"); continue; }
    console.log(`  Najnowszy: ${(newest.title || "").slice(0, 60)}`);
    if (!feed.lastGuid) { feed.lastGuid = newestGuid; console.log(`  ${C.dim}→ Pierwsze uruchomienie – zapamiętuję GUID${C.rst}`); continue; }

    const foundIdx = parsed.items.findIndex(i => (i.guid || i.link || i.title) === feed.lastGuid);
    if (foundIdx === -1) console.log(`  ${C.ylw}→ GUID nie znaleziony – max ${MAX_ITEMS_PER_FEED} najnowszych${C.rst}`);
    else console.log(`  → GUID na pozycji ${foundIdx + 1}/${parsed.items.length} | nowych: ${foundIdx}`);

    let feedGenerated = 0;
    for (const [ii, item] of parsed.items.entries()) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      if (guid === feed.lastGuid) { console.log(`  ${C.dim}→ Koniec nowych wpisów${C.rst}`); break; }
      if (foundIdx === -1 && feedGenerated >= MAX_ITEMS_PER_FEED) { console.log(`  ${C.dim}→ Limit ${MAX_ITEMS_PER_FEED} osiągnięty${C.rst}`); break; }

      const itemLink = item.link || item.guid;
      const genDb = loadGen();
      if (itemLink && genDb[itemLink]) { console.log(`  ${C.dim}→ Już wygenerowany (${genDb[itemLink].slug}) – pomijam${C.rst}`); continue; }

      totalGenerated++; feedGenerated++;
      const itemTitle = item.title || "Bez tytułu";
      const snippet = (item.contentSnippet || item.content || "").slice(0, 4000);
      console.log(`\n  ── NOWY #${ii + 1}: ${itemTitle.slice(0, 80)} ──`);
      console.log(`  Treść: ${snippet.length} znaków | Link: ${item.link || "brak"}`);

      if (flagReview) {
        const ans = await new Promise(r => {
          const rl2 = createInterface({ input: process.stdin, output: process.stdout });
          rl2.question(`  ${C.ylw}[g]eneruj / [p]omiń / [q]wyjdź?${C.rst} `, a => { rl2.close(); r(a.trim().toLowerCase()); });
        });
        if (ans === "q") { console.log(`  → Wyjście`); break; }
        if (ans === "p" || ans === "n" || ans === "") { console.log(`  → Pominięto`); totalGenerated--; feedGenerated--; continue; }
        console.log(`  → Generuję...`);
      }

      // warmup (first item only)
      if (feedGenerated === 1) {
        console.log(`  ${C.dim}── warmup ──${C.rst}`);
        const tw = Date.now();
        try {
          const wup = await fetch("http://localhost:11434/v1/chat/completions", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "OK" }], max_tokens: 1, think: false }),
          });
          const wj = await wup.json();
          console.log(`  ${C.dim}→ ${((Date.now() - tw) / 1000).toFixed(1)}s | ${wj.usage?.total_tokens || "?"} tokenów${C.rst}`);
        } catch (e) { console.log(`  ${C.red}Warmup failed${C.rst}`); }
      }

      console.log(`  ${C.dim}── generowanie ──${C.rst}`);
      let gen;
      try { gen = await generate(itemTitle, snippet); }
      catch (e) { log("ERR", `Ollama: ${e.message}`, C.red); continue; }
      if (!gen.data) { console.log(`  ${C.red}→ Generowanie nieudane${C.rst}`); continue; }
      if (gen.issues?.length) console.log(`  ${C.ylw}→ Uwagi: ${gen.issues.join(", ")}${C.rst}`);

      // build + save
      const extra = itemLink ? { sourceLink: itemLink, sourceLabel: itemTitle } : {};
      const { html, fname, body, slug, artTitle } = buildHtml(gen.data, gen.raw, itemTitle, MODEL, extra);
      console.log(`  → Slug: ${slug} | Body: ${body.length} znaków`);
      if (!existsSync("articles")) mkdirSync("articles");
      writeFileSync(fname, html, "utf8");
      if (itemLink) markGen(itemLink, slug);
      console.log(`  ${C.grn}→ ZAPISANO: ${fname}${C.rst}`);
      console.log(`  ${C.cyn}→ https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}${C.rst}`);
    }

    feed.lastGuid = newestGuid;
    console.log(`\n  ${C.dim}lastGuid → ${newestGuid.slice(0, 50)}...${C.rst}`);
  }

  writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
  log("INFO", `feeds.json zapisany`);

  // regenerate index + sitemap
  const idxCount = generateIndex();
  generateSitemap();
  log("INFO", `Index: ${idxCount} artykułów | Sitemap: OK`);

  if (totalGenerated > 0) {
    step("Git: commit i push", C.ylw);
    gitPush("articles/ feeds.json generated.json", `Auto: ${totalGenerated} artykuł(i) z RSS`);
    console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/articles/${C.rst}\n`);
  } else {
    step("Brak nowych wpisów – nic do roboty");
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${C.grn}[${ts()}] [DONE] ${elapsed}s | Feedów: ${feeds.length} | Artykułów: ${totalGenerated}${C.rst}`);
}
main();
