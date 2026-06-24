import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import Parser from "rss-parser";
import { setTimeout } from "timers/promises";

const FEEDS_FILE = "feeds.json";
const MODEL = "qwen2.5:1.5b";

const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};
function ts() { return new Date().toLocaleTimeString("pl-PL"); }
const verb = process.argv.includes("--verbose") || process.argv.includes("-v");

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
    if (lines.length > 1) {
      return lines.slice(1).map(l => l.trim()).join(" | ");
    }
  } catch {}
  return null;
}

async function main() {
  const start = Date.now();
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     RSS → AI → Blog                      ║");
  console.log("║     Telemetria: KROK po KROKU            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Tryb:     ${verb ? "verbose (pełne dane)" : "normalny"}`);
  console.log(`  Model:    ${MODEL}`);
  console.log(`  Ollama:   ${ollamaPs() || "brak aktywnych modeli"}\n`);

  // [1] Wczytaj feedy
  step("Wczytywanie konfiguracji feedów");
  if (!existsSync(FEEDS_FILE)) {
    log("ERR", `Brak pliku ${FEEDS_FILE}`, C.red);
    process.exit(1);
  }
  const feedsRaw = readFileSync(FEEDS_FILE, "utf8");
  const feeds = JSON.parse(feedsRaw);
  log("INFO", `${feeds.length} feed(ów) wczytanych z ${FEEDS_FILE}`);
  feeds.forEach((f, i) => console.log(`  ${i + 1}. ${f.name || f.url} | lastGuid: ${f.lastGuid ? f.lastGuid.slice(0, 40) + "..." : "BRAK (pierwszy raz)"}`));

  const parser = new Parser();
  let anyNew = false;
  let totalGenerated = 0;

  for (const [fi, feed] of feeds.entries()) {
    // [2] Pobierz RSS
    step(`[Feed ${fi + 1}/${feeds.length}] Pobieranie RSS: ${feed.name || feed.url}`, C.ylw);
    console.log(`  URL: ${feed.url}`);

    let parsed;
    const t0 = Date.now();
    try {
      parsed = await parser.parseURL(feed.url);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  Status: OK (${dt}s)`);
      console.log(`  Tytuł feeda: ${parsed.title || "brak"}`);
      console.log(`  Liczba wpisów: ${parsed.items.length}`);
    } catch (e) {
      console.log(`  ${C.red}Status: BŁĄD${C.rst}`);
      log("ERR", `Feed failed: ${e.message}`, C.red);
      continue;
    }

    if (parsed.items.length === 0) {
      console.log("  → Brak wpisów, pomijam");
      continue;
    }

    // [3] Sprawdź lastGuid
    step(`[Feed ${fi + 1}] Analiza lastGuid`);
    const newest = parsed.items[0];
    const newestGuid = newest.guid || newest.link || newest.title;
    if (!newestGuid) {
      log("WARN", "Brak GUID w najnowszym wpisie", C.ylw);
      continue;
    }
    console.log(`  Najnowszy GUID: ${newestGuid.slice(0, 60)}...`);
    console.log(`  Najnowszy tytuł: ${(newest.title || "").slice(0, 60)}`);

    if (!feed.lastGuid) {
      feed.lastGuid = newestGuid;
      console.log(`  ${C.dim}→ Pierwsze uruchomienie – zapamiętuję GUID i kończę${C.rst}`);
      continue;
    }

    console.log(`  Poprzedni GUID: ${feed.lastGuid.slice(0, 60)}...`);
    const found = parsed.items.findIndex(i => (i.guid || i.link || i.title) === feed.lastGuid);
    if (found === -1) {
      console.log(`  ${C.ylw}→ Poprzedni GUID nie znaleziony w feedzie (mógł wypaść) – przetwarzam wszystkie wpisy${C.rst}`);
    } else {
      console.log(`  → Poprzedni GUID znaleziony na pozycji ${found + 1}/${parsed.items.length}`);
      console.log(`  → Nowe wpisy: ${found} (przed nim)`);
    }

    // [4] Przetwarzaj nowe wpisy
    for (const [ii, item] of parsed.items.entries()) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      if (guid === feed.lastGuid) {
        console.log(`  ${C.dim}→ Osiągnięto poprzedni GUID, koniec nowych wpisów${C.rst}`);
        break;
      }

      // [4a] Info o wpisie
      const itemTitle = item.title || "Bez tytułu";
      const pubDate = item.pubDate || item.isoDate || "?";
      const snippet = (item.contentSnippet || item.content || "").slice(0, 4000);
      console.log(`\n  ── NOWY WPIS #${ii + 1} ──`);
      console.log(`  Tytuł:  ${itemTitle}`);
      console.log(`  Data:   ${pubDate}`);
      console.log(`  GUID:   ${guid.slice(0, 60)}...`);
      console.log(`  Link:   ${item.link || "brak"}`);
      console.log(`  Treść:  ${snippet.length} znaków`);
      anyNew = true;
      totalGenerated++;

      // [4b] Budowa prompta
      console.log(`\n  ──[BUDOWA PROMPTA]──`);
      const prompt = `Jesteś polskim dziennikarzem technologicznym.
Na podstawie poniższego angielskiego newsa napisz artykuł SEO po polsku.

ORYGINALNY NEWS (EN):
Tytuł: ${itemTitle}
Treść: ${snippet}

Zwróć TYLKO czysty JSON (bez znaczników, bez \`\`\`):
{"title": "polski tytuł SEO",
 "desc": "meta description 150-160 znaków",
 "keywords": "słowo1, słowo2, słowo3",
 "body": " pełna treść HTML"}

body: pełny HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Minimum 500 słów. Po polsku.`;
      const promptTokens = Math.ceil(prompt.length / 4);
      console.log(`  Rozmiar prompta: ${prompt.length} znaków (~${promptTokens} tokenów)`);
      if (verb) console.log(`  Treść:\n${prompt.slice(0, 800)}...\n  ${snippet.length > 200 ? `[treść newsa: ${snippet.slice(0, 200)}...]` : ""}`);

      // [4c] Warmup
      console.log(`\n  ──[OLLAMA WARMUP]──`);
      const ollamaState = ollamaPs();
      console.log(`  Ollama przed: ${ollamaState || "brak modelu w pamięci"}`);
      const tw = Date.now();
      try {
        const wup = await fetch("http://localhost:11434/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "user", content: "OK" }],
            max_tokens: 1,
            stream: false,
            think: false,
          }),
        });
        const dtWarm = ((Date.now() - tw) / 1000).toFixed(1);
        if (!wup.ok) { console.log(`  ${C.red}Warmup: ${wup.status}${C.rst}`); continue; }
        const wj = await wup.json();
        console.log(`  Czas:    ${dtWarm}s`);
        console.log(`  Model:   ${wj.model || MODEL}`);
        console.log(`  Tokeny:  ${wj.usage?.total_tokens || "?"}`);
      } catch (e) {
        console.log(`  ${C.red}Warmup failed: ${e.cause?.message || e.message}${C.rst}`);
        continue;
      }

      // [4d] Generowanie
      console.log(`\n  ──[OLLAMA GENEROWANIE]──`);
      const tg = Date.now();
      let raw;
      try {
        const res = await fetch("http://localhost:11434/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 8192,
            stream: false,
            think: false,
          }),
        });
        const dtGen = ((Date.now() - tg) / 1000).toFixed(1);
        console.log(`  Status:  ${res.status} ${res.statusText}`);
        console.log(`  Czas:    ${dtGen}s`);

        if (!res.ok) {
          const errText = await res.text();
          console.log(`  ${C.red}Błąd ${res.status}: ${errText.slice(0, 200)}${C.rst}`);
          continue;
        }
        const j = await res.json();
        raw = j.choices[0].message.content;
        const usage = j.usage || {};
        console.log(`  Wynik:   ${raw.length} znaków`);
        console.log(`  Usage:   ${usage.prompt_tokens || "?"} in → ${usage.completion_tokens || "?"} out (${usage.total_tokens || "?"} total)`);
        if (verb) console.log(`  ──[RAW]──\n${raw.slice(0, 500)}...\n  ──────────`);
      } catch (e) {
        console.log(`  ${C.red}Ollama failed: ${e.cause?.message || e.message}${C.rst}`);
        continue;
      }

      // [4e] Parse JSON
      console.log(`\n  ──[PARSE JSON]──`);
      let data;
      try {
        data = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
        console.log(`  Status:  OK`);
        console.log(`  title:   "${(data?.title || "").slice(0, 60)}"`);
        console.log(`  desc:    "${(data?.desc || "").slice(0, 60)}"`);
        console.log(`  body:    ${(data?.body || "").length} znaków`);
      } catch {
        data = null;
        console.log(`  ${C.ylw}Status:  JSON niepoprawny – używam surowej odpowiedzi${C.rst}`);
      }

      // [4f] Build HTML
      console.log(`\n  ──[HTML]──`);
      const artTitle = data?.title || itemTitle;
      const desc = data?.desc || "";
      const kws = data?.keywords || "";
      let body = (data?.body || raw).replace(/^```html?\n?|```$/gmi, "").trim();
      if (item.link && !body.includes(item.link)) {
        body += `\n\n<h2>Źródło</h2>\n<p><a href="${item.link}" rel="nofollow">${item.link}</a></p>`;
      }
      if (!existsSync("articles")) mkdirSync("articles");
      const slug = artTitle.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      const fname = `articles/${slug}.html`;
      console.log(`  Tytuł:   ${artTitle}`);
      console.log(`  Slug:    ${slug}`);
      console.log(`  Body:    ${body.length} znaków`);

      const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${artTitle}</title>
<meta name="description" content="${desc}">
<meta name="keywords" content="${kws}">
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
<h1>${artTitle}</h1>
<article>${body}</article>
<div class="footer">Artykuł wygenerowany przez AI · źródło: <a href="${item.link || ""}">${item.link || "oryginalny news"}</a> · data: ${new Date().toLocaleDateString("pl-PL")}</div>
</body>
</html>`;

      console.log(`  HTML:    ${html.length} znaków (~${Math.ceil(html.length / 1024)} KB)`);

      // [4g] Zapis
      writeFileSync(fname, html, "utf8");
      console.log(`  ${C.grn}→ ZAPISANO: ${fname}${C.rst}`);
      console.log(`  ${C.cyn}→ https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}${C.rst}`);
    }

    // [5] Update lastGuid
    step(`[Feed ${fi + 1}] Aktualizacja lastGuid`);
    feed.lastGuid = newestGuid;
    console.log(`  Nowy: ${newestGuid.slice(0, 60)}...`);
  }

  // [6] Zapisz feedy
  step("Zapis stanu feedów do feeds.json");
  writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
  console.log(`  → feeds.json zaktualizowany (${feeds.length} feed(ów))`);

  // [7] Git
  if (anyNew) {
    step("Git: commit i push na GitHub", C.ylw);
    console.log(`  Pliki do dodania: articles/ + feeds.json`);
    try {
      const r1 = execSync(`git add articles/ feeds.json`, { cwd: ".", encoding: "utf8" });
      if (r1.trim()) console.log(`  git add: ${r1.trim()}`);
      else console.log(`  git add: OK (no output)`);

      const r2 = execSync(`git commit -m "Auto: ${totalGenerated} artykuł(i) z RSS"`, { cwd: ".", encoding: "utf8" });
      console.log(`  git commit: ${r2.trim()}`);

      console.log(`  ${C.ylw}→ git push...${C.rst}`);
      const r3 = execSync(`git push`, { cwd: ".", encoding: "utf8" });
      console.log(`  git push: ${r3.trim()}`);
      console.log(`  ${C.grn}→ Pushnięte na GitHub${C.rst}`);
      console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/articles/${C.rst}\n`);
    } catch (e) {
      const stderr = e.stderr?.toString().slice(0, 400) || e.message;
      console.log(`  ${C.red}Git error: ${stderr}${C.rst}`);
    }
  } else {
    step("Brak nowych wpisów – nic do roboty");
  }

  // Podsumowanie
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n${C.grn}[${ts()}] [DONE] Czas: ${elapsed}s | Feedów: ${feeds.length} | Wygenerowano: ${totalGenerated}${C.rst}`);
}

main();
