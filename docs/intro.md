# SmartBuyers — AI Content Engine

**Autonomiczny generator artykułów SEO** dla bloga B2B. Pobiera angielskie newsy przez RSS, tłumaczy i przetwarza na polskie artykuły przez lokalną Ollamę, publikuje automatycznie na GitHub Pages.

- 📡 **RSS → AI → HTML → GitHub Pages** — pełny pipeline bez ręcznej pracy
- 🧠 **Lokalna AI** przez Ollamę (`qwen2.5`, `qwen3.5`) — zero kosztów API
- 🔍 **SEO-ready** — Schema.org JSON-LD, Open Graph, sitemap.xml, meta tags
- 🛡️ **Deduplikacja** — `generated.json` pilnuje, żeby żaden news nie powstał dwa razy
- ⏰ **Auto-harmonogram** — Windows Task Scheduler co 30 minut
- 📊 **Pełna telemetria** — każdy krok widoczny w konsoli z kolorami ANSI

Strona: [pkrokosz.github.io/smartbuyers](https://pkrokosz.github.io/smartbuyers/)
