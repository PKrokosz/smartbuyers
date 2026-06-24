import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { setTimeout } from "timers/promises";
import Parser from "rss-parser";
import { C, esc, ts, stepReset, step, loadGen, isGen, markGen, ollamaModels, FORMATS, PERSONAS, TONES, LANGS, buildPrompt, DEF_FORMAT, DEF_PERSONA, DEF_TONE, DEF_LANG, validate, streamResponse, buildHtml, gitPush, generateIndex, generateSitemap } from "./lib/shared.mjs";

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }
function cleanup() { try { rl.close(); } catch {} }

// --- generation ---
async function generate(model, systemPrompt, userContent, minWords = 200, attempt = 0) {
  const isOllama = !process.env.OPENROUTER_KEY;
  const url = isOllama
    ? "http://localhost:11434/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
  const headers = { "Content-Type": "application/json" };
  if (!isOllama) headers["Authorization"] = `Bearer ${process.env.OPENROUTER_KEY}`;

  const b = { model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }], temperature: 0.3, max_tokens: 8192, stream: true, response_format: { type: "json_object" } };
  if (isOllama) b.think = false;

  if (attempt > 0) console.log(`\n  ${C.ylw}── RETRY ${attempt + 1}/2 ──${C.rst}`);
  const t0 = Date.now();
  let res;
  try { res = await fetch(url, { method: "POST", headers, body: JSON.stringify(b) }); }
  catch (e) { throw new Error(`fetch: ${e.cause?.message || e.message}`); }
  if (!res.ok) { const err = await res.text(); throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`); }

  const raw = await streamResponse(res);
  console.log(`  → ${((Date.now() - t0) / 1000).toFixed(1)}s | ${res.status}`);

  let data;
  try { data = JSON.parse(raw); } catch { try { data = JSON.parse(raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim()); } catch { data = null; } }
  if (!data) {
    const rf = `articles/.raw-${Date.now()}.txt`; writeFileSync(rf, raw, "utf8");
    console.log(`  ${C.ylw}→ JSON fail – raw → ${rf}${C.rst}`);
    return { data: null, raw, valid: false, issues: ["JSON parse failed"] };
  }
  console.log(`  → title: "${(data.title||"").slice(0, 60)}" | body: ${(data.body||"").length} znaków`);
  const v = validate(data, raw, minWords);
  console.log(`  → Słowa: ${v.words} | H2: ${v.hasH2?"✅":"❌"} | Desc: ${(data.desc||"").length} znaków`);
  if (!v.ok && attempt < 1) { console.log(`  ${C.ylw}→ ${v.issues.join(", ")} – retry${C.rst}`); return generate(model, systemPrompt, userContent, minWords, attempt + 1); }
  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- main ---
async function main() {
  process.on("SIGINT", () => { console.log(`\n${C.ylw}⏹ Przerwano${C.rst}`); cleanup(); process.exit(0); });
  const start = Date.now();
  const useOpenRouter = !!process.env.OPENROUTER_KEY;

  // --- parse flags ---
  const raw = process.argv.slice(2);
  const flagPush = raw.includes("--push");
  const flagVerb = raw.includes("--verbose") || raw.includes("-v");
  let rssUrl = null;
  const ri = raw.indexOf("--rss");
  if (ri >= 0 && ri + 1 < raw.length) rssUrl = raw[ri + 1];

  // content flags
  const fv = (flag, dict, def) => { const i = raw.indexOf(flag); if (i >= 0 && i + 1 < raw.length && dict[raw[i + 1]]) return raw[i + 1]; return def; };
  const optFormat  = fv("--format",  FORMATS,  DEF_FORMAT);
  const optPersona = fv("--persona", PERSONAS, DEF_PERSONA);
  const optTone    = fv("--tone",    TONES,    DEF_TONE);
  const optLang    = fv("--lang",    LANGS,    DEF_LANG);

  const skip = new Set(["--push", "--verbose", "-v", "--rss", "--format", "--persona", "--tone", "--lang"]);
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    if (skip.has(raw[i])) { if (raw[i] === "--rss" || raw[i] === "--format" || raw[i] === "--persona" || raw[i] === "--tone" || raw[i] === "--lang") i++; continue; }
    positional.push(raw[i]);
  }

  stepReset(rssUrl ? (flagPush ? 12 : 11) : (flagPush ? 11 : 10));

  const fmtShort = FORMATS[optFormat].label;
  const personaShort = PERSONAS[optPersona].label;
  const toneShort = TONES[optTone].label;
  const langShort = LANGS[optLang].label;

  console.log("╔══════════════════════════════════════════╗");
  console.log(`║     Generator v3${rssUrl ? " RSS" : ""} · ${fmtShort} · ${personaShort} · ${toneShort} · ${langShort}  ║`);
  console.log(`║     Provider: ${useOpenRouter ? "OpenRouter" : "Ollama"}                         ║`);
  console.log("╚══════════════════════════════════════════╝\n");

  let topic, userContent, systemPrompt, rssSourceLink, rssSourceLabel;

  // [1] Topic / RSS
  step(rssUrl ? "Pobieranie RSS" : "Pobieranie tematu");

  if (rssUrl) {
    const parser = new Parser();
    let parsed;
    try {
      parsed = await parser.parseURL(rssUrl);
      console.log(`  → ${parsed.title || rssUrl}: ${parsed.items.length} wpisów`);
    } catch (e) { console.log(`  ${C.red}→ RSS failed: ${e.message}${C.rst}`); cleanup(); process.exit(1); }

    const gen = loadGen();
    const available = parsed.items.filter(it => { const l = it.link || it.guid || it.title; return l && !gen[l]; });
    console.log(`  → Niegenerowane: ${available.length} / ${parsed.items.length}`);
    if (available.length === 0) { console.log(`  ${C.dim}→ Wszystkie już wygenerowane${C.rst}`); cleanup(); process.exit(0); }

    console.log("\n  Wybierz newsa:");
    available.forEach((it, i) => {
      const d = it.pubDate || it.isoDate || "";
      const s = (it.contentSnippet || it.content || "").slice(0, 80).replace(/\n/g, " ");
      console.log(`    ${C.grn}${i + 1}.${C.rst} ${(it.title || "?").slice(0, 90)}`);
      if (d) console.log(`       ${C.dim}${d.slice(0, 30)}${C.rst}`);
      if (s) console.log(`       ${C.dim}"${s}..."${C.rst}`);
    });

    const pick = parseInt(await ask(`\n  Wybierz (1-${available.length}, Enter=1): `), 10);
    const chosen = available[pick - 1] || available[0];
    const cTitle = chosen.title || "Bez tytułu";
    const cSnippet = (chosen.contentSnippet || chosen.content || "").slice(0, 5000);
    const cLink = chosen.link;
    console.log(`\n  → "${cTitle.slice(0, 80)}"`);
    console.log(`  → Treść: ${cSnippet.length} znaków | Link: ${cLink || "brak"}`);

    topic = cTitle;
    const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, rssTitle: cTitle, rssSnippet: cSnippet });
    userContent = bp.user;
    systemPrompt = bp.system;
    rssSourceLink = cLink;
    rssSourceLabel = cTitle;
  } else {
    topic = (positional[0] || "").trim();
    if (!topic) topic = (await ask("  Temat artykułu: ")).trim();
    if (!topic) { topic = "Czym jest dropshipping B2B"; console.log(`  → Domyślny: "${topic}"`); }
    else console.log(`  → "${topic}" (${topic.length} znaków)`);
    const bp = buildPrompt({ format: optFormat, persona: optPersona, tone: optTone, lang: optLang, topic });
    userContent = bp.user;
    systemPrompt = bp.system;
  }

  // [2] Model
  step("Wybór modelu AI");
  let model = (positional[1] || "").trim();
  if (!useOpenRouter) {
    const models = ollamaModels();
    if (models.length === 0) { console.log(`  ${C.red}→ Brak modeli – uruchom Ollamę${C.rst}`); cleanup(); process.exit(1); }
    if (!model) {
      console.log("  Dostępne modele:");
      models.forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
      const p = parseInt(await ask(`  Wybierz (1-${models.length}, Enter=domyślny): `), 10);
      model = models[p - 1] || models[0];
    } else if (!models.includes(model)) { console.log(`  ${C.ylw}→ "${model}" nie znaleziony – używam ${models[0]}${C.rst}`); model = models[0]; }
  } else { if (!model) model = "qwen/qwen-2.5-7b-instruct"; }
  console.log(`  → ${model}`);

  // [3] Dir
  step("Katalog wyjściowy");
  if (!existsSync("articles")) { mkdirSync("articles"); console.log("  → Utworzono articles/"); }
  else console.log("  → articles/ istnieje");

  // [4] Prompt
  step("Prompt");
  console.log(`  → System: ${systemPrompt.length} znaków`);
  console.log(`  → User:   ${userContent.length} znaków`);
  if (flagVerb) { console.log(`\n  ${C.dim}──${systemPrompt.slice(0,150)}...──${C.rst}`); console.log(`\n  ${C.dim}──${userContent.slice(0,150)}...──${C.rst}`); }

  // [5] Warmup
  if (!useOpenRouter) {
    step("Warmup modelu", C.ylw);
    const tw = Date.now();
    try {
      const wup = await fetch("http://localhost:11434/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "OK" }], max_tokens: 1, think: false }),
      });
      if (!wup.ok) { console.log(`  ${C.red}→ ${wup.status}${C.rst}`); cleanup(); process.exit(1); }
      const wj = await wup.json();
      console.log(`  → ${wj.model||model} | ${((Date.now()-tw)/1000).toFixed(1)}s | ${wj.usage?.total_tokens||"?"} tokenów`);
    } catch (e) { console.log(`  ${C.red}→ ${e.cause?.message||e.message}${C.rst}`); cleanup(); process.exit(1); }
  }

  // [6] Generate
  step("Generowanie artykułu", C.ylw);
  const genStart = Date.now();
  let completed = false;
  const statusLoop = (async () => { while (!completed) { await setTimeout(30000); if (completed) break; console.log(`\n  ${C.dim}[⏱ ${((Date.now()-genStart)/1000).toFixed(0)}s] Wciąż generuję...${C.rst}`); } })();
  let result;
  try { result = await generate(model, systemPrompt, userContent, LANGS[optLang].minWords); }
  catch (e) { completed = true; console.log(`  ${C.red}→ ${e.message}${C.rst}`); cleanup(); process.exit(1); }
  completed = true;

  if (!result.data) { console.log(`  ${C.red}→ Nie udało się${C.rst}`); cleanup(); process.exit(1); }
  if (result.issues?.length) console.log(`  ${C.ylw}→ Uwagi: ${result.issues.join(", ")}${C.rst}`);

  // [7] Build HTML
  step("Generowanie dokumentu HTML");
  const extra = rssSourceLink ? { sourceLink: rssSourceLink, sourceLabel: rssSourceLabel, format: optFormat } : { format: optFormat };
  const { html, fname, body, slug, artTitle } = buildHtml(result.data, result.raw, topic, model, extra);
  console.log(`  → ${artTitle.slice(0, 60)} | ${slug}`);
  console.log(`  → Body: ${body.length} zn | HTML: ${html.length} zn (~${Math.ceil(html.length/1024)} KB)`);

  // [8] Save
  step("Zapis pliku");
  writeFileSync(fname, html, "utf8");
  console.log(`  → ${C.grn}${fname}${C.rst} (${(html.length/1024).toFixed(1)} KB)`);

  // [9] generated.json
  if (rssSourceLink) {
    step("generated.json");
    markGen(rssSourceLink, slug);
    console.log(`  → ${rssSourceLink.slice(0, 60)} → ${slug}`);
  }

  // regenerate index + sitemap
  step("Index + Sitemap", C.ylw);
  const idxCount = generateIndex();
  generateSitemap();
  console.log(`  → articles/index.html (${idxCount} artykułów)`);
  console.log(`  → articles/sitemap.xml`);

  // [10] Push (optional)
  if (flagPush) {
    step("Git push", C.ylw);
    const files = rssSourceLink ? "articles/ generated.json" : "articles/";
    gitPush(files, `Add: ${artTitle.slice(0, 60)}`);
  }

  // Done
  step("Podsumowanie", C.grn);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  → ${elapsed}s | Model: ${model} | Body: ${body.length} zn`);
  console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}${C.rst}\n`);
  cleanup();
}
main();
