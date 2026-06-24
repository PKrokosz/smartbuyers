import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { setTimeout } from "timers/promises";
import Parser from "rss-parser";

// --- helpers ---
const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};
function esc(s) { return `${s}`.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function ts() { return new Date().toLocaleTimeString("pl-PL"); }
function cleanup() { try { rl.close(); } catch {} }

let stepNo = 0, TOTAL = 9;
function step(label, color = C.cyn) {
  stepNo++;
  console.log(`${color}[${ts()}] [${stepNo}/${TOTAL}] ${label}${C.rst}`);
}

function ollamaModels() {
  try {
    const out = execSync("ollama list", { encoding: "utf8", timeout: 5000 });
    return out.trim().split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
}

// --- generated.json ---
const GENERATED = "generated.json";
function loadGenerated() { try { return JSON.parse(readFileSync(GENERATED, "utf8")); } catch { return {}; } }
function saveGenerated(g) { writeFileSync(GENERATED, JSON.stringify(g, null, 2)); }
function isGenerated(url) { return !!(loadGenerated()[url]); }
function markGenerated(url, slug) {
  const g = loadGenerated();
  g[url] = { slug, date: new Date().toISOString() };
  saveGenerated(g);
}

// --- prompts ---
const S_RSS = `Jesteś polskim dziennikarzem technologicznym i ekspertem SEO. Przetwarzasz angielskie newsy na polskie artykuły.

Każda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu.

Przykład poprawnej odpowiedzi:
{"title":"Sztuczna inteligencja zmienia e-commerce – nowy raport","desc":"Najnowszy raport o AI w handlu. Automatyzacja, personalizacja i nowe narzędzia dla sprzedawców.","keywords":"AI, e-commerce, automatyzacja, sztuczna inteligencja","body":"<h2>AI rewolucjonizuje e-commerce</h2><p>Sztuczna inteligencja zmienia sposób w jaki... <strong>kluczowe trendy</strong> to...</p><h2>Wnioski</h2><ul><li>Personalizacja</li><li>Automatyzacja</li></ul><h2>Podsumowanie</h2><p>Firmy które wdrożą AI zyskają...</p>"}

body: HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Min. 300 słów. Po polsku.`;

const S_TOPIC = `Jesteś polskim ekspertem SEO i dziennikarzem. Piszesz na bloga B2B o dropshippingu, e-commerce i nowych technologiach.

Każda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu.

Przykład poprawnej odpowiedzi:
{"title":"Jak zacząć dropshipping B2B w 2025 roku","desc":"Kompletny poradnik dropshippingu B2B. Wybór dostawców, automatyzacja sprzedaży i skalowanie.","keywords":"dropshipping B2B, e-commerce, sprzedaż online","body":"<h2>Wprowadzenie</h2><p>Dropshipping B2B to model, w którym... <strong>kluczowe korzyści</strong> to...</p><h2>Jak zacząć</h2><p>Pierwszym krokiem jest...</p><ul><li>Zbadaj rynek</li><li>Znajdź dostawców</li></ul><h2>Podsumowanie</h2><p>Dropshipping B2B oferuje ogromny potencjał...</p>"}

body: HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Min. 500 słów. Po polsku.`;

function promptRss(title, snippet) {
  return `Napisz artykuł SEO po polsku na podstawie newsa.\n\nORYGINALNY NEWS:\nTytuł: ${title}\nTreść: ${snippet}\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
}
function promptTopic(topic) {
  return `Napisz artykuł SEO na bloga B2B.\n\nTemat: "${topic}"\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
}

// --- validation ---
function validate(data, raw) {
  const issues = [];
  const b = data?.body || raw || "";
  const words = b.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const hasH2 = /<h2[^>]*>/i.test(b);
  const d = (data?.desc || "").trim();
  if (!data?.title) issues.push("brak tytułu");
  if (!data?.body) issues.push("brak treści");
  if (words < 200) issues.push(`słów ${words} (min 200)`);
  if (!hasH2) issues.push("brak <h2>");
  if (d.length < 40) issues.push(`desc za krótkie (${d.length})`);
  return { ok: issues.length === 0, issues, words, hasH2 };
}

// --- streaming ---
async function streamResponse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "", tick = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const j = t.slice(5).trim();
      if (j === "[DONE]") continue;
      try {
        const p = JSON.parse(j);
        const d = p.choices?.[0]?.delta?.content;
        if (d) { full += d; tick++; }
      } catch {}
    }
    if (tick > 0 && tick % 40 === 0) process.stdout.write(`\r  → Strumień: ${full.length} znaków...`);
  }
  process.stdout.write(`\r  → Strumień: ${full.length} znaków (gotowe)    \n`);
  return full;
}

// --- generation ---
async function generate(model, systemPrompt, userContent, attempt = 0) {
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
  const v = validate(data, raw);
  console.log(`  → Słowa: ${v.words} | H2: ${v.hasH2?"✅":"❌"} | Desc: ${(data.desc||"").length} znaków`);
  if (!v.ok && attempt < 1) { console.log(`  ${C.ylw}→ ${v.issues.join(", ")} – retry${C.rst}`); return generate(model, systemPrompt, userContent, attempt + 1); }
  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- html ---
function buildHtml(data, raw, topic, model, extra = {}) {
  const t = data?.title || topic;
  const d = data?.desc || "";
  const k = data?.keywords || "";
  let body = (data?.body || raw || "").replace(/```html?\n?|```$/gmi, "").trim();
  if (extra.sourceLink && !body.includes(extra.sourceLink)) {
    body += `\n\n<h2>Źródło</h2>\n<p><a href="${extra.sourceLink}" rel="nofollow">${esc(extra.sourceLabel || extra.sourceLink)}</a></p>`;
  }
  const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0, 60);
  const fname = `articles/${slug}.html`;
  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t)}</title>
<meta name="description" content="${esc(d)}">
<meta name="keywords" content="${esc(k)}">
<style>
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:2rem auto;padding:0 1.5rem;line-height:1.7;color:#222}
h1{margin-bottom:.5rem}
h2{margin-top:2rem;border-bottom:2px solid #eee;padding-bottom:.3rem}
h3{margin-top:1.5rem}
p{margin:.8rem 0}
ul,ol{margin:.8rem 0;padding-left:1.5rem}
li{margin:.3rem 0}
img{max-width:100%;height:auto;border-radius:8px;margin:1rem 0}
blockquote{border-left:4px solid #0366d6;padding:.5rem 1rem;color:#555;background:#f8f9fa;border-radius:0 8px 8px 0}
pre,code{background:#f4f4f4;border-radius:4px;padding:.1rem .3rem;font-size:.9em}
pre{padding:1rem;overflow-x:auto}
pre code{padding:0;background:none}
a{color:#0366d6}
.footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #eee;font-size:.85rem;color:#777}
</style>
</head>
<body>
<h1>${esc(t)}</h1>
<article>${body}</article>
<div class="footer">AI · model: ${model} · data: ${new Date().toLocaleDateString("pl-PL")}${extra.sourceLink ? ` · źródło: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a>` : ""}</div>
</body>
</html>`;
  return { html, fname, body, slug, artTitle: t };
}

// --- git ---
function gitPush(files, msg) {
  log("GIT", `Commit + push...`, C.ylw);
  try {
    execSync(`git add ${files}`, { cwd: ".", encoding: "utf8" });
    const c = execSync(`git commit -m "${msg}"`, { cwd: ".", encoding: "utf8" });
    console.log(`  → ${c.toString().trim()}`);
    execSync(`git push`, { cwd: ".", encoding: "utf8" });
    log("GIT", "Pushnięte ✅", C.grn);
    return true;
  } catch (e) {
    log("GIT", `Błąd: ${e.stderr?.toString().slice(0, 200) || e.message}`, C.red);
    return false;
  }
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
  const skip = new Set(["--push", "--verbose", "-v", "--rss"]);
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    if (skip.has(raw[i])) { if (raw[i] === "--rss") i++; continue; }
    positional.push(raw[i]);
  }
  // --- end flags ---

  TOTAL = rssUrl ? 10 : 9;
  if (flagPush) TOTAL++;

  console.log("╔══════════════════════════════════════╗");
  console.log(`║     Generator v3${rssUrl ? " (RSS)" : ""}${flagPush ? " +push" : ""}              ║`);
  console.log(`║     Provider: ${useOpenRouter ? "OpenRouter" : "Ollama"}                   ║`);
  console.log("╚══════════════════════════════════════╝\n");

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

    const gen = loadGenerated();
    const available = parsed.items.filter(it => {
      const link = it.link || it.guid || it.title;
      return link && !gen[link];
    });
    console.log(`  → Niegenerowane: ${available.length} / ${parsed.items.length}`);

    if (available.length === 0) {
      console.log(`  ${C.dim}→ Wszystkie newsy już wygenerowane${C.rst}`);
      cleanup(); process.exit(0);
    }

    console.log("\n  Wybierz newsa:");
    available.forEach((it, i) => {
      const d = it.pubDate || it.isoDate || "";
      const snippet = (it.contentSnippet || it.content || "").slice(0, 80).replace(/\n/g, " ");
      console.log(`    ${C.grn}${i + 1}.${C.rst} ${(it.title || "?").slice(0, 90)}`);
      if (d) console.log(`       ${C.dim}${d.slice(0, 30)}${C.rst}`);
      if (snippet) console.log(`       ${C.dim}"${snippet}..."${C.rst}`);
    });

    const pick = parseInt(await ask(`\n  Wybierz (1-${available.length}, Enter=1): `), 10);
    const chosen = available[pick - 1] || available[0];
    const cTitle = chosen.title || "Bez tytułu";
    const cSnippet = (chosen.contentSnippet || chosen.content || "").slice(0, 5000);
    const cLink = chosen.link;
    console.log(`\n  → "${cTitle.slice(0, 80)}"`);
    console.log(`  → Treść: ${cSnippet.length} znaków | Link: ${cLink || "brak"}`);

    topic = cTitle;
    userContent = promptRss(cTitle, cSnippet);
    systemPrompt = S_RSS;
    rssSourceLink = cLink;
    rssSourceLabel = cTitle;
  } else {
    topic = (positional[0] || "").trim();
    if (!topic) topic = (await ask("  Temat artykułu: ")).trim();
    if (!topic) { topic = "Czym jest dropshipping B2B na platformie SelleeTools"; console.log(`  → Domyślny: "${topic}"`); }
    else console.log(`  → "${topic}" (${topic.length} znaków)`);
    userContent = promptTopic(topic);
    systemPrompt = S_TOPIC;
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
  console.log(`  → System: ${systemPrompt.length} znaków (~${Math.ceil(systemPrompt.length/4)} tokenów)`);
  console.log(`  → User:   ${userContent.length} znaków (~${Math.ceil(userContent.length/4)} tokenów)`);
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
  try { result = await generate(model, systemPrompt, userContent); }
  catch (e) { completed = true; console.log(`  ${C.red}→ ${e.message}${C.rst}`); cleanup(); process.exit(1); }
  completed = true;

  if (!result.data) { console.log(`  ${C.red}→ Nie udało się${C.rst}`); cleanup(); process.exit(1); }
  if (result.issues?.length) console.log(`  ${C.ylw}→ Uwagi: ${result.issues.join(", ")}${C.rst}`);

  // [7] Build HTML
  step("Generowanie dokumentu HTML");
  const extra = rssSourceLink ? { sourceLink: rssSourceLink, sourceLabel: rssSourceLabel } : {};
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
    markGenerated(rssSourceLink, slug);
    console.log(`  → ${rssSourceLink.slice(0, 60)} → ${slug}`);
  }

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
