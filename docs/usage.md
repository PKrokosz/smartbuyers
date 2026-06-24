## Punkt startowy

```powershell
node menu.mjs
```

Menu daje dostęp do wszystkich 4 trybów pracy.

---

## Tryb 1: Generuj z tematu

Wpisujesz własny temat — model AI generuje polski artykuł SEO.

```powershell
node generate.mjs "Jak zacząć dropshipping B2B"
```

Bez argumentu — zapyta o temat interaktywnie. Model wybierasz z listy dostępnych w Ollamie.

**Przepływ**: temat → system prompt + few-shot → warmup modelu → streaming generowania → walidacja + retry → HTML z Schema.org → save → link

---

## Tryb 2: Generuj z RSS

Wybierasz newsa z feedu RSS — skrypt pobiera angielski news i generuje polski artykuł.

```powershell
node generate.mjs --rss "https://techcrunch.com/category/ai/feed/" --push
```

| Flaga | Opis |
|-------|------|
| `--rss URL` | Pobiera RSS, pokazuje picker newsów |
| `--push` | Auto git commit + push po zapisie |
| `--verbose` / `-v` | Pokazuje pełny prompt i surową odpowiedź |

**Picker pokazuje**: tytuł, datę, fragment treści, link źródłowy. Sprawdza `generated.json` — nie pokazuje już wygenerowanych newsów.

---

## Tryb 3: Auto-watch RSS

W pełni automatyczny — uruchamiany przez Task Scheduler co 30 minut.

```powershell
node rss-watch.mjs
```

1. Pobiera wszystkie feedy z `feeds.json`
2. Porównuje GUID z ostatnim znanym
3. Sprawdza `generated.json` (pomija już zrobione, nawet ręcznie przez Tryb 2)
4. Generuje artykuł dla każdego nowego newsa
5. Zapisuje HTML, aktualizuje index + sitemap
6. Git commit + push

**Rolling window safety**: maks 5 nowych newsów na feed (gdy stary GUID wypadł z RSS).

---

## Tryb 4: Review RSS

Przed każdym nowym newsem pyta: `[g]eneruj / [p]omiń / [q]wyjdź`.

```powershell
node rss-watch.mjs --review
```

---

## Wynik: HTML z pełnym SEO

Każdy wygenerowany artykuł zawiera:
- `<title>`, `<meta description>`, `<meta keywords>`
- Schema.org `Article` JSON-LD
- `og:title`, `og:description`, `og:type` (Open Graph)
- `twitter:card`, `twitter:title`, `twitter:description`
- Responsywny CSS (system-ui font, max-width 800px)
- Link do źródłowego newsa (`rel="nofollow"`)
- Stopka z datą generowania i nazwą modelu

## Wynik: Index i Sitemap

- `articles/index.html` — lista wszystkich artykułów (RSS + tematowe), sortowana po dacie
- `articles/sitemap.xml` — dla Google, z `<lastmod>` z git log

## Wynik: Deduplikacja

`generated.json` — współdzielony stan między wszystkimi trybami:
```json
{
  "https://techcrunch.com/2026/06/23/ai-revolution/": {
    "slug": "sztuczna-inteligencja-zmienia-e-commerce",
    "date": "2026-06-24T12:00:00.000Z"
  }
}
```

Tryb 2 (ręczny RSS) i Tryb 3 (auto) sprawdzają ten plik — ten sam news nigdy nie jest generowany dwa razy.

---

## Zmienne środowiskowe

| Zmienna | Wymagana | Opis |
|---------|----------|------|
| `GOOGLE_INDEXING_KEY` | Opcjonalna | Token OAuth 2.0 do Google Indexing API. Po pushu nowego artykułu pinguje Google żeby przyspieszyć crawlowanie. Pobierz z Google Cloud Console → APIs & Services → Credentials. |
| `OPENROUTER_KEY` | Opcjonalna | Klucz API OpenRouter. Gdy ustawiony, używa OpenRouter zamiast lokalnej Ollamy. |
