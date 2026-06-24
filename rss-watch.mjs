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
const flagDigest = process.argv.includes("--digest");

const fv = (flag, dict, def) => { const i = process.argv.indexOf(flag); if (i >= 0 && i + 1 < process.argv.length && dict[process.argv[i + 1]]) return process.argv[i + 1]; return def; };
const optFormat  = flagDigest ? "digest" : fv("--format", FORMATS, DEF_FORMAT);
const optPersona = fv("--persona", PERSONAS, DEF_PERSONA);
const optTone    = fv("--tone", TONES, DEF_TONE);
const optLang    = fv("--lang", LANGS, DEF_LANG);

// --- generate single ---
async function generate(itemTitle, snippet, attempt = 0) {
  const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, rssTitle: itemTitle, rssSnippet: snippet });
  const body = { model: MODEL, messages: [{ role: "system", content: bp.system }, { role: "user", content: bp.user }], temperature: 0.3, max_tokens: 8192, stream: true, response_format: { type: "json_object" }, think: false };
  if (attempt > 0) console.log(`    ${C.ylw}RETRY ${attempt + 1}/2${C.rst}`);
  const t0 = Date.now();
  const res = await fetch("http://localhost:11434/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const err = await res.text(); throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`); }
  const raw = await streamResponse(res, "    ");
  console.log(`    → ${((Date.now() - t0) / 1000).toFixed(1)}s | ${raw.length} znaków`);
  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) { console.log(`    ${C.ylw}→ JSON fail${C.rst}`); return { data: null, raw }; }
  console.log(`    → title: "${(data.title || "").slice(0, 50)}" | body: ${(data.body || "").length} zn`);
  const v = validate(data, raw, LANGS[optLang].minWords);
  console.log(`    → Słowa: ${v.words} | H2: ${v.hasH2 ? "✅" : "❌"}`);
  if (!v.ok && attempt < 1) { console.log(`    ${C.ylw}→ ${v.issues.join(", ")} — retry${C.rst}`); return generate(itemTitle, snippet, attempt + 1); }
  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- generate digest ---
async function generateDigest(items) {
  const bp = buildPrompt({ format: "digest", persona: optPersona, tone: optTone, lang: optLang, rssTitle: "Przegląd tygodnia", rssSnippet: items.map((it, i) => `${i + 1}. ${it.title}\n${it.snippet.slice(0, 500)}`).join("\n---\n") });
  const body = { model: MODEL, messages: [{ role: "system", content: bp.system }, { role: "user", content: bp.user }], temperature: 0.3, max_tokens: 8192, stream: true, response_format: { type: "json_object" }, think: false };
  console.log(`    → Digest: ${items.length} wpisów, ${bp.user.length} zn prompta`);

  const t0 = Date.now();
  const res = await fetch("http://localhost:11434/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await streamResponse(res, "    ");
  console.log(`    → ${((Date.now() - t0) / 1000).toFixed(1)}s | ${raw.length} znaków`);

  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) { console.log(`    ${C.ylw}→ JSON fail${C.rst}`); return null; }
  console.log(`    → "${(data.title || "").slice(0, 50)}" | ${(data.body || "").length} zn`);
  return { data, raw };
}

// --- save article ---
function saveArticle(gen, title, link) {
  const extra = link ? { sourceLink: link, sourceLabel: title } : {};
  const { html, fname, body, slug, artTitle } = buildHtml(gen.data, gen.raw, title, MODEL, extra);
  console.log(`  → ${slug} | ${body.length} zn`);
  if (!existsSync("articles")) mkdirSync("articles");
  writeFileSync(fname, html, "utf8");
  if (link) markGen(link, slug);
  console.log(`  ${C.grn}→ ${fname}${C.rst}`);
  console.log(`  ${C.cyn}→ https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}${C.rst}`);
  return { slug, fname };
}

// --- keyword filter ---
function matchFilter(feed, title, snippet) {
  if (!feed.filter || !feed.filter.length) return true;
  const txt = (title + " " + (snippet || "")).toLowerCase();
  return feed.filter.some(kw => txt.includes(kw.toLowerCase()));
}

// --- warmup ---
async function warmup() {
  try {
    await fetch("http://localhost:11434/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "OK" }], max_tokens: 1, think: false }),
    });
    return true;
  } catch { return false; }
}

// --- main ---
async function main() {
  const start = Date.now();
  console.log("╔══════════════════════════════════════════╗");
  console.log(`║     RSS → AI → Blog v3${flagDigest ? " DIGEST" : ""}                  ║`);
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Tryb: ${verb ? "verbose" : "normalny"}${flagReview ? " + review" : " (auto)"}${flagDigest ? " + digest" : ""}`);
  console.log(`  Model: ${MODEL} | Format: ${FORMATS[optFormat].label} | ${LANGS[optLang].label}`);
  console.log(`  Ollama: ${ollamaPs() || "brak"}\n`);

  stepReset(99); step("Wczytywanie feedów");
  if (!existsSync(FEEDS_FILE)) { log("ERR", `Brak ${FEEDS_FILE}`, C.red); process.exit(1); }
  const feeds = JSON.parse(readFileSync(FEEDS_FILE, "utf8"));
  log("INFO", `${feeds.length} feed(ów)`);
  feeds.forEach((f, i) => {
    const kw = f.filter ? ` [filtr: ${f.filter.join(", ")}]` : "";
    console.log(`  ${i + 1}. ${f.name || f.url}${kw} | lastGuid: ${f.lastGuid ? f.lastGuid.slice(0, 30) + "..." : "BRAK"}`);
  });

  const parser = new Parser();
  let totalGenerated = 0;
  const digestItems = [];

  for (const [fi, feed] of feeds.entries()) {
    step(`[Feed ${fi + 1}/${feeds.length}] ${feed.name || feed.url}`, C.ylw);

    let parsed;
    try { parsed = await parser.parseURL(feed.url); } catch (e) { log("ERR", `${e.message}`, C.red); continue; }
    console.log(`  → ${parsed.items.length} wpisów`);
    if (!parsed.items.length) continue;

    const newest = parsed.items[0];
    const newestGuid = newest.guid || newest.link || newest.title;
    if (!newestGuid) { log("WARN", "Brak GUID"); continue; }

    if (!feed.lastGuid) {
      feed.lastGuid = newestGuid;
      console.log(`  ${C.dim}→ Pierwsze uruchomienie – GUID zapamiętany${C.rst}`);
      continue;
    }

    const foundIdx = parsed.items.findIndex(i => (i.guid || i.link || i.title) === feed.lastGuid);
    let newCount = 0;
    let feedGenerated = 0;

    for (const [ii, item] of parsed.items.entries()) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      if (guid === feed.lastGuid) break;
      if (foundIdx === -1 && feedGenerated >= MAX_ITEMS_PER_FEED) break;

      const itemLink = item.link || item.guid;
      if (itemLink && isGen(itemLink)) continue;

      const itemTitle = item.title || "Bez tytułu";
      const snippet = (item.contentSnippet || item.content || "").slice(0, 4000);

      // keyword filter
      if (!matchFilter(feed, itemTitle, snippet)) {
        if (verb) console.log(`  ${C.dim}→ Filtr: pomijam "${itemTitle.slice(0, 60)}"${C.rst}`);
        continue;
      }

      newCount++; feedGenerated++;

      if (flagDigest) {
        digestItems.push({ title: itemTitle, snippet, link: itemLink });
        console.log(`  ${C.dim}#${ii + 1}: ${itemTitle.slice(0, 70)} [digest]${C.rst}`);
        continue;
      }

      totalGenerated++;
      console.log(`\n  ── NOWY #${ii + 1}: ${itemTitle.slice(0, 80)} ──`);
      console.log(`  Treść: ${snippet.length} znaków | Link: ${itemLink || "brak"}`);

      if (flagReview) {
        const ans = await new Promise(r => {
          const rl2 = createInterface({ input: process.stdin, output: process.stdout });
          rl2.question(`  ${C.ylw}[g]eneruj / [p]omiń / [q]wyjdź?${C.rst} `, a => { rl2.close(); r(a.trim().toLowerCase()); });
        });
        if (ans === "q") break;
        if (ans === "p" || ans === "n" || ans === "") { totalGenerated--; feedGenerated--; continue; }
      }

      if (feedGenerated === 1 && !(await warmup())) { console.log(`  ${C.red}Ollama offline${C.rst}`); break; }

      console.log(`  ${C.dim}── generowanie ──${C.rst}`);
      let gen;
      try { gen = await generate(itemTitle, snippet); }
      catch (e) { log("ERR", `${e.message}`, C.red); continue; }
      if (!gen.data) { console.log(`  ${C.red}→ Nieudane${C.rst}`); continue; }
      if (gen.issues?.length) console.log(`  ${C.ylw}→ ${gen.issues.join(", ")}${C.rst}`);

      saveArticle(gen, itemTitle, itemLink);
    }

    if (newCount > 0) console.log(`  → Nowych: ${newCount}${feed.filter ? ` (filtr: ${feed.filter.join(", ")})` : ""}`);
    feed.lastGuid = newestGuid;
  }

  // --- digest mode: generate one roundup ---
  if (flagDigest && digestItems.length > 0) {
    step("Generowanie digestu", C.ylw);
    console.log(`  → ${digestItems.length} wpisów zebranych`);

    if (!(await warmup())) { console.log(`  ${C.red}Ollama offline${C.rst}`); }
    else {
      const dig = await generateDigest(digestItems);
      if (dig && dig.data) {
        totalGenerated++;
        const sources = digestItems.map(it => it.link).filter(Boolean).join(" | ");
        saveArticle(dig, `Przegląd tygodnia: ${new Date().toLocaleDateString("pl-PL")}`, sources);
        for (const it of digestItems) if (it.link) markGen(it.link, "digest");
      }
    }
  }

  writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
  generateIndex(); generateSitemap();

  if (totalGenerated > 0) {
    step("Git push", C.ylw);
    gitPush("articles/ feeds.json generated.json", `Auto: ${totalGenerated} artykuł(i) z RSS`);
    console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/articles/${C.rst}\n`);
  } else {
    step("Brak nowych wpisów");
  }

  console.log(`\n${C.grn}[${ts()}] [DONE] ${((Date.now() - start) / 1000).toFixed(1)}s | ${feeds.length} feedów | ${totalGenerated} artykułów${C.rst}`);
}
main();
