import { writeFileSync, mkdirSync, existsSync } from "fs";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { setTimeout } from "timers/promises";

// --- helpers ---
const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};
function esc(s) { return `${s}`.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function ts() { return new Date().toLocaleTimeString("pl-PL"); }

let stepNo = 0;
let TOTAL = 9;
function step(label, color = C.cyn) {
  stepNo++;
  console.log(`${color}[${ts()}] [${stepNo}/${TOTAL}] ${label}${C.rst}`);
}

function cleanup() { try { rl.close(); } catch {} }

function ollamaModels() {
  try {
    const out = execSync("ollama list", { encoding: "utf8", timeout: 5000 });
    return out.trim().split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

// --- prompts ---
const SYSTEM = `Jesteś polskim ekspertem SEO i dziennikarzem. Piszesz na bloga B2B o dropshippingu, e-commerce i nowych technologiach.

Każda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu przed ani po.

Przykład poprawnej odpowiedzi:
{"title":"Jak zacząć dropshipping B2B w 2025 roku","desc":"Kompletny poradnik dropshippingu B2B. Wybór dostawców, automatyzacja sprzedaży i skalowanie na marketplace.","keywords":"dropshipping B2B, e-commerce, sprzedaż online","body":"<h2>Wprowadzenie</h2><p>Dropshipping B2B to model, w którym... <strong>kluczowe korzyści</strong> to...</p><h2>Jak zacząć</h2><p>Pierwszym krokiem jest wybór niszy...</p><ul><li>Zbadaj rynek</li><li>Znajdź dostawców</li><li>Zautomatyzuj procesy</li></ul><h2>Podsumowanie</h2><p>Dropshipping B2B oferuje ogromny potencjał wzrostu...</p>"}

body: pełny HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Minimum 500 słów. Po polsku.`;

function userPrompt(topic) {
  return `Napisz artykuł SEO na bloga B2B.\n\nTemat: "${topic}"\n\nZwracasz WYŁĄCZNIE czysty JSON z polami: title, desc, keywords, body.`;
}

// --- validation ---
function validate(data, raw) {
  const issues = [];
  const body = data?.body || raw || "";
  const words = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const hasH2 = /<h2[^>]*>/i.test(body);
  const desc = (data?.desc || "").trim();

  if (!data?.title) issues.push("brak tytułu");
  if (!data?.body) issues.push("brak treści (body)");
  if (words < 250) issues.push(`za mało słów (${words}, min 250)`);
  if (!hasH2) issues.push("brak <h2>");
  if (desc.length < 50) issues.push(`meta desc za krótkie (${desc.length} znaków)`);

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
        if (delta) {
          full += delta;
          tick++;
          if (tick % 40 === 0) process.stdout.write(`\r  → Strumień: ${full.length} znaków...`);
        }
      } catch {}
    }
  }
  process.stdout.write(`\r  → Strumień: ${full.length} znaków (gotowe)    \n`);
  return full;
}

// --- generation with retry ---
async function generate(model, topic, attempt = 0) {
  const isOllama = !process.env.OPENROUTER_KEY;
  const url = isOllama
    ? "http://localhost:11434/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
  const headers = { "Content-Type": "application/json" };
  if (!isOllama) headers["Authorization"] = `Bearer ${process.env.OPENROUTER_KEY}`;

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(topic) },
    ],
    temperature: 0.3,
    max_tokens: 8192,
    stream: true,
  };
  if (isOllama) {
    body.response_format = { type: "json_object" };
    body.think = false;
  } else {
    body.response_format = { type: "json_object" };
  }

  if (attempt > 0) console.log(`\n  ${C.ylw}── RETRY ${attempt + 1}/2 ──${C.rst}`);
  console.log(`  → Wysyłam zapytanie...`);
  const t0 = Date.now();

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`fetch failed: ${e.cause?.message || e.message}`);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const raw = await streamResponse(res);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  → Czas: ${dt}s | ${res.status}`);

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
    const rawFile = `articles/.raw-${Date.now()}.txt`;
    writeFileSync(rawFile, raw, "utf8");
    console.log(`  ${C.ylw}→ JSON niepoprawny — surowa odpowiedź zapisana do ${rawFile}${C.rst}`);
    return { data: null, raw, valid: false, issues: ["JSON parse failed"] };
  }

  console.log(`  → title: "${(data.title || "").slice(0, 60)}"`);
  console.log(`  → body:  ${(data.body || "").length} znaków`);

  const v = validate(data, raw);
  console.log(`  → Słowa: ${v.words} | H2: ${v.hasH2 ? "✅" : "❌"} | Desc: ${(data.desc || "").length} znaków`);

  if (!v.ok && attempt < 1) {
    console.log(`  ${C.ylw}→ Walidacja niezaliczona: ${v.issues.join(", ")}${C.rst}`);
    return generate(model, topic, attempt + 1);
  }

  return { data, raw, valid: v.ok, issues: v.issues };
}

// --- html builder ---
function buildHtml(data, raw, topic, model) {
  const artTitle = data?.title || topic;
  const desc = data?.desc || "";
  const kws = data?.keywords || "";
  const body = (data?.body || raw || "").replace(/```html?\n?|```$/gmi, "").trim();
  const slug = artTitle.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const fname = `articles/${slug}.html`;

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
<div class="footer">Artykuł wygenerowany przez AI · model: ${model} · data: ${new Date().toLocaleDateString("pl-PL")}</div>
</body>
</html>`;

  return { html, fname, body, slug, artTitle };
}

// --- main ---
async function main() {
  process.on("SIGINT", () => { console.log(`\n${C.ylw}⏹ Przerwano${C.rst}`); cleanup(); process.exit(0); });
  const start = Date.now();
  const useOpenRouter = !!process.env.OPENROUTER_KEY;
  const verb = process.argv.includes("--verbose") || process.argv.includes("-v");

  console.log("╔══════════════════════════════════════╗");
  console.log("║     Generator artykułów SEO v2       ║");
  console.log(`║     Provider: ${useOpenRouter ? "OpenRouter" : "Ollama lokalnie"}           ║`);
  console.log("╚══════════════════════════════════════╝\n");

  // [1] Topic
  step("Pobieranie tematu");
  let topic = (process.argv[2] || "").trim();
  if (!topic) topic = (await ask("  Temat artykułu: ")).trim();
  if (!topic) { topic = "Czym jest dropshipping B2B na platformie SelleeTools"; console.log(`  → Domyślny: "${topic}"`); }
  else console.log(`  → "${topic}" (${topic.length} znaków)`);

  // [2] Model
  step("Wybór modelu AI");
  let model = (process.argv[3] || "").trim();

  if (!useOpenRouter) {
    const models = ollamaModels();
    if (models.length === 0) {
      console.log(`  ${C.red}→ Brak modeli w Ollamie – uruchom 'ollama serve' i ściągnij przynajmniej jeden model${C.rst}`);
      cleanup(); process.exit(1);
    }

    if (!model) {
      console.log("  Dostępne modele:");
      models.forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
      const pick = parseInt(await ask(`  Wybierz (1-${models.length}, Enter=domyślny): `), 10);
      model = models[pick - 1] || models[0];
    } else if (!models.includes(model)) {
      console.log(`  ${C.ylw}→ Model "${model}" nie znaleziony lokalnie – używam ${models[0]}${C.rst}`);
      model = models[0];
    }
  } else {
    if (!model) model = "qwen/qwen-2.5-7b-instruct";
  }

  console.log(`  → ${model}`);
  if (!useOpenRouter && model.startsWith("qwen3.5")) {
    console.log(`  ${C.dim}ℹ️  qwen3.5 — think:false (reasoning wyłączony)${C.rst}`);
  }

  // [3] Dir
  step("Katalog wyjściowy");
  if (!existsSync("articles")) { mkdirSync("articles"); console.log("  → Utworzono articles/"); }
  else console.log("  → articles/ istnieje");

  // [4] Prompt info
  step("Prompt");
  const up = userPrompt(topic);
  console.log(`  → System: ${SYSTEM.length} znaków (~${Math.ceil(SYSTEM.length / 4)} tokenów)`);
  console.log(`  → User:   ${up.length} znaków (~${Math.ceil(up.length / 4)} tokenów)`);
  console.log(`  → Temp: 0.3 | response_format: json_object | max_tokens: 8192`);
  if (verb) {
    console.log(`\n  ${C.dim}──SYSTEM PROMPT──${C.rst}`);
    console.log(SYSTEM.split("\n").map(l => `  ${C.dim}|${C.rst} ${l}`).join("\n"));
    console.log(`\n  ${C.dim}──USER PROMPT──${C.rst}`);
    console.log(up.split("\n").map(l => `  ${C.dim}|${C.rst} ${l}`).join("\n"));
  }

  // [5] Warmup (Ollama only)
  if (!useOpenRouter) {
    step("Warmup modelu", C.ylw);
    const tw = Date.now();
    try {
      const wup = await fetch("http://localhost:11434/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "OK" }], max_tokens: 1, think: false }),
      });
      const dt = ((Date.now() - tw) / 1000).toFixed(1);
      if (!wup.ok) { console.log(`  ${C.red}→ Warmup: ${wup.status}${C.rst}`); cleanup(); process.exit(1); }
      const wj = await wup.json();
      console.log(`  → ${wj.model || model} | ${dt}s | ${wj.usage?.total_tokens || "?"} tokenów`);
    } catch (e) {
      console.log(`  ${C.red}→ Warmup failed: ${e.cause?.message || e.message}${C.rst}`);
      cleanup(); process.exit(1);
    }
  }

  // [6] Generate (with streaming + retry)
  step("Generowanie artykułu", C.ylw);
  const genStart = Date.now();
  let completed = false;

  // background status (no readline interference)
  const statusLoop = (async () => {
    while (!completed) {
      await setTimeout(30000);
      if (completed) break;
      const elapsed = ((Date.now() - genStart) / 1000).toFixed(0);
      console.log(`\n  ${C.dim}[⏱ ${elapsed}s] Wciąż generuję...${C.rst}`);
    }
  })();

  let result;
  try {
    result = await generate(model, topic);
  } catch (e) {
    completed = true;
    console.log(`  ${C.red}→ ${e.message}${C.rst}`);
    cleanup(); process.exit(1);
  }
  completed = true;

  if (!result.data) {
    console.log(`  ${C.red}→ Nie udało się wygenerować artykułu${C.rst}`);
    if (result.raw) {
      const rawFile = `articles/.raw-${Date.now()}.txt`;
      writeFileSync(rawFile, result.raw, "utf8");
      console.log(`  → Surowa odpowiedź: ${rawFile}`);
    }
    cleanup(); process.exit(1);
  }

  if (result.issues?.length) {
    console.log(`  ${C.ylw}→ Uwagi: ${result.issues.join(", ")}${C.rst}`);
  }

  // [7] Build HTML
  step("Generowanie dokumentu HTML");
  const { html, fname, body, slug, artTitle } = buildHtml(result.data, result.raw, topic, model);
  console.log(`  → Tytuł:  ${artTitle.slice(0, 60)}`);
  console.log(`  → Slug:   ${slug}`);
  console.log(`  → Body:   ${body.length} znaków`);
  console.log(`  → HTML:   ${html.length} znaków (~${Math.ceil(html.length / 1024)} KB)`);

  // [8] Save
  step("Zapis pliku");
  writeFileSync(fname, html, "utf8");
  console.log(`  → ${C.grn}Zapisano${C.rst} ${fname} (${(html.length / 1024).toFixed(1)} KB)`);

  // [9] Done
  step("Podsumowanie", C.grn);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  → Czas:  ${elapsed}s`);
  console.log(`  → Model: ${model} | Body: ${body.length} znaków`);
  console.log(`\n${C.cyn}🔗 https://pkrokosz.github.io/smartbuyers/${fname.replace(/\\/g, "/")}${C.rst}\n`);
  cleanup();
}
main();
