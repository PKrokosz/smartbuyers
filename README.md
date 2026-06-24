<div align="center">

# SmartBuyers

**AI-powered SEO content engine** — RSS → AI → HTML → GitHub Pages.

[![Node version](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a?style=flat-square)](https://nodejs.org)
[![Ollama](https://img.shields.io/badge/Ollama-required-ff7000?style=flat-square)](https://ollama.com)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-222?style=flat-square)](https://pkrokosz.github.io/smartbuyers)
[![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](LICENSE)
<br>
[![site](https://img.shields.io/badge/site-pkrokosz.github.io/smartbuyers-159957?style=flat-square)](https://pkrokosz.github.io/smartbuyers)
[![articles](https://img.shields.io/badge/articles-articles/index.html-159957?style=flat-square)](https://pkrokosz.github.io/smartbuyers/articles/)

[Features](#features) • [Getting Started](#getting-started) • [Usage](#usage) • [Architecture](#architecture) • [Project Structure](#project-structure)

</div>

SmartBuyers monitors RSS feeds, generates structured SEO articles using a local LLM (Ollama), and publishes them to GitHub Pages — fully automated. It runs entirely on your hardware with zero API costs, or optionally uses OpenRouter for cloud-based models.

## Features

- **AI Article Generation** — 8 content formats (article, list, how-to, FAQ, comparison, opinion, digest, myth-buster), 5 writing personas, 4 tones, 2 languages (PL/EN)
- **RSS Feed Monitoring** — Watches multiple feeds, deduplicates by GUID, filters by keywords, supports dynamic Google News query rotation
- **SEO-ready HTML** — Schema.org JSON-LD, Open Graph, Twitter Cards, meta tags, sitemap.xml, RSS feed.xml
- **Competitor Tracking** — Track competitor feeds in a separate log (`mode: "track"`), analyzed in gap reports
- **Content Gap Analysis** — TF-IDF keyword extraction from article HTML, identifies sparse topics, produces structured `gap-report.json`
- **Distribution Pipeline** — Auto git push to GitHub Pages, Google Indexing API ping, LinkedIn auto-post, weekly newsletter digest
- **Local-first** — Runs on Ollama (no API costs). Optional OpenRouter for cloud models
- **Menu-driven** — `node menu.mjs` provides access to all features without remembering CLI flags

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Ollama](https://ollama.com) with at least one model pulled

```bash
# Clone
git clone https://github.com/PKrokosz/smartbuyers.git
cd smartbuyers

# Install
npm install

# Pull a model (gemma4:e4b recommended for Polish SEO content)
ollama pull gemma4:e4b
```

> [!TIP]
> For optimal output quality, use a model with at least 7B parameters. Smaller models like `qwen2.5:1.5b` work but produce less nuanced articles.

## Usage

The easiest way to use SmartBuyers is through the interactive menu:

```bash
node menu.mjs
```

This provides access to all features:

| # | Mode | Description |
|---|------|-------------|
| 1 | **Generate from topic** | Enter any topic, get a full SEO article |
| 2 | **Generate from RSS** | Pick a news item from any RSS feed |
| 3 | **Auto-watch RSS** | Continuous generation from configured feeds |
| 4 | **Review RSS** | Manual review before each article is generated |
| 5 | **Gap analysis** | TF-IDF keyword analysis + competitor tracking |
| 6 | **Newsletter** | Generate weekly HTML digest |
| 7 | **Settings** | Change model, format, persona, tone, language, query rotation |

### Settings

Settings are persisted in `settings.json`. Access them via the menu or edit directly:

```json
{
  "model": "gemma4:e4b",
  "format": "article",
  "persona": "journalist",
  "tone": "casual",
  "lang": "pl",
  "queries": 0
}
```

> [!NOTE]
> Setting `queries` to a number (1-20) enables dynamic Google News rotation. For each run, N random queries are picked from `queries.json` and constructed as Google News RSS feeds — providing continuous fresh content.

### RSS Feeds

Configure feeds in `feeds.json`:

```json
[
  {
    "name": "TechCrunch AI",
    "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
    "mode": "generate",
    "filter": null
  },
  {
    "name": "Competitor Blog",
    "url": "https://competitor.com/blog/feed/",
    "mode": "track",
    "filter": null
  }
]
```

Two modes are available:
- **`generate`** — generates articles from matching feed items
- **`track`** — logs items to `competitors.json` for gap analysis (no article generation)

The optional `filter` array restricts processing to items matching any keyword.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_INDEXING_KEY` | Google Indexing API key for instant indexing pings |
| `OPENROUTER_KEY` | Enables cloud models via OpenRouter (overrides local Ollama) |
| `LINKEDIN_TOKEN` | LinkedIn OAuth token for auto-posting |

## Architecture

```
menu.mjs                          # Interactive CLI menu
  ├── generate.mjs                # Single article from topic or RSS
  │     ├── lib/shared.mjs        # Colors, prompts, validation, streaming,
  │     │                         # HTML builder, git, sitemap, feed, Indexing API
  │     └── social.mjs            # LinkedIn auto-poster
  ├── rss-watch.mjs               # Automated RSS watcher
  │     ├── lib/shared.mjs        # (same shared module)
  │     ├── social.mjs            # LinkedIn post on push
  │     └── newsletter.mjs        # Weekly digest generator
  ├── analyze.mjs                 # Content gap + competitor analysis
  └── newsletter.mjs              # Standalone newsletter builder
```

### Data Flow

```
RSS feed / topic → prompt builder (format+persona+tone+lang)
                → Ollama/OpenRouter streaming
                → JSON validation + retry
                → HTML builder (Schema.org, OG, Twitter)
                → save to articles/ + mark in generated.json
                → regenerate index.html, sitemap.xml, feed.xml
                → git push → Google Indexing ping → LinkedIn post
```

### Deduplication

All scripts share `generated.json` as the single source of truth. Each generated article is mapped by its source URL to a slug and date. The same news item is never generated twice — across any mode.

```json
{
  "https://techcrunch.com/...": { "slug": "ai-breakthrough-2026", "date": "2026-06-24" }
}
```

## Project Structure

```
smartbuyers/
├── menu.mjs              # Entry point — interactive menu
├── generate.mjs          # Topic/RSS article generator
├── rss-watch.mjs         # Automated RSS watcher
├── analyze.mjs           # Content gap + TF-IDF analyzer
├── newsletter.mjs        # Weekly newsletter builder
├── social.mjs            # LinkedIn auto-poster
├── lib/
│   └── shared.mjs        # Shared module (34 exports, 485 lines)
├── feeds.json            # RSS feed configuration
├── queries.json          # Google News query pool (68 queries)
├── generated.json        # Deduplication state
├── competitors.json      # Competitor tracking data
├── settings.json         # Persisted user settings
├── gap-report.json       # Latest analysis report
├── articles/             # Generated HTML + index + sitemap + feed
├── _posts/               # Jekyll blog posts
└── _config.yml           # GitHub Pages configuration
```

## Automation (Windows Task Scheduler)

```powershell
# Create a scheduled task running every 30 minutes
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument "D:\smartbuyers\rss-watch.mjs" -WorkingDirectory "D:\smartbuyers"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 30) -AtStartup
Register-ScheduledTask -TaskName "SmartBuyers RSS" -Action $action -Trigger $trigger -RunLevel Highest
```

