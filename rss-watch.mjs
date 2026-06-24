import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import Parser from "rss-parser";

const FEEDS_FILE = "feeds.json";
const GENERATED = "generated.json";
const MODEL = "qwen2.5:1.5b";
const MAX_ITEMS_PER_FEED = 5;

// --- generated.json ---
function loadGen() { try { return JSON.parse(readFileSync(GENERATED, "utf8")); } catch { return {}; } }
function saveGen(g) { writeFileSync(GENERATED, JSON.stringify(g, null, 2)); }
function isGen(url) { return !!(loadGen()[url]); }
function markGen(url, slug) { const g = loadGen(); g[url] = { slug, date: new Date().toISOString() }; saveGen(g); }

const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};
function esc(s) { return `${s}`.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function safeHref(url) {
  if (!url) return "";
  const u = url.trim().toLowerCase();
  return (u.startsWith("http://") || u.startsWith("https://")) ? url : "";
}
function ts() { return new Date().toLocaleTimeString("pl-PL"); }
const verb = process.argv.includes("--verbose") || process.argv.includes("-v");
const flagReview = process.argv.includes("--review");

let stepNo = 0;
function step(label, color = C.cyn) {
  stepNo++;
  console.log(`\n${color}[${ts()}] [KROK ${stepNo}] ${label}${C.rst}`);
}
function log(tag, msg, color = C.cyn) {
  console.log(`${color}[${ts()}] [${tag}]${C.rst} ${msg}`);
}

function ollamaPs() {
  try {
    const ps = execSync("ollama ps", { encoding: "utf8", timeout: 3000 }).trim();
    const lines = ps.split("\n").filter(l => l.trim());
    if (lines.length > 1) return lines.slice(1).map(l => l.trim()).join(" | ");
  } catch {}
  return null;
}

// --- prompts ---
const SYSTEM = `Jesteś polskim dziennikarzem technologicznym i ekspertem SEO. Przetwarzasz angielskie newsy na polskie artykuły.

Każda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu przed ani po.

Przykład poprawnej odpowiedzi:
{"title":"Sztuczna inteligencja zmienia e-commerce – nowy raport","desc":"Najnowszy raport pokazuje jak AI rewolucjonizuje handel elektroniczny. Automatyzacja, personalizacja i nowe narzędzia.","keywords":"AI, e-commerce, sztuczna inteligencja, automatyzacja","body":"<h2>Rewolucja AI w e-commerce</h2><p>Sztuczna inteligencja zmienia sposób w jaki... <strong>kluczowe trendy</strong> obejmują...</p><h2>Najważniejsze wnioski</h2><ul><li>Personalizacja ofert</li><li>Automatyzacja obsługi klienta</li></ul><h2>Podsumowanie</h2><p>Firmy które nie wdrożą AI...</p>"}

body: pełny HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Minimum 300 słów. Po polsku.`;

function userPrompt(title, snippet) {
  return `Napisz artykuł SEO po polsku na podstawie tego angielskiego newsa.

ORYGINALNY NEWS (EN):
Tytuł: ${title}
Treść: ${snippet}

Zwracasz WYŁĄCZNIE czysty JSON z polami: title, desc, keywords, body.`;
}

// --- validation ---
function validate(data) {
  const issues = [];
  const body = data?.body || "";
  const words = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const hasH2 = /<h2[^>]*>/i.test(body);
  const desc = (data?.desc || "").trim();

  if (!data?.title) issues.push("brak tytułu");
  if (!data?.body) issues.push("brak treści");
  if (words < 150) issues.push(`mało słów (${words})`);
  if (!hasH2) issues.push("brak <h2>");
  if (desc.length < 40) issues.push("meta desc za krótkie");

  return { ok: issues.length === 0, issues, words, hasH2 };
}

// --- streaming reader ---
async function streamResponse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let tick = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const json = t.slice(5).trim();
      if (json === "[DONE]") continue;
      try {
        const p = JSON.parse(json);
        const delta = p.choices?.[0]?.delta?.content;
        if (delta) { full += delta; tick++; }
      } catch {}
    }
    if (tick > 0 && tick % 50 === 0) process.stdout.write(`\r    → ${full.length} znaków...`);
  }
  process.stdout.write(`\r    → ${full.length} znaków (gotowe)    \n`);
  return full;
}

// --- generation with retry ---
async function generate(itemTitle, snippet, attempt = 0) {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(itemTitle, snippet) },
    ],
    temperature: 0.3,
    max_tokens: 8192,
    stream: true,
    response_format: { type: "json_object" },
    think: false,
  };

  if (attempt > 0) console.log(`    ${C.ylw}RETRY ${attempt + 1}/2${C.rst}`);

  const t0 = Date.now();
  const res = await fetch("http://localhost:11434/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const raw = await streamResponse(res);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`    → ${dt}s | ${res.status} | ${raw.length} znaków`);

  let data;
  try { data = JSON.parse(raw); } catch {
    try {
      const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      data = JSON.parse(cleaned);
    } catch {
      data = null;
    }
  }

  if (!data) {
    console.log(`    ${C.ylw}→ JSON niepoprawny${C.rst}`);
    return { data: null, raw };
  }

  console.log(`    → title: "${(data.title || "").slice(0, 50)}"`);
  console.log(`    → body:  ${(data.body || "").length} znaków`);

  const v = validate(data);
  console.log(`    → Słowa: ${v.words} | H2: ${v.hasH2 ? "✅" : "❌"}`);

  if (!v.ok && attempt < 1) {
    console.log(`    ${C.ylw}→ Walidacja: ${v.issues.join(", ")} — ponawiam${C.rst}`);
    return generate(itemTitle, snippet, attempt + 1);
  }

  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- main ---
async function main() {
  const start = Date.now();
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     RSS → AI → Blog v2                   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Tryb:   ${verb ? "verbose" : "normalny"}`);
  console.log(`  Model:  ${MODEL} | Streaming + JSON mode | Temp: 0.3`);
  console.log(`  Ollama: ${ollamaPs() || "brak aktywnych modeli"}\n`);

  step("Wczytywanie konfiguracji feedów");
  if (!existsSync(FEEDS_FILE)) { log("ERR", `Brak ${FEEDS_FILE}`, C.red); process.exit(1); }
  const feeds = JSON.parse(readFileSync(FEEDS_FILE, "utf8"));
  log("INFO", `${feeds.length} feed(ów)`);
  feeds.forEach((f, i) => console.log(`  ${i + 1}. ${f.name || f.url} | lastGuid: ${f.lastGuid ? f.lastGuid.slice(0, 40) + "..." : "BRAK"}`));

  const parser = new Parser();
  let anyNew = false;
  let totalGenerated = 0;

  for (const [fi, feed] of feeds.entries()) {
    step(`[Feed ${fi + 1}/${feeds.length}] Pobieranie: ${feed.name || feed.url}`, C.ylw);
    console.log(`  URL: ${feed.url}`);

    let parsed;
    const t0 = Date.now();
    try {
      parsed = await parser.parseURL(feed.url);
      console.log(`  OK (${((Date.now() - t0) / 1000).toFixed(1)}s) | ${parsed.items.length} wpisów`);
    } catch (e) {
      log("ERR", `Feed failed: ${e.message}`, C.red);
      continue;
    }

    if (parsed.items.length === 0) { console.log("  → Brak wpisów"); continue; }

    step(`[Feed ${fi + 1}] Analiza lastGuid`);
    const newest = parsed.items[0];
    const newestGuid = newest.guid || newest.link || newest.title;
    if (!newestGuid) { log("WARN", "Brak GUID"); continue; }

    console.log(`  Najnowszy: ${(newest.title || "").slice(0, 60)}`);

    if (!feed.lastGuid) {
      feed.lastGuid = newestGuid;
      console.log(`  ${C.dim}→ Pierwsze uruchomienie – zapamiętuję GUID${C.rst}`);
      continue;
    }

    const foundIdx = parsed.items.findIndex(i => (i.guid || i.link || i.title) === feed.lastGuid);
    if (foundIdx === -1) {
      console.log(`  ${C.ylw}→ GUID nie znaleziony – max ${MAX_ITEMS_PER_FEED} najnowszych${C.rst}`);
    } else {
      console.log(`  → GUID na pozycji ${foundIdx + 1}/${parsed.items.length} | nowych: ${foundIdx}`);
    }

    let feedGenerated = 0;
    for (const [ii, item] of parsed.items.entries()) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      if (guid === feed.lastGuid) { console.log(`  ${C.dim}→ Koniec nowych wpisów${C.rst}`); break; }
      if (foundIdx === -1 && feedGenerated >= MAX_ITEMS_PER_FEED) {
        console.log(`  ${C.dim}→ Limit ${MAX_ITEMS_PER_FEED} osiągnięty${C.rst}`);
        break;
      }

      // check generated.json (skip already-done items, even from manual runs)
      const itemLink = item.link || item.guid;
      const genDb = loadGen();
      if (itemLink && genDb[itemLink]) {
        console.log(`  ${C.dim}→ Już wygenerowany (${genDb[itemLink].slug}) – pomijam${C.rst}`);
        continue;
      }

      anyNew = true;
      totalGenerated++;
      feedGenerated++;

      const itemTitle = item.title || "Bez tytułu";
      const snippet = (item.contentSnippet || item.content || "").slice(0, 4000);

      console.log(`\n  ── NOWY #${ii + 1}: ${itemTitle.slice(0, 80)} ──`);
      console.log(`  Treść: ${snippet.length} znaków | Link: ${item.link || "brak"}`);

      // --review: interactive prompt
      if (flagReview) {
        const ans = await new Promise(r => {
          const rl2 = createInterface({ input: process.stdin, output: process.stdout });
          rl2.question(`  ${C.ylw}[g]eneruj / [p]omiń / [q]wyjdź?${C.rst} `, a => { rl2.close(); r(a.trim().toLowerCase()); });
        });
        if (ans === "q") { console.log(`  → Wyjście`); break; }
        if (ans === "p" || ans === "n" || ans === "") {
          console.log(`  → Pominięto`);
          totalGenerated--; feedGenerated--;
          continue;
        }
        console.log(`  → Generuję...`);
      }

      // Warmup (first item only — model stays loaded)
      if (feedGenerated === 1) {
        console.log(`  ${C.dim}── warmup ──${C.rst}`);
        const tw = Date.now();
        try {
          const wup = await fetch("http://localhost:11434/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "OK" }], max_tokens: 1, think: false }),
          });
          const wj = await wup.json();
          console.log(`  ${C.dim}→ ${((Date.now() - tw) / 1000).toFixed(1)}s | ${wj.usage?.total_tokens || "?"} tokenów${C.rst}`);
        } catch (e) {
          console.log(`  ${C.red}Warmup failed${C.rst}`);
        }
      }

      // Generate
      console.log(`  ${C.dim}── generowanie ──${C.rst}`);
      let gen;
      try {
        gen = await generate(itemTitle, snippet);
      } catch (e) {
        log("ERR", `Ollama: ${e.message}`, C.red);
        continue;
      }

      if (!gen.data) {
        console.log(`  ${C.red}→ Generowanie nieudane${C.rst}`);
        continue;
      }

      if (gen.issues?.length) {
        console.log(`  ${C.ylw}→ Uwagi: ${gen.issues.join(", ")}${C.rst}`);
      }

      // Build HTML
      const artTitle = gen.data.title || itemTitle;
      const desc = gen.data.desc || "";
      const kws = gen.data.keywords || "";
      let body = (gen.data.body || gen.raw || "").replace(/```html?\n?|```$/gmi, "").trim();
      const href = safeHref(item.link);
      if (href && !body.includes(href)) {
        body += `\n\n<h2>Źródło</h2>\n<p><a href="${href}" rel="nofollow">${esc(item.link)}</a></p>`;
      }

      if (!existsSync("articles")) mkdirSync("articles");
      const slug = artTitle.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      const fname = `articles/${slug}.html`;

      console.log(`  → Slug: ${slug} | Body: ${body.length} znaków`);

      const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(artTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(kws)}">
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
<h1>${esc(artTitle)}</h1>
<article>${body}</article>
<div class="footer">Artykuł wygenerowany przez AI · źródło: <a href="${safeHref(item.link)}" rel="nofollow">${esc(item.link || "oryginalny news")}</a> · data: ${new Date().toLocaleDateString("pl-PL")}</div>
</body>
</html>`;

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

  if (totalGenerated > 0) {
    step("Git: commit i push", C.ylw);
    try {
      const a = execSync(`git add articles/ feeds.json generated.json`, { cwd: ".", encoding: "utf8" });
      if (a.trim()) console.log(`  add: ${a.trim()}`);
      const c = execSync(`git commit -m "Auto: ${totalGenerated} artykuł(i) z RSS"`, { cwd: ".", encoding: "utf8" });
      console.log(`  commit: ${c.trim()}`);
      console.log(`  ${C.ylw}→ push...${C.rst}`);
      const p = execSync(`git push`, { cwd: ".", encoding: "utf8" });
      console.log(`  push: ${p.trim()}`);
      console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/articles/${C.rst}\n`);
    } catch (e) {
      log("ERR", `Git: ${e.stderr?.toString().slice(0, 300) || e.message}`, C.red);
    }
  } else {
    step("Brak nowych wpisów – nic do roboty");
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${C.grn}[${ts()}] [DONE] ${elapsed}s | Feedów: ${feeds.length} | Artykułów: ${totalGenerated}${C.rst}`);
}

main();
