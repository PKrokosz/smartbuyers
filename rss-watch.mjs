import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import Parser from "rss-parser";

const FEEDS_FILE = "feeds.json";
const MODEL = "qwen2.5:1.5b";

const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};

function ts() {
  return new Date().toLocaleTimeString("pl-PL");
}

function log(tag, msg, color = C.cyn) {
  console.log(`${color}[${ts()}] [${tag}]${C.rst} ${msg}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     RSS → AI → Blog                      ║");
  console.log("╚══════════════════════════════════════════╝\n");

  if (!existsSync(FEEDS_FILE)) {
    log("ERR", `Brak ${FEEDS_FILE}`, C.red);
    process.exit(1);
  }
  const feeds = JSON.parse(readFileSync(FEEDS_FILE, "utf8"));
  log("INFO", `Wczytano ${feeds.length} feed(ów)`);

  const parser = new Parser();
  let anyNew = false;

  for (const feed of feeds) {
    log("RSS", `Pobieram: ${feed.name || feed.url}...`, C.ylw);

    let parsed;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (e) {
      log("ERR", `Feed failed: ${e.message}`, C.red);
      continue;
    }

    log("RSS", `${parsed.items.length} wpisów`, C.grn);
    if (parsed.items.length === 0) continue;

    const newest = parsed.items[0];
    const newestGuid = newest.guid || newest.link || newest.title;
    if (!newestGuid) {
      log("WARN", "Brak GUID w feedzie", C.ylw);
      continue;
    }

    if (!feed.lastGuid) {
      feed.lastGuid = newestGuid;
      log("RSS", `Pierwsze uruchomienie, zapamiętuję najnowszy: ${(newest.title || "").slice(0, 60)}`, C.dim);
      continue;
    }

    for (const item of parsed.items) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;
      if (guid === feed.lastGuid) break;

      anyNew = true;
      const title = item.title || "Bez tytułu";
      const snippet = (item.contentSnippet || item.content || "").slice(0, 4000);
      log("NEW", `${title.slice(0, 80)}`, C.grn);

      const prompt = `Jesteś polskim dziennikarzem technologicznym.
Na podstawie poniższego angielskiego newsa napisz artykuł SEO po polsku.

ORYGINALNY NEWS (EN):
Tytuł: ${title}
Treść: ${snippet}

Zwróć TYLKO czysty JSON (bez znaczników, bez \`\`\`):
{"title": "polski tytuł SEO",
 "desc": "meta description 150-160 znaków",
 "keywords": "słowo1, słowo2, słowo3",
 "body": " pełna treść HTML"}

body: pełny HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Minimum 500 słów. Po polsku.`;

      log("OLLAMA", "Generuję artykuł...", C.ylw);

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
        await wup.json();
      } catch (e) {
        log("ERR", `Ollama niedostępna: ${e.cause?.message || e.message}`, C.red);
        continue;
      }

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
        if (!res.ok) {
          log("ERR", `Ollama błąd ${res.status}`, C.red);
          continue;
        }
        raw = (await res.json()).choices[0].message.content;
        log("OK", `${raw.length} znaków`, C.grn);
      } catch (e) {
        log("ERR", `Ollama failed: ${e.cause?.message || e.message}`, C.red);
        continue;
      }

      let data;
      try {
        data = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
      } catch {
        data = null;
      }

      const artTitle = data?.title || title;
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

      writeFileSync(fname, html, "utf8");
      log("OK", `Zapisano -> ${fname}`, C.grn);
    }

    feed.lastGuid = newestGuid;
    log("RSS", `Nowy lastGuid: ${newestGuid.slice(0, 50)}...`, C.dim);
  }

  writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
  log("INFO", "Stan feedów zapisany");

  if (anyNew) {
    log("GIT", "Commit + push...", C.ylw);
    try {
      execSync(`git add articles/ feeds.json`, { cwd: "." });
      execSync(`git commit -m "Auto: artykuł z RSS"`, { cwd: "." });
      execSync(`git push`, { cwd: "." });
      log("GIT", "Pushnięte", C.grn);
      console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/articles/${C.rst}\n`);
    } catch (e) {
      log("ERR", `Git failed: ${e.stderr?.toString().slice(0, 200) || e.message}`, C.red);
    }
  } else {
    log("INFO", "Brak nowych wpisów");
  }
}

main();
