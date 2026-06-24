# SmartBuyers — Blog + Generator Artykułów AI

Strona publikowana na GitHub Pages: [https://pkrokosz.github.io/smartbuyers/](https://pkrokosz.github.io/smartbuyers/)

Blog Jekyll: [https://pkrokosz.github.io/smartbuyers/blog/](https://pkrokosz.github.io/smartbuyers/blog/)

## Struktura repozytorium

```
smartbuyers/
├── _config.yml          # Konfiguracja GitHub Pages (motyw Cayman)
├── _posts/              # Posty Jekyll (markdown, data w nazwie)
├── articles/            # Wygenerowane artykuły HTML (autonomiczne strony)
├── menu.mjs             # 🔷 Punkt startowy — jedno menu, wszystkie opcje
├── generate.mjs         # Generator artykułów SEO (temat własny lub --rss)
├── rss-watch.mjs        # Automat RSS → AI → push (auto lub --review)
├── feeds.json           # Konfiguracja RSS feedów
├── package.json         # Zależności Node (rss-parser)
├── index.md             # Główna strona (karta wiedzy SelleeTools)
├── blog.md              # Podstrona bloga
└── README.md            # Ten plik
```

## Szybki start

```
node menu.mjs
```

Jedno menu daje dostęp do wszystkich funkcji:

1. **Generuj z tematu** — wpisujesz własny temat, wybierasz model, generujesz
2. **Generuj z RSS** — wybierasz feed RSS, picker newsów, generujesz + opcjonalny push
3. **Auto-watch RSS** — automat: sprawdza feed co 30min (Task Scheduler), nowe newsy → generuj → push
4. **Review RSS** — przeglądasz każdy nowy news, decydujesz [g]eneruj / [p]omiń / [q]wyjdź

Interaktywny skrypt Node.js, który generuje artykuły SEO przez lokalną Ollamę (lub OpenRouter) i zapisuje jako HTML do `articles/`.

### Wymagania

- [Node.js 18+](https://nodejs.org/)
- [Ollama](https://ollama.com/) z modelem (np. `qwen2.5:latest`, `qwen2.5:1.5b`, `qwen3.5:4b`)

### Użycie

**Interaktywne menu:**
```
node generate.mjs
```

**Z linii poleceń (temat + model):**
```
node generate.mjs "Czym jest dropshipping B2B" qwen2.5:1.5b
```

**Z OpenRouter (zamiast lokalnej Ollamy):**
```
$env:OPENROUTER_KEY = "sk-or-..."
node generate.mjs "temat"
```

### Modele

| Model | Rozmiar | Szybkość | Uwagi |
|-------|---------|----------|-------|
| `qwen2.5:latest` | 4.7 GB | ~100-180s | Domyślny, stabilny |
| `qwen2.5:1.5b` | 1.0 GB | ~15-30s | Szybki do testów |
| `qwen3.5:4b` | 3.4 GB | ~? | Z `think:false` |
| `qwen3.5:0.8b` | 0.8 GB | ~5-10s | Najszybszy |

### Proces

1. Uruchom `node generate.mjs`
2. Wybierz temat i model
3. Skrypt wysyła prompt do Ollamy (z `think:false` dla qwen3.5)
4. Odpowiedź JSON jest parsowana i zapisywana jako HTML w `articles/`
5. Po pushu na GitHub, artykuł dostępny pod:
   `https://pkrokosz.github.io/smartbuyers/articles/nazwa.html`

### Przykład

```powershell
cd C:\Users\admin\Desktop\smartbuyers
node generate.mjs "Jak zacząć dropshipping B2B" qwen2.5:1.5b
git add articles/nazwa-artykulu.html
git commit -m "Add article: nazwa-artykulu"
git push
```

## Publikowanie na GitHub Pages

1. Wygeneruj artykuł: `node generate.mjs "temat"`
2. Dodaj do repozytorium: `git add articles/`
3. Commit: `git commit -m "Add article: ..."`
4. Push: `git push`
5. Gotowe: `https://pkrokosz.github.io/smartbuyers/articles/nazwa.html`

> Artykuły HTML w `articles/` są autonomiczne – zawierają pełny `<html>` z inline CSS, nie wymagają Jekyll.
> Posty w `_posts/` to markdown dla bloga Jekyll.

## Automat: RSS → AI → Blog (`rss-watch.mjs`)

Skrypt pobiera angielskie newsy z RSS (TechCrunch AI), tłumaczy i przerabia na polskie artykuły SEO przez Ollamę, zapisuje do `articles/` i auto-pushuje na GitHub.

### Instalacja

```
npm install
```

### Użycie

```powershell
node rss-watch.mjs
```

Pierwsze uruchomienie zapamiętuje najnowszy wpis. Kolejne generują artykuły dla nowych newsów i pusłują na GitHub.

### Konfiguracja (`feeds.json`)

```json
[
  {
    "name": "TechCrunch AI",
    "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "lastGuid": null
  }
]
```

Dodaj dowolny RSS feed. `lastGuid` jest aktualizowany automatycznie przy każdym uruchomieniu.
