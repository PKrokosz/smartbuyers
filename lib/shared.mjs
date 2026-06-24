import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";

// --- colors ---
export const C = {
  rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m",
  ylw: "\x1b[33m", cyn: "\x1b[36m", dim: "\x1b[2m",
};

// --- escapers ---
export function esc(s) { return `${s}`.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
export function safeHref(url) {
  if (!url) return "";
  const u = url.trim().toLowerCase();
  return (u.startsWith("http://") || u.startsWith("https://")) ? url : "";
}
export function ts() { return new Date().toLocaleTimeString("pl-PL"); }

// --- step counter ---
let stepNo = 0;
export let TOTAL = 9;
export function stepReset(n) { stepNo = 0; TOTAL = n; }
export function step(label, color = C.cyn) {
  stepNo++;
  console.log(`${color}[${ts()}] [${stepNo}/${TOTAL}] ${label}${C.rst}`);
}
export function log(tag, msg, color = C.cyn) {
  console.log(`${color}[${ts()}] [${tag}]${C.rst} ${msg}`);
}

// --- generated.json ---
export const GENERATED = "generated.json";
export function loadGen() { try { return JSON.parse(readFileSync(GENERATED, "utf8")); } catch { return {}; } }
export function saveGen(g) { writeFileSync(GENERATED, JSON.stringify(g, null, 2)); }
export function isGen(url) { return !!(loadGen()[url]); }
export function markGen(url, slug) { const g = loadGen(); g[url] = { slug, date: new Date().toISOString() }; saveGen(g); }

// --- ollama helpers ---
export function ollamaModels() {
  try {
    const out = execSync("ollama list", { encoding: "utf8", timeout: 5000 });
    return out.trim().split("\n").slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch { return []; }
}
export function ollamaPs() {
  try {
    const ps = execSync("ollama ps", { encoding: "utf8", timeout: 3000 }).trim();
    const lines = ps.split("\n").filter(l => l.trim());
    if (lines.length > 1) return lines.slice(1).map(l => l.trim()).join(" | ");
  } catch {}
  return null;
}

// --- prompts ---
export const S_RSS = `Jesteś polskim dziennikarzem technologicznym i ekspertem SEO. Przetwarzasz angielskie newsy na polskie artykuły.

Każda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu.

Przykład poprawnej odpowiedzi:
{"title":"Sztuczna inteligencja zmienia e-commerce – nowy raport","desc":"Najnowszy raport o AI w handlu. Automatyzacja, personalizacja i nowe narzędzia dla sprzedawców.","keywords":"AI, e-commerce, automatyzacja, sztuczna inteligencja","body":"<h2>AI rewolucjonizuje e-commerce</h2><p>Sztuczna inteligencja zmienia sposób w jaki... <strong>kluczowe trendy</strong> to...</p><h2>Wnioski</h2><ul><li>Personalizacja</li><li>Automatyzacja</li></ul><h2>Podsumowanie</h2><p>Firmy które wdrożą AI zyskają...</p>"}

body: HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Min. 300 słów. Po polsku.`;

export const S_TOPIC = `Jesteś polskim ekspertem SEO i dziennikarzem. Piszesz na bloga B2B o dropshippingu, e-commerce i nowych technologiach.

Każda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu.

Przykład poprawnej odpowiedzi:
{"title":"Jak zacząć dropshipping B2B w 2025 roku","desc":"Kompletny poradnik dropshippingu B2B. Wybór dostawców, automatyzacja sprzedaży i skalowanie.","keywords":"dropshipping B2B, e-commerce, sprzedaż online","body":"<h2>Wprowadzenie</h2><p>Dropshipping B2B to model, w którym... <strong>kluczowe korzyści</strong> to...</p><h2>Jak zacząć</h2><p>Pierwszym krokiem jest...</p><ul><li>Zbadaj rynek</li><li>Znajdź dostawców</li></ul><h2>Podsumowanie</h2><p>Dropshipping B2B oferuje ogromny potencjał...</p>"}

body: HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>. Min. 500 słów. Po polsku.`;

export function promptRss(title, snippet) {
  return `Napisz artykuł SEO po polsku na podstawie newsa.\n\nORYGINALNY NEWS:\nTytuł: ${title}\nTreść: ${snippet}\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
}
export function promptTopic(topic) {
  return `Napisz artykuł SEO na bloga B2B.\n\nTemat: "${topic}"\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
}

// --- validation ---
export function validate(data, raw, minWords = 200) {
  const issues = [];
  const b = data?.body || raw || "";
  const words = b.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  const hasH2 = /<h2[^>]*>/i.test(b);
  const d = (data?.desc || "").trim();
  if (!data?.title) issues.push("brak tytułu");
  if (!data?.body) issues.push("brak treści");
  if (words < minWords) issues.push(`słów ${words} (min ${minWords})`);
  if (!hasH2) issues.push("brak <h2>");
  if (d.length < 40) issues.push(`desc za krótkie (${d.length})`);
  return { ok: issues.length === 0, issues, words, hasH2 };
}

// --- streaming ---
export async function streamResponse(res, indent = "  ") {
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
    if (tick > 0 && tick % 40 === 0) process.stdout.write(`\r${indent}→ Strumień: ${full.length} znaków...`);
  }
  process.stdout.write(`\r${indent}→ Strumień: ${full.length} znaków (gotowe)    \n`);
  return full;
}

// --- slugify ---
export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0, 60);
}

// --- html builder (with schema.org + Open Graph + Twitter Card) ---
export function buildHtml(data, raw, topic, model, extra = {}) {
  const t = data?.title || topic;
  const d = data?.desc || "";
  const k = data?.keywords || "";
  let body = (data?.body || raw || "").replace(/```html?\n?|```$/gmi, "").trim();
  if (extra.sourceLink && !body.includes(extra.sourceLink)) {
    body += `\n\n<h2>Źródło</h2>\n<p><a href="${extra.sourceLink}" rel="nofollow">${esc(extra.sourceLabel || extra.sourceLink)}</a></p>`;
  }
  const slug = slugify(t);
  const fname = `articles/${slug}.html`;
  const dateISO = new Date().toISOString();
  const datePL = new Date().toLocaleDateString("pl-PL");
  const pageUrl = `https://pkrokosz.github.io/smartbuyers/articles/${slug}.html`;

  const ldjson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": t,
    "description": d,
    "datePublished": dateISO,
    "dateModified": dateISO,
    "author": { "@type": "Organization", "name": "SmartBuyers" },
    "publisher": { "@type": "Organization", "name": "SmartBuyers", "url": "https://pkrokosz.github.io/smartbuyers/" },
    "mainEntityOfPage": pageUrl
  });

  const sourceHtml = extra.sourceLink
    ? ` · źródło: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a>`
    : "";

  // reading time
  const wordCount = (body || "").replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(1, Math.ceil(wordCount / 200));

  const navHtml = `<nav class="topnav">
  <a href="${BASE}/">🏠 Home</a>
  <a href="${BASE}/articles/">📰 Artykuły</a>
  <a href="${BASE}/blog/">📝 Blog</a>
  <a href="https://selleetools.com">🛒 SelleeTools</a>
</nav>`;

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(t)}</title>
<meta name="description" content="${esc(d)}">
<meta name="keywords" content="${esc(k)}">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(d)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(t)}">
<meta name="twitter:description" content="${esc(d)}">
<script type="application/ld+json">${ldjson}</script>
<style>
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:0 auto;padding:0 1.5rem 2rem;line-height:1.7;color:#222;background:#fff}
.topnav{display:flex;gap:.5rem;padding:.9rem 0;margin-bottom:1.5rem;border-bottom:2px solid #159957;font-size:.92rem;flex-wrap:wrap}
.topnav a{color:#159957;text-decoration:none;padding:.2rem .5rem;border-radius:4px}
.topnav a:hover{background:#15995711}
h1{font-size:1.8rem;margin-bottom:.3rem;line-height:1.3}
.meta-line{color:#666;font-size:.9rem;margin-bottom:2rem}
h2{margin-top:2.5rem;margin-bottom:.5rem;border-bottom:2px solid #eee;padding-bottom:.3rem}
h3{margin-top:1.8rem}
p{margin:.9rem 0}
ul,ol{margin:.9rem 0;padding-left:1.5rem}
li{margin:.4rem 0}
img{max-width:100%;height:auto;border-radius:8px;margin:1rem 0}
blockquote{border-left:4px solid #159957;padding:.5rem 1.2rem;color:#555;background:#f6f8f7;border-radius:0 8px 8px 0;margin:1.2rem 0}
pre,code{background:#f4f4f4;border-radius:4px;padding:.1rem .3rem;font-size:.9em}
pre{padding:1rem;overflow-x:auto}
pre code{padding:0;background:none}
a{color:#159957}
.footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.85rem;color:#999}
</style>
</head>
<body>
${navHtml}
<h1>${esc(t)}</h1>
<div class="meta-line">📖 ${readMin} min czytania · ${datePL}</div>
<article>${body}</article>
<div class="footer">AI · model: ${model} · data: ${datePL}${sourceHtml}</div>
</body>
</html>`;
  return { html, fname, body, slug, artTitle: t, pageUrl };
}

// --- git ---
export function gitPush(files, msg) {
  console.log(`  ${C.ylw}→ Commit + push...${C.rst}`);
  const safeMsg = msg.replace(/"/g, "\\\"");
  try {
    execSync(`git add ${files}`, { cwd: ".", encoding: "utf8" });
    const c = execSync(`git commit -m "${safeMsg}"`, { cwd: ".", encoding: "utf8" });
    console.log(`  → ${c.toString().trim()}`);
    execSync(`git push`, { cwd: ".", encoding: "utf8" });
    console.log(`  ${C.grn}→ Pushnięte ✅${C.rst}`);
    return true;
  } catch (e) {
    console.log(`  ${C.red}→ Git błąd: ${e.stderr?.toString().slice(0, 200) || e.message}${C.rst}`);
    return false;
  }
}

// --- index / sitemap generators ---
const BASE = "https://pkrokosz.github.io/smartbuyers";

function capitalize(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80);
}

export function generateIndex() {
  const gen = loadGen();
  const seen = new Set(Object.values(gen).map(x => x.slug));
  const all = [];
  
  // from generated.json (RSS articles)
  for (const [url, info] of Object.entries(gen)) {
    all.push({ slug: info.slug, date: info.date, source: url.startsWith("http") ? url : null });
  }
  
  // scan articles/ dir for any HTML not tracked in generated.json (topic-based articles)
  try {
    const ls = execSync("cmd /c \"dir /b articles\\*.html 2>nul\"", { encoding: "utf8", timeout: 3000 }).trim();
    const files = ls.split(/\r?\n/).filter(f => f.endsWith(".html") && f !== "index.html");
    for (const f of files) {
      const slug = f.replace(".html", "");
      if (!seen.has(slug)) {
        let date = new Date().toISOString();
        try {
          const gitDate = execSync(`git log -1 --format=%aI "articles/${f}"`, { encoding: "utf8", timeout: 3000 }).trim();
          if (gitDate) date = gitDate;
        } catch {}
        all.push({ slug, date, source: null });
      }
    }
  } catch {}
  
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  
  let items = "";
  for (const a of all) {
    const title = esc(capitalize(a.slug));
    const date = a.date ? new Date(a.date).toLocaleDateString("pl-PL") : "";
    const articleUrl = `${BASE}/articles/${a.slug}.html`;
    items += `
    <article class="item">
      <h2><a href="${articleUrl}">${title}</a></h2>
      <div class="meta">${date}${a.source ? ` · <a href="${a.source}" target="_blank" rel="noopener">źródło</a>` : ""}</div>
    </article>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SmartBuyers – Artykuły</title>
<style>
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:0 1.5rem 2rem;line-height:1.7;color:#222;background:#fafafa}
.topnav{display:flex;gap:.5rem;padding:.9rem 0;margin-bottom:1.5rem;border-bottom:2px solid #159957;font-size:.92rem;flex-wrap:wrap}
.topnav a{color:#159957;text-decoration:none;padding:.2rem .5rem;border-radius:4px}
.topnav a:hover{background:#15995711}
h1{font-size:2rem;margin-bottom:.5rem;padding-bottom:.5rem}
h2{font-size:1.2rem;margin:0}
h2 a{color:#159957;text-decoration:none}
h2 a:hover{text-decoration:underline}
.item{padding:1.2rem 0;border-bottom:1px solid #e0e0e0}
.item:last-child{border-bottom:none}
.meta{font-size:.85rem;color:#777;margin-top:.3rem}
.meta a{color:#159957}
.empty{text-align:center;padding:3rem;color:#999}
.count{font-size:.9rem;color:#777;margin-bottom:1rem}
.footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #ddd;font-size:.8rem;color:#999;text-align:center}
.footer a{color:#159957}
</style>
</head>
<body>
<nav class="topnav">
  <a href="${BASE}/">🏠 Home</a>
  <a href="${BASE}/articles/">📰 Artykuły</a>
  <a href="${BASE}/blog/">📝 Blog</a>
  <a href="https://selleetools.com">🛒 SelleeTools</a>
</nav>
<h1>📰 SmartBuyers</h1>
<div class="count">${all.length} artykułów</div>
${items || '<div class="empty">Brak artykułów. Pierwszy już wkrótce!</div>'}
<div class="footer">Generator AI · SmartBuyers · <a href="${BASE}/articles/sitemap.xml">sitemap</a></div>
</body>
</html>`;
  writeFileSync("articles/index.html", html, "utf8");
  return all.length;
}

export function generateSitemap() {
  const gen = loadGen();
  let urls = "";
  for (const [, info] of Object.entries(gen)) {
    urls += `  <url><loc>${BASE}/articles/${info.slug}.html</loc><lastmod>${(info.date||"").slice(0,10)}</lastmod><changefreq>weekly</changefreq></url>\n`;
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE}/</loc><lastmod>${new Date().toISOString().slice(0,10)}</lastmod><priority>1.0</priority></url>
  <url><loc>${BASE}/articles/</loc><lastmod>${new Date().toISOString().slice(0,10)}</lastmod><priority>0.9</priority></url>
${urls}</urlset>`;
  writeFileSync("articles/sitemap.xml", xml, "utf8");
}
