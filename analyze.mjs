import { writeFileSync } from "fs";
import { loadGen, C } from "./lib/shared.mjs";

async function main() {
  console.log(`${C.cyn}╔══════════════════════════════════════════╗${C.rst}`);
  console.log(`${C.cyn}║     Content Gap Analyzer                  ║${C.rst}`);
  console.log(`${C.cyn}╚══════════════════════════════════════════╝${C.rst}\n`);

  const gen = loadGen();
  const entries = Object.entries(gen);
  console.log(`  ${C.grn}→${C.rst} ${entries.length} artykułów w generated.json\n`);

  // extract all keywords
  const allKeywords = new Map();
  const topics = [];

  for (const [url, info] of entries) {
    const slug = info.slug;
    // extract keywords from slug
    const words = slug.replace(/-/g, " ").split(/\s+/).filter(w => w.length > 3);
    topics.push({ slug, date: info.date, source: url, words });

    for (const w of words) {
      allKeywords.set(w, (allKeywords.get(w) || 0) + 1);
    }
  }

  // keyword frequency
  console.log("  ── Najczęstsze słowa kluczowe ──");
  const topKws = [...allKeywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  topKws.forEach(([kw, count]) => console.log(`    ${kw.padEnd(20)} ${C.dim}×${count}${C.rst}`));

  // topic clustering
  console.log("\n  ── Artykuły w kolejności ──");
  topics.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  topics.forEach((t, i) => {
    console.log(`    ${i + 1}. ${C.grn}${t.slug.slice(0, 50)}${C.rst}`);
    console.log(`       ${C.dim}${t.words.slice(0, 5).join(", ")}${t.words.length > 5 ? "..." : ""}${C.rst}`);
  });

  // gap suggestions based on keyword clusters
  console.log("\n  ── Sugerowane tematy (luki) ──");
  const clusters = new Set();
  for (const [, kw] of topKws.slice(0, 5)) {
    if (!clusters.has(kw)) {
      const related = topics.filter(t => t.words.some(w => w === kw));
      if (related.length < 2) {
        console.log(`    ${C.ylw}→${C.rst} "${kw}" tylko ${related.length} artykuł(ów) — warto rozwinąć`);
        console.log(`       ${C.dim}node generate.mjs "Temat związany z ${kw}"${C.rst}`);
      }
    }
    clusters.add(kw);
  }

  // content type analysis
  console.log("\n  ── Podsumowanie ──");
  console.log(`    Artykułów: ${entries.length}`);
  console.log(`    Unikalnych słów kluczowych: ${allKeywords.size}`);
  console.log(`    Średnio słów/artykuł: ${(topics.reduce((s, t) => s + t.words.length, 0) / Math.max(1, topics.length)).toFixed(0)}`);
  console.log(`    Ostatni artykuł: ${topics[0]?.date?.slice(0, 10) || "brak"}`);
  console.log(`    Najstarszy artykuł: ${topics[topics.length - 1]?.date?.slice(0, 10) || "brak"}`);

  // save report
  const report = {
    date: new Date().toISOString(),
    articles: entries.length,
    topKeywords: topKws.map(([k, v]) => ({ keyword: k, count: v })),
    topics: topics.map(t => ({ slug: t.slug, date: t.date, keywords: t.words.join(", ") })),
  };
  writeFileSync("gap-report.json", JSON.stringify(report, null, 2));
  console.log(`\n  ${C.dim}→ Raport zapisany do gap-report.json${C.rst}\n`);
}

main();
