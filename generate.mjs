import { writeFileSync, mkdirSync, existsSync } from "fs";
import { createInterface } from "readline";
import { setTimeout } from "timers/promises";

const MODELS = [
  "qwen2.5:latest",
  "qwen2.5:1.5b",
  "qwen3.5:4b",
  "qwen3.5:2b",
  "qwen3.5:0.8b",
  "(inny – wpisz ręcznie)",
];

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function main() {
  const start = Date.now();
  const useOpenRouter = !!process.env.OPENROUTER_KEY;

  console.log("╔══════════════════════════════════════╗");
  console.log("║     Generator artykułów SEO          ║");
  console.log(`║     Provider: ${useOpenRouter ? "OpenRouter" : "Ollama lokalnie"}           ║`);
  console.log("╚══════════════════════════════════════╝\n");

  let topic = (process.argv[2] || "").trim();
  if (!topic) topic = (await ask("Temat artykułu: ")).trim();
  if (!topic) { topic = "Czym jest dropshipping B2B na platformie SelleeTools"; console.log(`Używam domyślnego: "${topic}"`); }

  let model = (process.argv[3] || "").trim();
  if (!model) {
    console.log("\nWybierz model:");
    MODELS.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
    const pick = parseInt(await ask(`\nWybierz (1-${MODELS.length}): `), 10);
    if (pick > 0 && pick <= MODELS.length) {
      model = MODELS[pick - 1];
      if (model === "(inny – wpisz ręcznie)") model = await ask("Nazwa modelu: ");
    } else {
      model = "qwen2.5:latest";
    }
  }
  if (model.startsWith("qwen3.5")) console.log("ℹ️  qwen3.5 z `think:false` (wyłączony reasoning)");

  if (!existsSync("articles")) mkdirSync("articles");

  const PROMPT = `Jesteś ekspertem SEO. Napisz artykuł na blog.
Temat: "${topic}"

Zwróć TYLKO czysty JSON (bez znaczników, bez \`\`\`):
{"title": "polski tytuł SEO",
 "desc": "meta description 150-160 znaków",
 "keywords": "słowo1, słowo2, słowo3",
 "body": " pełna treść HTML"}

body: pełny HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Minimum 1000 słów. Po polsku.`;

  function ts() { return new Date().toLocaleTimeString("pl-PL"); }
  const url = useOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "http://localhost:11434/v1/chat/completions";
  const headers = { "Content-Type": "application/json" };
  if (useOpenRouter) headers["Authorization"] = `Bearer ${process.env.OPENROUTER_KEY}`;

  console.log(`[${ts()}] [INFO]  Provider: ${useOpenRouter ? "OpenRouter" : "Ollama"} | Model: ${model}`);
  console.log(`[${ts()}] [INFO]  Wysyłam zapytanie...`);

  const ac = new AbortController();
  let prompted = false;

  const statusLoop = (async () => {
    while (!ac.signal.aborted) {
      await setTimeout(30000);
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      if (!prompted && elapsed >= 120) {
        prompted = true;
        const answer = await ask(`\n[${ts()}] [WAIT]  Generowanie trwa już ${elapsed}s.\n        Naciśnij Enter aby czekać, lub wpisz "q" i Enter aby przerwać: `);
        if (answer.trim().toLowerCase() === "q") {
          ac.abort();
          console.log(`[${ts()}] [INFO]  Przerwano przez użytkownika`);
          process.exit(0);
        }
        console.log(`[${ts()}] [INFO]  Kontynuuję...\n`);
      } else {
        console.log(`[${ts()}] [INFO]  Generowanie trwa... (${elapsed}s)`);
      }
    }
  })();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: PROMPT }],
        temperature: 0.7,
        max_tokens: 8192,
        ...(useOpenRouter ? {} : { think: false }),
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") {
      console.log(`[${ts()}] [INFO]  Przerwano przez użytkownika`);
    } else {
      console.log(`[${ts()}] [ERR]  Błąd połączenia: ${e.cause?.message || e.message}`);
    }
    process.exit(1);
  } finally {
    ac.abort();
  }

  if (!res.ok) {
    const err = await res.text();
    console.log(`[${ts()}] [ERR]  Błąd ${res.status}: ${err.slice(0, 200)}`);
    process.exit(1);
  }

  const raw = (await res.json()).choices[0].message.content;
  console.log(`[${ts()}] [OK]   Odpowiedź: ${raw.length} znaków`);

  let data;
  try {
    data = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    console.log(`[${ts()}] [OK]   JSON sparowany: title="${data?.title?.slice(0, 60)}..."`);
  } catch {
    data = null;
    console.log(`[${ts()}] [WARN] JSON niepoprawny, używam surowej odpowiedzi`);
  }

  const title = data?.title || topic;
  const desc = data?.desc || "";
  const kws = data?.keywords || "";
  const body = (data?.body || raw).replace(/^```html?\n?|```$/gmi, "").trim();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const fname = `articles/${slug}.html`;

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
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
<h1>${title}</h1>
<article>${body}</article>
<div class="footer">Artykuł wygenerowany przez AI · data: ${new Date().toLocaleDateString("pl-PL")}</div>
</body>
</html>`;

  writeFileSync(fname, html, "utf8");
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${ts()}] [OK]   Zapisano -> ${fname}`);
  console.log(`[${ts()}] [DONE] Czas: ${elapsed}s | Rozmiar: ${body.length} znaków`);
  console.log(`\n🔗 https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}\n`);
  rl.close();
}
main();
