import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { loadGen, C } from "./lib/shared.mjs";

function extractWords(text, minLen = 4) {
  return (text || "").toLowerCase().replace(/[^a-ząćęłńóśźż0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= minLen);
}

function tfidf(items) {
  const docCount = items.length;
  const df = new Map();
  for (const words of items) {
    const seen = new Set(words);
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
  }
  const scores = new Map();
  for (const words of items) {
    const tf = new Map();
    for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
    for (const [w, cnt] of tf) {
      const idf = Math.log(docCount / (1 + (df.get(w) || 0)));
      scores.set(w, (scores.get(w) || 0) + cnt * idf);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

function readArticleContent(slug) {
  try {
    const html = readFileSync(`articles/${slug}.html`, "utf8");
    const txt = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return txt;
  } catch { return ""; }
}

async function main() {
  console.log(`${C.cyn}╔══════════════════════════════════════════╗${C.rst}`);
  console.log(`${C.cyn}║     Content Intelligence Analyzer         ║${C.rst}`);
  console.log(`${C.cyn}╚══════════════════════════════════════════╝${C.rst}\n`);

  const gen = loadGen();
  const entries = Object.entries(gen);
  console.log(`  ${C.grn}→${C.rst} ${entries.length} artykułów w generated.json\n`);

  // collect content + slugs
  const articles = [];
  for (const [url, info] of entries) {
    const content = readArticleContent(info.slug);
    const words = extractWords(content || info.slug.replace(/-/g, " "), 4);
    articles.push({ slug: info.slug, date: info.date, source: url, words, contentLen: content.length });
  }

  // TF-IDF keyword extraction from actual content
  console.log("  ── Kluczowe tematy (TF-IDF z treści) ──");
  const topKws = tfidf(articles.map(a => a.words)).slice(0, 20);
  topKws.slice(0, 12).forEach(([kw, score]) => console.log(`    ${kw.padEnd(22)} ${C.dim}${score.toFixed(1)}${C.rst}`));

  // article timeline
  console.log("\n  ── Artykuły (z datami) ──");
  articles.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  articles.forEach((a, i) => {
    console.log(`    ${(i + 1).toString().padStart(2)}. ${a.date?.slice(0, 10) || "????-??-??"} ${C.grn}${a.slug.slice(0, 48)}${C.rst} ${a.contentLen > 0 ? C.dim + a.contentLen + " zn" + C.rst : C.ylw + " (slug-only)" + C.rst}`);
  });

  // gap analysis: dense vs sparse keywords
  console.log("\n  ── Luki tematyczne ──");
  const allWords = articles.flatMap(a => a.words);
  const freq = new Map();
  for (const w of allWords) freq.set(w, (freq.get(w) || 0) + 1);
  const sparse = [...freq.entries()].filter(([, c]) => c <= 2).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sparse.length === 0) {
    console.log(`    ${C.dim}brak oczywistych luk${C.rst}`);
  } else {
    sparse.forEach(([kw, c]) => console.log(`    ${C.ylw}→${C.rst} "${kw}" tylko ${c} artykuł(ów) — warto pogłębić`));
  }

  // competitor analysis
  console.log("\n  ── Konkurencja (competitors.json) ──");
  let compItems = [];
  if (existsSync("competitors.json")) {
    try { compItems = JSON.parse(readFileSync("competitors.json", "utf8")); } catch {}
  }
  if (compItems.length === 0) {
    console.log(`    ${C.dim}brak danych — dodaj feeds z mode:"track" i uruchom rss-watch${C.rst}`);
  } else {
    const byFeed = new Map();
    for (const ci of compItems) {
      const f = ci.feedName || "unknown";
      if (!byFeed.has(f)) byFeed.set(f, []);
      byFeed.get(f).push(ci);
    }
    for (const [feed, items] of byFeed) {
      const recent = items.sort((a, b) => (b.loggedAt || "").localeCompare(a.loggedAt || "")).slice(0, 3);
      console.log(`    ${C.grn}${feed}${C.rst} (${items.length} wpisów)`);
      for (const r of recent) {
        console.log(`      ${C.dim}•${C.rst} ${r.title?.slice(0, 60)}`);
        console.log(`        ${C.dim}${r.date?.slice(0, 10) || ""}${C.rst}`);
      }
    }
  }

  // summary
  console.log("\n  ── Podsumowanie ──");
  console.log(`    Artykułów: ${articles.length}`);
  console.log(`    Z treścią HTML: ${articles.filter(a => a.contentLen > 0).length}`);
  console.log(`    Unikalnych słów: ${freq.size}`);
  console.log(`    Ostatni: ${articles[0]?.date?.slice(0, 10) || "brak"}`);
  console.log(`    Najstarszy: ${articles[articles.length - 1]?.date?.slice(0, 10) || "brak"}`);

  // save report
  const report = {
    date: new Date().toISOString(),
    articleCount: articles.length,
    topKeywords: topKws.slice(0, 15).map(([k, v]) => ({ keyword: k, score: v })),
    gaps: sparse.map(([k, v]) => ({ keyword: k, count: v })),
    competitors: compItems.length,
    articles: articles.map(a => ({ slug: a.slug, date: a.date, contentLen: a.contentLen })),
  };
  writeFileSync("gap-report.json", JSON.stringify(report, null, 2));
  console.log(`\n  ${C.dim}→ Raport zapisany do gap-report.json${C.rst}\n`);
}

main();
