import Parser from "rss-parser";
import { isGen } from "./lib/shared.mjs";

const url = "https://news.google.com/rss/search?q=dropshipping+polska&hl=pl&gl=PL&ceid=PL:pl";

const parser = new Parser();
const parsed = await parser.parseURL(url);

console.log(`Items: ${parsed.items.length}`);
for (let i = 0; i < Math.min(5, parsed.items.length); i++) {
  const item = parsed.items[i];
  console.log(`\n--- Item ${i} ---`);
  console.log(`title:      ${JSON.stringify(item.title)}`);
  console.log(`link:       ${JSON.stringify(item.link)}`);
  console.log(`guid:       ${JSON.stringify(item.guid)}`);
  console.log(`guid type:  ${typeof item.guid}`);
  console.log(`content:    ${(item.content || "").slice(0, 100)}`);
  console.log(`contentSnippet: ${(item.contentSnippet || "").slice(0, 100)}`);
  console.log(`isoDate:    ${JSON.stringify(item.isoDate)}`);
  console.log(`pubDate:    ${JSON.stringify(item.pubDate)}`);
  const link = item.link || item.guid;
  console.log(`isGen(link): ${isGen(link)}`);
  console.log(`isGen(guid): ${isGen(item.guid)}`);
}
