---
goal: SmartBuyers — Bug fixes through Phase 5 distribution completion
version: 1.0
date_created: 2026-06-24
owner: PKrokosz
status: Planned
tags: bug, feature, refactor, seo, distribution, content-intelligence
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

SmartBuyers is an AI Content Engine: RSS → Ollama → HTML → GitHub Pages. The ROADMAP.md claims 100% completion across 5 phases, but multiple gaps exist. This plan covers everything from blocking bugs (Phase A) through unfinished Phase 5 distribution features, plus UX and refactoring improvements. Each phase is independently executable and ordered by impact.

## 1. Requirements & Constraints

- **REQ-001**: All code changes must remain compatible with existing `generated.json` format
- **REQ-002**: No breaking changes to `feeds.json` schema without migration path
- **REQ-003**: Google Indexing API key stored in environment variable `GOOGLE_INDEXING_KEY`, never committed
- **REQ-004**: Social media API keys stored in environment variables, never committed
- **REQ-005**: Existing articles in `articles/` must continue to render correctly after any change
- **REQ-006**: Ollama is the primary provider; OpenRouter must remain a supported fallback
- **REQ-007**: All new features must be accessible from `menu.mjs`
- **REQ-008**: Deduplication via `generated.json` must be the single source of truth across all generation modes
- **CON-001**: Model used is `qwen2.5:1.5b` (default in rss-watch.mjs); no GPU available, must fit within 2GB VRAM
- **CON-002**: Repository is auto-pushed to GitHub Pages; generated HTML files must be valid standalone documents
- **CON-003**: No npm dependencies beyond existing `rss-parser` without explicit confirmation
- **GUD-001**: All shared logic belongs in `lib/shared.mjs`, not duplicated across scripts
- **GUD-002**: Follow existing code style: CommonJS imports (`import`/`export`), async/await, no TypeScript
- **GUD-003**: Console output uses `C` color constants from `lib/shared.mjs`
- **PAT-001**: Each generation path (topic, RSS-picker, auto-RSS) must check `generated.json` before generating
- **PAT-002**: All HTML output goes through `buildHtml()` in `lib/shared.mjs`
- **PAT-003**: After any write, regenerate index/sitemap/feed via `generateIndex()`, `generateSitemap()`, `generateFeed()`

## 2. Implementation Steps

### Implementation Phase A: Blocking Bugs

- GOAL-A: Fix runtime errors that prevent auto-RSS mode from working correctly

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-A01 | Add `isGen(url)` function to `lib/shared.mjs` at line 40 (after `markGen`): check if URL key exists in `generated.json`, returns boolean. Export it. | | |
| TASK-A02 | Add `isGen` to the import on `rss-watch.mjs` line 4 — add it after `markGen` in the destructured import from `./lib/shared.mjs` | | |
| TASK-A03 | Make model configurable in `rss-watch.mjs`: add `--model` flag parsing at line 7, fallback to existing `MODEL` constant. Parse using `parseFlag()` similar to line 13-16 pattern. Add `'--model'` to the `parseFlag`-compatible pattern. | | |
| TASK-A04 | Verify fix: run `node rss-watch.mjs` in dry mode (add `--dry-run` flag or confirm it no longer crashes on `isGen is not defined`) | | |

Files affected: `lib/shared.mjs` lines 38-40, `rss-watch.mjs` lines 4-8

### Implementation Phase B: SEO Gaps (Phase 1 completion)

- GOAL-B: Implement Google Indexing API notification to accelerate Google crawling

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-B01 | Add `googleIndexingPing(pageUrl)` function to `lib/shared.mjs` after line 330 (gitPush area). POST to `https://indexing.googleapis.com/v3/urlNotifications:publish` with `{"url":"...","type":"URL_UPDATED"}`. Use `process.env.GOOGLE_INDEXING_KEY` for Bearer auth. Gracefully skip if env var not set. | | |
| TASK-B02 | Add `export function googleIndexingPing` to the export list in `lib/shared.mjs` | | |
| TASK-B03 | Call `googleIndexingPing(pageUrl)` in `generate.mjs` after successful git push (after line 221), passing the article URL | | |
| TASK-B04 | Call `googleIndexingPing(pageUrl)` in `rss-watch.mjs` after successful git push (after line 210), passing the first new article URL | | |
| TASK-B05 | Update `docs/usage.md` to document `GOOGLE_INDEXING_KEY` environment variable | | |

Files affected: `lib/shared.mjs` lines 330-340, `generate.mjs` line 221, `rss-watch.mjs` line 210, `docs/usage.md`

### Implementation Phase C: RSS Feed Expansion (Phase 3 gap)

- GOAL-C: Add 3 new RSS feeds covering product trends, tools, and video content

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-C01 | Add Amazon Best Sellers feed to `feeds.json`: `{"name":"Amazon Best Sellers","url":"https://www.amazon.com/gp/rss/bestsellers/","filter":["ecommerce","dropshipping","seller","business"]}` | | |
| TASK-C02 | Add ProductHunt feed to `feeds.json`: `{"name":"ProductHunt","url":"https://www.producthunt.com/feed?category=e-commerce","filter":["ecommerce","shopify","dropshipping","ai","saas"]}` | | |
| TASK-C03 | Add YouTube e-commerce feed to `feeds.json`: `{"name":"YouTube e-commerce","url":"https://www.youtube.com/feeds/videos.xml?channel_id=UCe2fS1D3Nk6_pw4oJ2UqW8g","filter":["dropshipping","ecommerce","shopify","aliexpress"]}` (placeholder channel; user can replace ID later) | | |
| TASK-C04 | Validate all 3 feeds parse correctly: run `node -e "new (require('rss-parser'))().parseURL('...').then(r=>console.log(r.items.length))"` for each | | |

Files affected: `feeds.json`

### Implementation Phase D: Content Intelligence (Phase 4 gap)

- GOAL-D: Add competitor tracking mode and improve content gap analysis

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-D01 | Add `"mode": "generate"` field to all existing feed entries in `feeds.json` (default mode) | | |
| TASK-D02 | In `rss-watch.mjs` main loop (around line 130-180): add `if (feed.mode === 'track')` branch. Instead of generating articles, log new items to `competitors.json` with `{name, title, link, date, feedName}`. Append, don't overwrite. | | |
| TASK-D03 | Create `competitors.json` initial file: `[]` | | |
| TASK-D04 | Update `analyze.mjs`: instead of extracting keywords from slugs (current line 20), read actual HTML body of each article in `articles/` directory. Extract word frequency from stripped text content (remove HTML tags). Group by TF-like frequency. | | |
| TASK-D05 | Update `analyze.mjs` line 42-53 gap suggestions: generate suggested topic prompts based on top keywords that appear in < 3 articles. Output a ready-to-run `node generate.mjs "Suggested Topic"` command for each. | | |
| TASK-D06 | Update `analyze.mjs` competitor analysis section: read `competitors.json`, count frequency per competitor, identify trending topics across competitors. | | |

Files affected: `feeds.json`, `rss-watch.mjs` lines 130-180, `competitors.json`, `analyze.mjs` lines 20-70

### Implementation Phase E: Distribution (Phase 5 gap)

- GOAL-E: Auto-post generated articles to LinkedIn and generate weekly newsletter digest

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-E01 | Create `social.mjs`: export `async function postToLinkedIn(title, desc, url)`. POST to `https://api.linkedin.com/v2/ugcPosts` with OAuth 2.0 Bearer token from `process.env.LINKEDIN_TOKEN`. Share as article URL. Gracefully skip if token not set. | | |
| TASK-E02 | Add `postToLinkedIn` call in `generate.mjs` after successful git push (after line 221), passing article title, description, and URL | | |
| TASK-E03 | Add `postToLinkedIn` call in `rss-watch.mjs` after successful git push (after line 210), passing last generated article info | | |
| TASK-E04 | Create `newsletter.mjs`: export `async function generateNewsletter()`. Read last 7 days of `generated.json` entries, pick top 5 by date. Generate HTML email template with excerpts and links. Save to `articles/newsletter-latest.html`. | | |
| TASK-E05 | Add `--newsletter` flag to `rss-watch.mjs`: when set, call `generateNewsletter()` after processing feeds | | |
| TASK-E06 | Update `docs/usage.md` to document `LINKEDIN_TOKEN` environment variable and `--newsletter` flag | | |

Files affected: `social.mjs` (new), `generate.mjs` line 221, `rss-watch.mjs` line 210, `newsletter.mjs` (new), `docs/usage.md`

### Implementation Phase F: UX & Refactoring

- GOAL-F: Polish the user interface, eliminate code duplication, improve developer experience

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-F01 | Update `menu.mjs` option 1 (Generuj z tematu): add sub-menu for `--format`, `--persona`, `--tone`, `--lang` selection before launching `generate.mjs`. Pass selected values as CLI flags. Defaults match `DEF_FORMAT`, `DEF_PERSONA`, `DEF_TONE`, `DEF_LANG`. | | |
| TASK-F02 | Update `menu.mjs` option 2 (Generuj z RSS): add same sub-menu for format/persona/tone/lang before asking for RSS URL. | | |
| TASK-F03 | Add option 6 "Analiza treści (gap analyzer)" to `menu.mjs` main menu that runs `node analyze.mjs` | | |
| TASK-F04 | Extract common `generate()` function from `generate.mjs` lines 12-45 and `rss-watch.mjs` lines 19-36 into `lib/shared.mjs` as `export async function generateArticle(model, systemPrompt, userContent, minWords, attempt)`. Both scripts import and call the shared version. | | |
| TASK-F05 | Verify `menu.mjs` all 6 options work end-to-end | | |

Files affected: `menu.mjs` lines 17-49, `lib/shared.mjs` (new function), `generate.mjs` lines 12-45, `rss-watch.mjs` lines 19-36

## 3. Alternatives

- **ALT-A: Python rewrite instead of patching Node.js** — Rejected. The existing pipeline works; a rewrite would introduce risk and delay. Incremental fixes preserve the working investment.
- **ALT-B: Use n8n / Make.com for distribution instead of custom scripts** — Rejected. Adds external dependency and API cost. Custom scripts keep everything local and version-controlled.
- **ALT-C: Single monolithic script instead of menu.mjs + sub-scripts** — Rejected. Separation of concerns allows independent execution (e.g., rss-watch via Task Scheduler) without menu overhead.
- **ALT-D: Google Indexing API via `googleapis` npm package** — Rejected. Only 1 POST endpoint needed; raw `fetch` avoids a 500KB+ dependency for 3 lines of HTTP.
- **ALT-E: Save all generated articles to `_posts/` for Jekyll instead of HTML** — Rejected. Jekyll-based approach was an earlier experiment; the current HTML-in-articles/ approach is simpler and avoids build-step latency for GitHub Pages.

## 4. Dependencies

- **DEP-001**: `rss-parser` npm package (already installed) — all RSS parsing
- **DEP-002**: Ollama running locally with at least one model pulled (`qwen2.5:1.5b` or similar) — all generation workflows
- **DEP-003**: GitHub CLI (`gh`) installed and authenticated — git push to remote
- **DEP-004**: `GOOGLE_INDEXING_KEY` environment variable (optional) — Phase B Google Indexing API ping
- **DEP-005**: `LINKEDIN_TOKEN` environment variable (optional) — Phase E LinkedIn auto-post
- **DEP-006**: Node.js >= 18 (for global `fetch`) — already satisfied by v24.16.0

## 5. Files

- **FILE-001**: `lib/shared.mjs` (existing, 469 lines) — add `isGen`, `googleIndexingPing`, `generateArticle`; shared constants and helpers
- **FILE-002**: `rss-watch.mjs` (existing, 218 lines) — fix import, fix model hardcode, add tracking mode, add newsletter flag, deduplicate `generate()`
- **FILE-003**: `generate.mjs` (existing, 231 lines) — add Google Indexing ping, LinkedIn post, deduplicate `generate()`
- **FILE-004**: `menu.mjs` (existing, 50 lines) — add format/persona/tone/lang sub-menus, add gap analyzer option
- **FILE-005**: `analyze.mjs` (existing, 74 lines) — rewrite keyword extraction from content, add competitor analysis
- **FILE-006**: `feeds.json` (existing, 46 lines) — add `mode` field, add 3 new feeds
- **FILE-007**: `social.mjs` (new) — LinkedIn auto-post module
- **FILE-008**: `newsletter.mjs` (new) — newsletter digest generator
- **FILE-009**: `docs/usage.md` (existing) — document new env vars and flags
- **FILE-010**: `competitors.json` (new) — competitor tracking data store

## 6. Testing

- **TEST-001**: Run `node rss-watch.mjs` — must not crash with `isGen is not defined`. Confirm "Brak nowych wpisów" since generated.json is current.
- **TEST-002**: Run `node generate.mjs "test"` — must generate an HTML file in `articles/`, update `generated.json`, regenerate `articles/index.html`, `articles/sitemap.xml`, `articles/feed.xml`.
- **TEST-003**: Run `node analyze.mjs` — must output keyword frequencies and saved `gap-report.json` with valid structure.
- **TEST-004**: Run `node menu.mjs` option 1 — must show format/persona/tone/lang sub-menu before prompting for topic.
- **TEST-005**: Run `node menu.mjs` option 3 — must not crash (auto-RSS path).
- **TEST-006**: Verify that `articles/index.html` loads in browser without broken links (all article URLs resolve).
- **TEST-007**: Verify that `articles/sitemap.xml` passes W3C XML validation (no unclosed tags, valid URL structure).
- **TEST-008**: Run `node -e "new (require('rss-parser'))().parseURL('https://www.producthunt.com/feed?category=e-commerce').then(r=>console.log(r.items.length))"` — confirm > 0 items.

## 7. Risks & Assumptions

- **RISK-001**: Ollama may be offline when rss-watch.mjs runs (Task Scheduler) — mitigated by warmup check and graceful skip
- **RISK-002**: Google Indexing API daily quota (200 URLs/day for free tier) — mitigated by gating with env var check; user controls enablement
- **RISK-003**: LinkedIn API token expires every 60 days — mitigated by clear error message in logs; user must re-authenticate
- **RISK-004**: YouTube feed channel ID may change over time — mitigated by storing it in feeds.json where user can easily edit
- **RISK-005**: Competitor `competitors.json` will grow unbounded — mitigated by its append-only design; user can manually clear it
- **ASSUMPTION-001**: Node.js `fetch` (global) is available — confirmed by Node v24.16.0
- **ASSUMPTION-002**: The `git push` at the end of rss-watch.mjs succeeds (user identity is set) — confirmed by previous session
- **ASSUMPTION-003**: GitHub Pages serves `articles/` directory as-is — confirmed by existing deployment
- **ASSUMPTION-004**: No concurrent writes to `generated.json` (single-user, single-process) — safe assumption for local usage
- **ASSUMPTION-005**: All new RSS feed URLs are publicly accessible without authentication — confirmed for Amazon RSS, ProductHunt, YouTube public feeds

## 8. Related Specifications / Further Reading

- https://developers.google.com/indexing/reference/rest/v3/URLNotifications.publish
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/ugc-post-api
- https://github.com/rbren/rss-parser (documentation for existing dependency)
- ROADMAP.md — https://github.com/PKrokosz/smartbuyers/blob/master/ROADMAP.md
- `docs/usage.md` — local documentation for current CLI flags
