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
let stepNo = 0, TOTAL = 9;
export function stepReset(n) { stepNo = 0; TOTAL = n; }
export function step(label, color = C.cyn) {
  stepNo++;
  console.log(`${color}[${ts()}] [${stepNo}/${TOTAL}] ${label}${C.rst}`);
}
export function log(tag, msg, color = C.cyn) {
  console.log(`${color}[${ts()}] [${tag}]${C.rst} ${msg}`);
}

// --- flag parser ---
export function parseFlag(args, flag, dict, def) {
  const i = args.indexOf(flag);
  return (i >= 0 && i + 1 < args.length && dict[args[i + 1]]) ? args[i + 1] : def;
}

// --- generated.json ---
const GJ = "generated.json";
export function loadGen() { try { return JSON.parse(readFileSync(GJ, "utf8")); } catch { return {}; } }
export function saveGen(g) { writeFileSync(GJ, JSON.stringify(g, null, 2)); }
export function markGen(url, slug, title) { const g = loadGen(); g[url] = { slug, title: title || slug, date: new Date().toISOString() }; saveGen(g); }
export function isGen(url) { const g = loadGen(); return !!g[url]; }

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
// formats
export const FORMATS = {
  article: { label: "Standardowy artykuł", system: "", userHint: "", structure: "body: HTML z <h2>, <h3>, <p>, <ul>, <li>, <strong>." },
  list:    { label: "Top lista",          system: "Format: numerowana lista Top X. Każdy punkt z nagłówkiem <h3> i opisem.", userHint: "Użyj formatu listy Top X z <ol><li><h3>...</h3><p>...</p></li></ol>.", structure: "<ol><li><h3>punkt</h3><p>opis</p></li></ol>" },
  howto:   { label: "Poradnik krok po kroku", system: "Format: poradnik how-to. Struktura: każdy krok jako <h2>, z przykładem.", userHint: "Użyj formatu poradnika: <h2>Krok 1: ...</h2><p>...</p> dla każdego kroku.", structure: "<h2>Krok 1</h2><p>...</p><h2>Krok 2</h2><p>...</p>" },
  explainer:{ label: "Czym jest X",       system: "Format: artykuł wyjaśniający. Struktura: definicja → jak działa → korzyści → przykłady.", userHint: "Struktura: <h2>Czym jest...</h2><h2>Jak działa</h2><h2>Korzyści</h2><h2>Przykłady</h2>.", structure: "<h2>Czym jest</h2><h2>Jak działa</h2><h2>Korzyści</h2>" },
  vs:      { label: "Porównanie X vs Y",  system: "Format: porównanie. Struktura: przegląd X, przegląd Y, tabela różnic, rekomendacja.", userHint: "Struktura: <h2>Przegląd X</h2><h2>Przegląd Y</h2><h2>Porównanie</h2><table>...</table><h2>Który wybrać?</h2>.", structure: "<h2>X</h2><h2>Y</h2><h2>Porównanie</h2><table>...</table>" },
  myth:    { label: "Mit czy fakt",       system: "Format: 5 mitów vs faktów. Każdy: <blockquote>Mit</blockquote> + <p><strong>Fakt</strong></p>.", userHint: "Użyj formatu mit-fakt: <blockquote>Mit: ...</blockquote><p><strong>Fakt:</strong> ...</p> x5.", structure: "<blockquote>Mit</blockquote><p><strong>Fakt</strong></p>" },
  faq:     { label: "FAQ",               system: "Format: FAQ. Struktura: pytanie jako <h3>, odpowiedź jako <p>. Minimum 5 par.", userHint: "Struktura: <h3>Pytanie?</h3><p>Odpowiedź...</p> x 5.", structure: "<h3>Pytanie</h3><p>Odpowiedź</p>" },
  digest:  { label: "Przegląd newsów",    system: "Format: digest tygodnia. 5 podsumowanych newsów jako osobne sekcje <h2>.", userHint: "Struktura: <h2>1. Tytuł newsa</h2><p>Podsumowanie...</p> x 5.", structure: "<h2>1. Tytuł</h2><p>...</p> x 5" },
  opinion: { label: "Opinia / komentarz", system: "Format: artykuł opinii. Argumenty za, przeciw, osobista konkluzja.", userHint: "Pisz w pierwszej osobie. Struktura: <h2>Kontekst</h2><h2>Argumenty za</h2><h2>Argumenty przeciw</h2><h2>Moja opinia</h2>.", structure: "<h2>Argumenty za</h2><h2>Przeciw</h2><h2>Opinia</h2>" },
};

// personas
export const PERSONAS = {
  journalist: { label: "Dziennikarz",    system: "Jesteś polskim dziennikarzem technologicznym. Obiektywny, oparty na faktach, cytujesz źródła." },
  marketer:   { label: "Marketer",       system: "Jesteś polskim content marketerem B2B. Perswazyjny, benefit-oriented, z call-to-action." },
  technical:  { label: "Technical writer",system: "Jesteś polskim technical writerem. Precyzyjny, definiujesz terminy, podajesz konkrety." },
  ceo:        { label: "CEO / Founder",  system: "Jesteś CEO platformy e-commerce. Strategiczny, big-picture, dzielisz się insightami branżowymi." },
  customer:   { label: "Klient / User",  system: "Jesteś sprzedawcą na marketplace. Praktyczny, first-person, opisujesz realne doświadczenia." },
};

// tones
export const TONES = {
  casual:      { label: "Swobodny",    instruction: "Pisz w stylu konwersacyjnym, jakbyś rozmawiał z kolegą przy kawie. Używaj prostego języka." },
  formal:      { label: "Formalny",    instruction: "Profesjonalny, biznesowy ton. Formalny język, pełne zdania, bez slangu." },
  educational: { label: "Edukacyjny",  instruction: "Wyjaśniaj każdy termin. Podawaj przykłady. Strukturyzuj logicznie jak podręcznik." },
  urgent:      { label: "Pilny / news",instruction: "Pisz z poczuciem pilności. Dlaczego to WAŻNE TERAZ. Krótkie, mocne zdania." },
};

// languages
export const LANGS = {
  pl: { label: "Polski", out: "Po polsku.", minWords: 300 },
  en: { label: "English", out: "In English.", minWords: 250 },
};

// defaults
export const DEF_PERSONA = "journalist";
export const DEF_TONE = "casual";
export const DEF_FORMAT = "article";
export const DEF_LANG = "pl";

// few-shot examples per format
function exampleJson(format, lang) {
  const en = lang === "en";
  if (format === "list") return en
    ? '{"title":"Top 5 E-Commerce Tools for 2026","desc":"The best tools for online sellers. Comparison, features, pricing.","keywords":"e-commerce, tools, automation","body":"<ol><li><h3>Tool One</h3><p>Description...</p></li></ol>"}'
    : '{"title":"Top 5 narzędzi e-commerce na 2026 rok","desc":"Najlepsze narzędzia dla sprzedawców online. Porównanie, funkcje, ceny.","keywords":"e-commerce, narzędzia, automatyzacja","body":"<ol><li><h3>Narzędzie 1</h3><p>Opis...</p></li></ol>"}';
  if (format === "howto") return en
    ? '{"title":"How to Start a Dropshipping Business: Step-by-Step Guide","desc":"Complete guide to starting dropshipping. From niche selection to first sale.","keywords":"dropshipping, guide, e-commerce","body":"<h2>Step 1: Choose a Niche</h2><p>Start by researching...</p><h2>Step 2: Find Suppliers</h2><p>Look for...</p>"}'
    : '{"title":"Jak zacząć dropshipping: poradnik krok po kroku","desc":"Kompletny poradnik zakładania dropshippingu. Od wyboru niszy do pierwszej sprzedaży.","keywords":"dropshipping, poradnik, e-commerce","body":"<h2>Krok 1: Wybierz niszę</h2><p>Zacznij od researchu...</p><h2>Krok 2: Znajdź dostawców</h2><p>Szukaj...</p>"}';
  // default article example
  return en
    ? '{"title":"AI Revolution in E-Commerce: What Sellers Need to Know","desc":"How AI is transforming online retail. Automation, personalization, and new tools for sellers.","keywords":"AI, e-commerce, automation","body":"<h2>The AI Shift</h2><p>Artificial intelligence is changing... <strong>key trends</strong> include...</p><h2>Key Takeaways</h2><ul><li>Personalization</li><li>Automation</li></ul><h2>Conclusion</h2><p>Companies that adopt AI...</p>"}'
    : '{"title":"Jak AI zmienia e-commerce: co sprzedawcy muszą wiedzieć","desc":"Jak sztuczna inteligencja zmienia handel online. Automatyzacja, personalizacja i nowe narzędzia.","keywords":"AI, e-commerce, automatyzacja, sprzedaż","body":"<h2>Rewolucja AI</h2><p>Sztuczna inteligencja zmienia... <strong>kluczowe trendy</strong> to...</p><h2>Wnioski</h2><ul><li>Personalizacja</li><li>Automatyzacja</li></ul><h2>Podsumowanie</h2><p>Firmy które wdrożą AI...</p>"}';
}

export function buildPrompt(opts = {}) {
  const fmt = FORMATS[opts.format] || FORMATS[DEF_FORMAT];
  const persona = PERSONAS[opts.persona] || PERSONAS[DEF_PERSONA];
  const tone = TONES[opts.tone] || TONES[DEF_TONE];
  const lang = LANGS[opts.lang] || LANGS[DEF_LANG];
  const isRss = !!opts.rssTitle;

  const system = [
    persona.system,
    tone.instruction,
    fmt.system,
    `\nKażda odpowiedź to TYLKO jeden czysty obiekt JSON — bez znaczników \`\`\`, bez komentarzy, bez dodatkowego tekstu.`,
    `\nPrzykład poprawnej odpowiedzi:\n${exampleJson(opts.format || DEF_FORMAT, opts.lang || DEF_LANG)}`,
    `\n${fmt.structure} Min. ${lang.minWords} słów. ${lang.out}`,
  ].filter(Boolean).join("\n");

  let user;
  if (isRss) {
    user = `Napisz artykuł SEO${opts.lang === "en" ? " in English" : " po polsku"} na podstawie newsa.\n\nORYGINALNY NEWS:\nTytuł: ${opts.rssTitle}\nTreść: ${opts.rssSnippet}\n\n${fmt.userHint}\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
  } else {
    user = `Napisz artykuł SEO${opts.lang === "en" ? " in English" : " po polsku"}.\n\nTemat: "${opts.topic}"\n\n${fmt.userHint}\n\nZwracasz WYŁĄCZNIE czysty JSON: title, desc, keywords, body.`;
  }

  return { system, user, lang, fmt, persona, tone };
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
  // readability: FOG-like index (0-100, higher = harder)
  const sentences = Math.max(1, b.replace(/<[^>]+>/g, " ").split(/[.!?]+/).filter(Boolean).length);
  const complexWords = b.replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => w.length > 6).length;
  const fog = Math.min(100, Math.round(0.4 * ((words / sentences) + 100 * (complexWords / words))));
  const readability = fog <= 40 ? "łatwy" : fog <= 60 ? "średni" : "trudny";
  return { ok: issues.length === 0, issues, words, hasH2, fog, readability };
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

// --- html builder ---
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
  const pageUrl = `${BASE}/articles/${slug}.html`;

  // related articles (internal linking)
  let relatedHtml = "";
  try {
    const gen = loadGen();
    const related = Object.entries(gen)
      .filter(([, info]) => info.slug !== slug)
      .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""))
      .slice(0, 3);
    if (related.length > 0) {
      relatedHtml = `\n\n<div class="related-section">\n<h2>Powiązane artykuły</h2>\n<ul>\n${related.map(([, info]) => {
        const rt = esc((info.slug || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80));
        return `  <li><a href="${BASE}/articles/${info.slug}.html">${rt}</a></li>`;
      }).join("\n")}\n</ul>\n</div>`;
      body += relatedHtml;
    }
  } catch {}

  // schema.org
  const ldArticle = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": t, "description": d,
    "datePublished": dateISO, "dateModified": dateISO,
    "author": { "@type": "Organization", "name": "SmartBuyers" },
    "publisher": { "@type": "Organization", "name": "SmartBuyers", "url": BASE },
    "mainEntityOfPage": pageUrl
  };
  const ldjsons = [JSON.stringify(ldArticle)];

  // FAQ schema for --format faq
  if (extra.format === "faq") {
    const faqPairs = [];
    const re = /<h3[^>]*>\s*(.+?)\s*<\/h3>\s*<p[^>]*>\s*([\s\S]*?)\s*<\/p>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      faqPairs.push({ question: m[1].replace(/<[^>]+>/g, "").trim(), answer: m[2].replace(/<[^>]+>/g, " ").trim() });
    }
    if (faqPairs.length > 0) {
      ldjsons.push(JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqPairs.map(f => ({ "@type": "Question", "name": f.question, "acceptedAnswer": { "@type": "Answer", "text": f.answer } }))
      }));
    }
  }

  const sourceHtml = extra.sourceLink
    ? ` · źródło: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a>`
    : "";

  // reading time
  const wordCount = (body || "").replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(1, Math.ceil(wordCount / 200));

  const navHtml = NAV_HTML;

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
<script type="application/ld+json">${ldjsons.join("\n")}</script>
<style>
:root{--accent:#159957;--accent-dark:#0f6e3f;--accent-light:#e6f5ee;--text:#111;--text-dim:#555;--text-muted:#888;--bg:#f5f5f0;--card:#fff;--border:#ddd;--radius:6px;--shadow-sm:0 1px 3px rgba(0,0,0,.06);--font:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--font-mono:'SF Mono','Fira Code',Consolas,monospace;--content-w:740px}
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased}
body{font-family:var(--font);color:var(--text);background:var(--bg);line-height:1.8;min-height:100vh}
.site-nav{position:sticky;top:0;z-index:100;background:rgba(245,245,240,.95);border-bottom:1px solid var(--border);padding:0 clamp(1rem,3vw,2rem)}
.nav-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:clamp(.4rem,1.5vw,1.2rem);height:52px}
.nav-logo{font-size:1.1rem;font-weight:800;color:var(--accent);text-decoration:none;letter-spacing:-.03em;margin-right:auto;text-transform:uppercase}
.nav-link{font-size:.85rem;color:var(--text-dim);text-decoration:none;padding:.3rem .6rem;border-radius:4px;transition:color .2s,background .2s}
.nav-link:hover{color:var(--accent);background:var(--accent-light)}
.nav-link.active{color:var(--accent);font-weight:600}
.nav-link.external{color:var(--accent)}
.reading-progress{position:fixed;top:52px;left:0;height:3px;background:var(--accent);z-index:99;width:0;transition:width .08s linear}
.page-wrap{max-width:var(--content-w);margin:0 auto;padding:0 clamp(1rem,3vw,1.5rem)}
.article-header{margin:clamp(1.5rem,3vw,2.5rem) 0 1rem}
h1{font-size:clamp(1.5rem,3vw,2.2rem);line-height:1.25;margin-bottom:.5rem;font-weight:800}
.meta-line{display:flex;align-items:center;gap:1rem;font-size:.85rem;color:var(--text-dim);margin-bottom:1.5rem;flex-wrap:wrap}
.meta-line span{display:flex;align-items:center;gap:.3rem}
h2{font-size:1.3rem;margin:2.5rem 0 .8rem;padding-bottom:.4rem;border-bottom:2px solid var(--border)}
h3{font-size:1.1rem;margin:1.8rem 0 .5rem}
p{margin:.85rem 0}
ul,ol{margin:.85rem 0;padding-left:1.5rem}
li{margin:.35rem 0}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
img{max-width:100%;height:auto;border-radius:var(--radius);margin:1.5rem 0}
blockquote{border-left:4px solid var(--accent);background:var(--accent-light);padding:.8rem 1.2rem;border-radius:0 var(--radius) var(--radius) 0;margin:1.2rem 0;color:var(--text-dim);font-style:italic}
pre,code{background:#eee;border-radius:4px;font-family:var(--font-mono);font-size:.88em}
code{padding:.15rem .4rem}
pre{padding:1rem;overflow-x:auto;line-height:1.5}
pre code{padding:0;background:none}
table{width:100%;border-collapse:collapse;margin:1.2rem 0;font-size:.92em}
th,td{padding:.5rem .8rem;border:1px solid var(--border);text-align:left}
th{background:#f2f2f2;font-weight:600}
.article-source{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--border);font-size:.82rem;color:var(--text-dim)}
.article-source a{color:var(--accent)}
.related-section{margin-top:2rem;padding:1.2rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius)}
.related-section h2{font-size:1rem;margin-top:0;margin-bottom:.8rem;border-bottom:none}
.related-section ul{padding-left:1rem;margin-bottom:0}
.related-section li{margin:.4rem 0;font-size:.9rem}
.article-footer{margin-top:2.5rem;padding-top:1.2rem;border-top:1px solid var(--border);font-size:.82rem;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem}
.article-footer a{color:var(--accent)}
@media(max-width:600px){.nav-inner{flex-wrap:wrap;height:auto;padding:.4rem 0;gap:.2rem}.nav-logo{width:100%;font-size:1rem}.reading-progress{top:0}h1{font-size:1.4rem}}
@media print{.site-nav,.reading-progress,.article-footer{display:none}body{color:#000;background:#fff}}
</style>
</head>
<body>
${navHtml}
<h1>${esc(t)}</h1>
<div class="meta-line"><span>📖 ${readMin} min czytania</span><span>📅 ${datePL}</span></div>
<article>${body}</article>
<div class="article-source">${sourceHtml ? `Źródło: <a href="${extra.sourceLink}">${esc(extra.sourceLabel || extra.sourceLink)}</a>` : ''}</div>
<div class="article-footer">AI · model: ${model} · ${datePL} · <a href="${BASE}">SmartBuyers</a></div>
<script>(function(){var b=document.getElementById('readingProgress');if(!b)return;window.addEventListener('scroll',function(){var p=(document.documentElement.scrollTop/(document.documentElement.scrollHeight-document.documentElement.clientHeight))*100;b.style.width=Math.min(p,100)+'%'},{passive:!0})})();</script>
</body>
</html>`;
  return { html, fname, body, slug, artTitle: t, pageUrl };
}

// --- Google Indexing API ---
export async function googleIndexingPing(pageUrl) {
  const key = process.env.GOOGLE_INDEXING_KEY;
  if (!key) { console.log(`  ${C.dim}→ Google Indexing: brak GOOGLE_INDEXING_KEY (pomijam)${C.rst}`); return; }
  try {
    const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ url: pageUrl, type: "URL_UPDATED" }),
    });
    if (res.ok) console.log(`  ${C.grn}→ Google Indexing: zgłoszony ✅${C.rst}`);
    else { const e = await res.text(); console.log(`  ${C.ylw}→ Google Indexing: ${res.status} ${e.slice(0, 100)}${C.rst}`); }
  } catch (e) { console.log(`  ${C.ylw}→ Google Indexing: ${e.message}${C.rst}`); }
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

export function generateIndex() {
  const gen = loadGen();
  const seen = new Set(Object.values(gen).map(x => x.slug));
  const all = [];
  
  // from generated.json (RSS articles)
  for (const [url, info] of Object.entries(gen)) {
    all.push({ slug: info.slug, title: info.title, date: info.date, source: url.startsWith("http") ? url : null });
  }
  
  // scan articles/ dir for any HTML not tracked in generated.json (topic-based articles)
  function extractTitleFromFile(slug) {
    try {
      const f = readFileSync(`articles/${slug}.html`, "utf8");
      const m = f.match(/<title>([^<]+)<\/title>/);
      if (m) return m[1].replace(/ — SmartBuyers$/, "").trim();
    } catch {}
    return null;
  }
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
        const title = extractTitleFromFile(slug);
        all.push({ slug, title, date, source: null });
      }
    }
  } catch {}
  
  all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  
  function badgeClass(slug) {
    const s = slug.toLowerCase();
    if (s.includes("techcrunch") || s.includes("google") || s.includes("amazon") || s.includes("nvidia") || s.includes("ai") || s.includes("deepmind") || s.includes("claude") || s.includes("anthropic") || s.includes("openai") || s.includes("chip")) return "is-tech";
    if (s.includes("reddit")) return "is-reddit";
    return "is-article";
  }
  function badgeLabel(slug) {
    const c = badgeClass(slug);
    if (c === "is-tech") return "tech";
    if (c === "is-reddit") return "reddit";
    return "artykuł";
  }
  function displayTitle(a) {
    if (a.title && !a.title.startsWith("digest")) return esc(a.title);
    return esc(a.slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 80));
  }
  let items = "";
  for (const a of all) {
    const title = displayTitle(a);
    const date = a.date ? new Date(a.date).toLocaleDateString("pl-PL") : "";
    const source = a.source ? `<span class="card-source">${esc(a.source)}</span>` : "";
    const articleUrl = `${BASE}/articles/${a.slug}.html`;
    const bClass = badgeClass(a.slug);
    const bLabel = badgeLabel(a.slug);
    items += `
      <div class="card">
        <span class="card-badge ${bClass}">${bLabel}</span>
        <div class="card-title"><a href="${articleUrl}">${title}</a></div>
        <div class="card-meta">📅 ${date}${source}</div>
        <a href="${articleUrl}" class="card-link">Czytaj więcej →</a>
      </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SmartBuyers – Artykuły</title>
<style>
:root{--accent:#159957;--accent-dark:#0f6e3f;--accent-light:#e6f5ee;--text:#111;--text-dim:#555;--text-muted:#888;--bg:#f5f5f0;--card-bg:#fff;--border:#ddd;--radius:6px;--shadow-sm:0 1px 3px rgba(0,0,0,.06);--shadow-md:0 4px 16px rgba(0,0,0,.08);--font:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--max-w:1200px;--badge-tech:#e84d0e;--badge-reddit:#5461c8;--badge-blog:#159957;--badge-default:#636363}
*,*:before,*:after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-font-smoothing:antialiased}
body{font-family:var(--font);color:var(--text);background:var(--bg);line-height:1.7;min-height:100vh}
.site-nav{position:sticky;top:0;z-index:100;background:rgba(245,245,240,.95);border-bottom:1px solid var(--border);padding:0 clamp(1rem,3vw,2rem)}
.nav-inner{max-width:var(--max-w);margin:0 auto;display:flex;align-items:center;gap:clamp(.4rem,1.5vw,1.2rem);height:52px}
.nav-logo{font-size:1.1rem;font-weight:800;color:var(--accent);text-decoration:none;letter-spacing:-.03em;margin-right:auto;text-transform:uppercase}
.nav-link{font-size:.85rem;color:var(--text-dim);text-decoration:none;padding:.3rem .6rem;border-radius:4px;transition:color .2s,background .2s}
.nav-link:hover{color:var(--accent);background:var(--accent-light)}
.nav-link.active{color:var(--accent);font-weight:600}
.nav-link.external{color:var(--accent)}
.page-wrap{max-width:var(--max-w);margin:0 auto;padding:0 clamp(1rem,3vw,2rem)}
.hero{background:linear-gradient(135deg,#0a3d25,#062818);color:#fff;padding:clamp(2rem,5vw,3.5rem) clamp(1rem,3vw,2rem);margin-bottom:clamp(1.5rem,3vw,2rem)}
.hero-inner{max-width:var(--max-w);margin:0 auto}
.hero-eyebrow{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:rgba(255,255,255,.5);margin-bottom:.4rem}
.hero h1{font-size:clamp(1.5rem,3vw,2.2rem);line-height:1.15;margin-bottom:.5rem;font-weight:800}
.hero p{font-size:clamp(.85rem,1.2vw,1rem);color:rgba(255,255,255,.75)}
.hero-line{width:50px;height:3px;background:var(--accent);margin-top:.8rem;border-radius:2px}
.count-badge{display:inline-block;font-size:.8rem;color:var(--text-dim);margin-bottom:1rem;background:var(--card-bg);padding:.25rem .7rem;border-radius:20px;border:1px solid var(--border)}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:clamp(.8rem,1.5vw,1.2rem)}
.card{background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--border);padding:1.3rem;box-shadow:var(--shadow-sm);transition:transform .2s,box-shadow .2s;display:flex;flex-direction:column;gap:.5rem}
.card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}
.card-badge{display:inline-block;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:.15rem .5rem;border-radius:3px;align-self:flex-start;color:#fff;background:var(--badge-default)}
.card-badge.is-tech{background:var(--badge-tech)}
.card-badge.is-reddit{background:var(--badge-reddit)}
.card-badge.is-blog{background:var(--badge-blog)}
.card-badge.is-article{background:var(--accent)}
.card-title{font-size:1rem;font-weight:600;line-height:1.35}
.card-title a{color:var(--text);text-decoration:none}
.card-title a:hover{color:var(--accent)}
.card-meta{font-size:.76rem;color:var(--text-muted);display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.card-source{color:var(--accent);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.card-link{font-size:.82rem;color:var(--accent);text-decoration:none;font-weight:500;align-self:flex-start}
.card-link:hover{text-decoration:underline}
.empty{text-align:center;padding:2rem;color:var(--text-muted)}
.page-footer{margin-top:clamp(2rem,4vw,3rem);padding:clamp(1.2rem,2.5vw,2rem) clamp(1rem,3vw,2rem);background:#1a1a1a;color:rgba(255,255,255,.65);font-size:.82rem}
.footer-inner{max-width:var(--max-w);margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem}
.footer-inner a{color:rgba(255,255,255,.65);text-decoration:none}
.footer-inner a:hover{color:var(--accent)}
@media(max-width:600px){.nav-inner{flex-wrap:wrap;height:auto;padding:.4rem 0;gap:.2rem}.nav-logo{width:100%;font-size:1rem}.card-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
${NAV_HTML}
<main>
  <div class="hero">
    <div class="hero-inner">
      <div class="hero-eyebrow">SmartBuyers — Content Hub</div>
      <h1>📰 Artykuły SmartBuyers</h1>
      <p>AI-generated SEO content — newsy, analizy, poradniki z branży e-commerce i dropshippingu B2B</p>
      <div class="hero-line"></div>
    </div>
  </div>
  <div class="page-wrap">
    <div class="count-badge">${all.length} artykułów</div>
    <div class="card-grid">${items || '<div class="empty">Brak artykułów. Pierwszy już wkrótce!</div>'}</div>
  </div>
</main>
<footer class="page-footer">
  <div class="footer-inner">
    <span>SmartBuyers · Generator AI · <a href="${BASE}/articles/sitemap.xml">sitemap</a> · <a href="${BASE}/articles/feed.xml">rss</a></span>
  </div>
</footer>
<script>(function(){var b=document.getElementById('readingProgress');if(!b)return;window.addEventListener('scroll',function(){var p=(document.documentElement.scrollTop/(document.documentElement.scrollHeight-document.documentElement.clientHeight))*100;b.style.width=Math.min(p,100)+'%'},{passive:!0})})();</script>
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

// --- RSS feed for the blog ---
export function generateFeed() {
  const gen = loadGen();
  const all = Object.entries(gen).sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""));
  const now = new Date().toUTCString();

  let items = "";
  for (const [url, info] of all.slice(0, 20)) {
    const title = esc((info.slug || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).slice(0, 100));
    const date = info.date ? new Date(info.date).toUTCString() : now;
    const link = `${BASE}/articles/${info.slug}.html`;
    items += `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${date}</pubDate>
      <source url="${url}">${url.slice(0, 60)}</source>
    </item>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>SmartBuyers — AI Content Engine</title>
    <link>${BASE}/articles/</link>
    <description>Automatycznie generowane artykuły SEO z RSS feedów. B2B dropshipping, e-commerce, AI.</description>
    <language>pl</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${BASE}/articles/feed.xml" rel="self" type="application/rss+xml"/>
${items}  </channel>
</rss>`;
  writeFileSync("articles/feed.xml", xml, "utf8");
  return all.length;
}

// --- nav bar (shared) ---
export const NAV_HTML = `<nav class="site-nav">
  <div class="nav-inner">
    <a href="https://pkrokosz.github.io/smartbuyers/" class="nav-logo">SmartBuyers</a>
    <a href="https://pkrokosz.github.io/smartbuyers/" class="nav-link">Home</a>
    <a href="https://pkrokosz.github.io/smartbuyers/articles/" class="nav-link active">Artykuły</a>
    <a href="https://pkrokosz.github.io/smartbuyers/blog/" class="nav-link">Blog</a>
    <a href="https://selleetools.com" class="nav-link external" target="_blank" rel="noopener">SelleeTools ↗</a>
  </div>
</nav>
<div class="reading-progress" id="readingProgress"></div>`;

// ── NB Notebook UUIDs (single source of truth) ──
export const NB_NEWS_ID = "5dd3bcd8-fc51-481e-bffa-fab231a378c3";
export const NB_SOURCES_ID = "9ebb1726-9322-423e-92f4-b081d65218b5";
export const NB_RESEARCH_ID = "7a31df6c-2516-4a0a-a0a6-34403d15f10a";
export const NB_AUDIO_ID = "992ecd72-3d82-4232-82e0-b5ecbd0a7755";
