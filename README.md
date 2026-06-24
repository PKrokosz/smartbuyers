# SmartBuyers — AI Content Engine

**Autonomiczny generator artykułów SEO** — RSS → Ollama → HTML → GitHub Pages.

- 📡 Pełny pipeline: RSS feed → polski artykuł → auto-publikacja
- 🧠 Lokalna AI (Ollama) — zero kosztów API
- 🔍 SEO-ready: Schema.org JSON-LD, Open Graph, sitemap.xml
- 🛡️ Deduplikacja przez `generated.json`
- ⏰ Auto-harmonogram: Windows Task Scheduler co 30 min

Strona: [pkrokosz.github.io/smartbuyers](https://pkrokosz.github.io/smartbuyers/)
Artykuły: [pkrokosz.github.io/smartbuyers/articles/](https://pkrokosz.github.io/smartbuyers/articles/)

---

## Struktura

```
smartbuyers/
├── menu.mjs             # 🔷 Punkt startowy — jedno menu, wszystkie opcje
├── generate.mjs         # Generator (temat własny lub --rss picker)
├── rss-watch.mjs        # Automat RSS → AI → push (auto lub --review)
├── lib/
│   └── shared.mjs       # Współdzielony moduł (C, esc, buildHtml, gitPush, ...)
├── feeds.json           # Konfiguracja RSS feedów
├── generated.json       # Stan deduplikacji (współdzielony między skryptami)
├── articles/            # Wygenerowane artykuły HTML + index.html + sitemap.xml
├── _posts/              # Posty Jekyll (markdown)
├── _config.yml          # GitHub Pages (motyw Cayman)
├── ROADMAP.md           # Plan rozwoju — 5 faz do TRYSORO-class quality
└── docs/                # Dokumentacja strukturalna
```

---

## Instalacja

```powershell
git clone https://github.com/PKrokosz/smartbuyers.git
cd smartbuyers
npm install
```

**Wymagania**: Node.js 18+, Ollama z minimum jednym modelem:

```powershell
ollama pull qwen2.5:1.5b    # szybki (~1GB)
ollama pull qwen3.5:4b      # zbalansowany (~3.4GB)
ollama pull qwen2.5:latest  # pełny (~4.7GB, najlepsza jakość)
```

---

## Użycie

```powershell
node menu.mjs
```

| # | Tryb | Komenda bez menu |
|---|------|-----------------|
| 1 | **Generuj z tematu** | `node generate.mjs "temat"` |
| 2 | **Generuj z RSS** | `node generate.mjs --rss URL --push` |
| 3 | **Auto-watch RSS** | `node rss-watch.mjs` |
| 4 | **Review RSS** | `node rss-watch.mjs --review` |

### Przepływ generowania

```
temat/RSS → system prompt + few-shot → warmup modelu → streaming → walidacja + retry → HTML
```

Każdy artykuł HTML zawiera:
- `<meta description>`, `<meta keywords>`
- **Schema.org** `Article` JSON-LD
- **Open Graph** (`og:title`, `og:description`, `og:type`)
- **Twitter Card** (`twitter:card`)
- Responsywny CSS + link do źródła

### Deduplikacja

`generated.json` — współdzielony stan:

```json
{ "https://techcrunch.com/.../ai-revolution/": { "slug": "...", "date": "..." } }
```

Wszystkie tryby sprawdzają ten plik — ten sam news nigdy nie jest generowany dwa razy.

### Auto-index

Po każdej generacji:
- `articles/index.html` — lista wszystkich artykułów z datami
- `articles/sitemap.xml` — dla Google (`<lastmod>` z git log)

---

## Flagi

### `generate.mjs`

| Flaga | Opis |
|-------|------|
| `--rss URL` | Pobiera RSS, pokazuje picker newsów |
| `--push` | Auto git commit + push po zapisie |
| `--verbose` / `-v` | Pełny prompt i surowa odpowiedź |
| `--format X` | Typ artykułu: `article`, `list`, `howto`, `explainer`, `vs`, `myth`, `faq`, `digest`, `opinion` |
| `--persona X` | Styl pisania: `journalist`, `marketer`, `technical`, `ceo`, `customer` |
| `--tone X` | Ton: `casual`, `formal`, `educational`, `urgent` |
| `--lang X` | Język wyjściowy: `pl`, `en` |

```powershell
# Artykuł w formacie Top 5, styl marketera, swobodny ton
node generate.mjs --format list --persona marketer --tone casual "Narzędzia dropshipping"

# Poradnik how-to po angielsku
node generate.mjs --format howto --lang en "How to start dropshipping"

# FAQ z RSS, formalny ton
node generate.mjs --rss https://techcrunch.com/category/ai/feed/ --format faq --tone formal --push
```

### `rss-watch.mjs`

| Flaga | Opis |
|-------|------|
| `--review` | Pyta przed każdym newsem: `[g]/[p]/[q]` |
| `--digest` | Zbiera wiele newsów w jeden artykuł-przegląd |
| `--verbose` / `-v` | Pełny prompt i surowa odpowiedź |
| `--format X` | J.w. (8 typów) |
| `--persona X` | J.w. (5 stylów) |
| `--tone X` | J.w. (4 tony) |
| `--lang X` | J.w. (`pl`, `en`) |

### feeds.json — konfiguracja RSS

```json
[
  { "name": "TechCrunch AI", "url": "...", "filter": null },
  { "name": "Google News: dropshipping PL", "url": "...", "filter": null },
  { "name": "Hacker News", "url": "...", "filter": ["ai", "startup", "saas", "ecommerce"] }
]
```

Pole `filter` — lista słów kluczowych. Jeśli ustawione, tylko newsy zawierające którekolwiek słowo przechodzą dalej.

---

## Rozwój

Zobacz [ROADMAP.md](ROADMAP.md) — 5 faz do jakości narzędzi klasy TRYSORO:

1. ✅ Fundament
2. ✅ Content diversity
3. ✅ RSS intelligence
4. ✅ Content intelligence (internal linking, FAQ schema, gap analyzer, readability)
5. 📋 Dystrybucja
5. 📋 Dystrybucja (RSS feed bloga, social auto-post, newsletter)
