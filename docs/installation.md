## Wymagania

- [Node.js 18+](https://nodejs.org/)
- [Ollama](https://ollama.com/) z przynajmniej jednym modelem

## Instalacja

```powershell
git clone https://github.com/PKrokosz/smartbuyers.git
cd smartbuyers
npm install
```

## Modele Ollamy (minimum jeden)

```powershell
ollama pull qwen2.5:1.5b    # szybki (~1GB, do testów)
ollama pull qwen3.5:4b      # zbalansowany (~3.4GB)
ollama pull qwen2.5:latest  # pełny (~4.7GB, najlepsza jakość)
```

## Konfiguracja RSS (opcjonalnie)

Edytuj `feeds.json`:
```json
[
  {
    "name": "TechCrunch AI",
    "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "lastGuid": null
  }
]
```

Dodaj dowolny RSS feed. `lastGuid` aktualizuje się automatycznie.

## Harmonogram (Windows)

```powershell
# Skonfiguruj Task Scheduler na 30 minut
# (lub uruchom ręcznie: node rss-watch.mjs)
```
