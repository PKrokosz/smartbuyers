import { createInterface } from "readline";
import { spawnSync } from "child_process";
import { existsSync } from "fs";

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

function run(cmd, ...args) {
  rl.close();
  const full = [cmd, ...args];
  console.log(`\n  → node ${full.join(" ")}\n`);
  const r = spawnSync("node", full, { cwd: process.cwd(), stdio: "inherit" });
  if (r.error) console.error(`  Błąd: ${r.error.message}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║          SmartBuyers v3                  ║");
  console.log("╚══════════════════════════════════════════╝\n");

  console.log("  1. Generuj z tematu  — wpisujesz własny temat");
  console.log("  2. Generuj z RSS     — wybierasz newsa z feedu");
  console.log("  3. Auto-watch RSS    — automat: nowe newsy → generuj → push");
  console.log("  4. Review RSS        — przeglądasz każdy news przed generowaniem");
  console.log("  5. Wyjście\n");

  const pick = parseInt(await ask("  Wybierz (1-5): "), 10);

  if (pick === 1) {
    run("generate.mjs");
  } else if (pick === 2) {
    const url = (await ask("  URL feedu RSS [Enter=TechCrunch AI]: ")).trim();
    const rssUrl = url || "https://techcrunch.com/category/artificial-intelligence/feed/";
    const dopush = (await ask("  Push na git po zapisie? [t/n, Enter=t]: ")).trim().toLowerCase();
    run("generate.mjs", "--rss", rssUrl, ...(dopush !== "n" ? ["--push"] : []));
  } else if (pick === 3) {
    if (!existsSync("feeds.json") && !existsSync("rss-watch.mjs")) {
      console.log("  Najpierw uruchom opcję 2 żeby skonfigurować feedy.");
      rl.close(); return;
    }
    run("rss-watch.mjs");
  } else if (pick === 4) {
    run("rss-watch.mjs", "--review");
  } else {
    console.log("  Do widzenia!");
    rl.close();
  }
}
main();
