/* ===========================
   SmartBuyers v3 — App Logic
   =========================== */

(function() {
  'use strict';

  // --- Dicts (matching server-side labels) ---
  const FORMAT_OPTS = { article:'Standard', list:'Top lista', howto:'Poradnik', explainer:'Czym jest X', vs:'Porównanie', myth:'Mit czy fakt', faq:'FAQ', digest:'Przegląd', opinion:'Opinia' };
  const PERSONA_OPTS = { journalist:'Dziennikarz', marketer:'Marketer', technical:'Technical Writer', ceo:'CEO/Founder', customer:'Klient' };
  const TONE_OPTS = { casual:'Swobodny', formal:'Formalny', educational:'Edukacyjny', urgent:'Pilny' };
  const LANG_OPTS = { pl:'Polski', en:'English' };
  const NB_NOTEBOOKS = {
    sandbox: { id:'ab97b6a3', title:'Sandbox', icon:'🧪', desc:'Notebook testowy' },
    news: { id:'5dd3bcd8', title:'News Digest', icon:'📰', desc:'Digest z kanałów RSS' },
    research: { id:'7a31df6c', title:'Deep Research', icon:'🔬', desc:'Badania tematyczne' },
    audio: { id:'992ecd72', title:'Audio Studio', icon:'🎙️', desc:'Podcasty i audio' },
    sources: { id:'9ebb1726', title:'Sources', icon:'📚', desc:'Źródła i materiały' },
    ads: { id:'7410e5aa', title:'Competition', icon:'🏁', desc:'Analiza konkurencji' },
  };
  const ACTION_LABELS = {
    'generate-prompt':'Generowanie prompta','generate-feed':'Generowanie feeda','generate-rss':'Generowanie z RSS',
    'rss-check':'Sprawdzanie RSS','rss-images':'Generowanie obrazków','rss-feed':'Generowanie feeda RSS',
    'auto-watch':'Auto-watch','review':'Przegląd','review-fail':'Przegląd (fail)','analyze':'Analiza',
    'newsletter':'Generowanie newslettera','send-newsletter':'Wysyłanie newslettera',
    'warmup':'Warmup Ollama',
  };

  // --- State ---
  let navStack = [{ level: 'home' }];
  let settingsCache = {};
  let modelsList = [];
  let running = null; // { es, runId, tileAction, output, _progressTimer }
  let eventSource = null; // status SSE
  let jobHistory = []; // [{ action, label, status, time, output }]
  let nbAuthed = false; // NotebookLM auth state

  // --- DOM refs ---
  const $ = s => document.querySelector(s);
  const tilesEl = $('#tiles');
  const breadcrumbEl = $('#breadcrumb');
  const pageTitle = $('#pageTitle');
  const pageSub = $('#pageSub');
  const headerModel = $('#headerModel');
  const headerInfo = $('#headerInfo');
  const headerStatus = $('#headerStatus');
  const headerNbStatus = $('#headerNbStatus');
  const dialog = $('#dialog');
  const dialogOverlay = $('#dialogOverlay');
  const dialogTitle = $('#dialogTitle');
  const dialogBody = $('#dialogBody');
  const dialogActions = $('#dialogActions');
  const toast = $('#toast');
  const preloader = $('#preloader');
  const cursorDot = $('#cursorDot');
  const cursorRing = $('#cursorRing');

  // ===========================
  // Nav engine
  // ===========================
  function pushLevel(level) {
    if (running && level.level !== 'progress') { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
    navStack.push(level); render();
  }
  function popLevel() {
    if (running) { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
    if (navStack.length > 1) { navStack.pop(); render(); }
  }
  function currentLevel() { return navStack[navStack.length - 1]; }
  function parentLevel() { return navStack.length > 1 ? navStack[navStack.length - 2] : null; }

  // ===========================
  // Breadcrumb labels
  // ===========================
  const LEVEL_META = {
    home: { title: 'Dashboard', sub: 'Panel sterowania treścią' },
    generuj: { title: 'Generuj', sub: 'Generowanie treści' },
    rss: { title: 'RSS', sub: 'Zarządzanie kanałami RSS' },
    'auto-watch': { title: 'Auto-watch', sub: 'Automatyczny monitoring' },
    review: { title: 'Przegląd', sub: 'Przegląd i korekta' },
    analyze: { title: 'Analiza', sub: 'Analiza treści' },
    newsletter: { title: 'Newsletter', sub: 'Generowanie newslettera' },
    settings: { title: 'Ustawienia', sub: 'Konfiguracja' },
    telemetry: { title: 'Telemetria', sub: 'Statystyki i dane' },
    notebooklm: { title: 'NotebookLM', sub: 'Studio NotebookLM' },
    'nb-sources': { title: 'Sources', sub: 'Dodawanie i zarządzanie źródłami' },
    'nb-studio': { title: 'Studio', sub: 'Generowanie treści z NotebookLM' },
    'nb-insights': { title: 'Insights', sub: 'Analiza i badania NotebookLM' },
    'notebooklm-list': { title: 'Notebooki', sub: 'Lista wszystkich notebooków' },
    competitors: { title: 'Konkurencja', sub: 'Analiza konkurencji' },
    'competitors-detail': { title: 'Artykuły konkurencji', sub: 'Pełna lista' },
    gaps: { title: 'Luki tematyczne', sub: 'Szczegóły luk' },
    'analyze-summary': { title: 'Podsumowanie analizy', sub: 'Metryki i statystyki' },
    'token-usage': { title: 'Tokeny i zużycie', sub: 'Statystyki użycia' },
    'queries-editor': { title: 'Zapytania Google News', sub: 'Edycja puli zapytań' },
    'downloads': { title: 'Pobieranie', sub: 'Artifacty do pobrania' },
    'nb-config': { title: 'NB Config', sub: 'Konfiguracja NotebookLM' },
    'git-status': { title: 'Git / Deploy', sub: 'Status repozytorium' },
    articles: { title: 'Artykuły', sub: 'Przegląd wygenerowanych artykułów' },
    progress: { title: 'W trakcie...', sub: 'Trwa wykonywanie zadania' },
  };
  function levelMeta(lvl) {
    if (lvl.level === 'pickers') {
      const names = { model:'Model', format:'Format', persona:'Persona', tone:'Ton', lang:'Język' };
      return { title: names[lvl.picker] || lvl.picker, sub: 'Wybierz wartość' };
    }
    if (lvl.level === 'result') return { title: 'Wynik', sub: null };
    if (lvl.level === 'nb-category') {
      const nb = NB_NOTEBOOKS[lvl.notebookKey];
      return { title: nb ? nb.title : 'Notebook', sub: nb ? nb.desc : null };
    }
    return LEVEL_META[lvl.level] || { title: lvl.level, sub: null };
  }

  // ===========================
  // Render
  // ===========================
  function render() {
    renderBreadcrumb();
    renderContent();
  }

  function renderBreadcrumb() {
    if (navStack.length <= 1) {
      breadcrumbEl.classList.remove('show');
      return;
    }
    breadcrumbEl.classList.add('show');
    const items = navStack.map((lvl, i) => {
      const meta = levelMeta(lvl);
      const isLast = i === navStack.length - 1;
      return `<span class="breadcrumb-item${isLast ? ' active' : ''}" data-idx="${i}">${meta.title}</span>${isLast ? '' : '<span class="breadcrumb-sep">›</span>'}`;
    }).join('');
    breadcrumbEl.innerHTML = items;
    // clickable breadcrumb items
    breadcrumbEl.querySelectorAll('.breadcrumb-item:not(.active)').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        if (running) { showToast('Najpierw poczekaj na zakończenie zadania', 'err'); return; }
        navStack = navStack.slice(0, idx + 1);
        render();
      });
    });
  }

  function renderContent() {
    const lvl = currentLevel();
    const meta = levelMeta(lvl);
    pageTitle.textContent = meta.title;
    if (pageSub) {
      if (meta.sub) { pageSub.textContent = meta.sub; pageSub.classList.remove('hidden'); }
      else { pageSub.classList.add('hidden'); }
    }
    if (lvl.level === 'home') renderHome();
    else if (lvl.level === 'generuj' || lvl.level === 'rss' || lvl.level === 'review' || lvl.level === 'analyze' || lvl.level === 'newsletter') renderActionLevel(lvl.level);
    else if (lvl.level === 'auto-watch') renderAutoWatch();
    else if (lvl.level === 'settings') renderSettings();
    else if (lvl.level === 'pickers') renderPickers(lvl);
    else if (lvl.level === 'result') renderResult(lvl.data);
    else if (lvl.level === 'telemetry') renderTelemetry();
    else if (lvl.level === 'notebooklm') renderNotebooklm();
    else if (lvl.level === 'nb-sources') renderNbSources();
    else if (lvl.level === 'nb-studio') renderNbStudio();
    else if (lvl.level === 'nb-insights') renderNbInsights();
    else if (lvl.level === 'notebooklm-list') renderNotebooklmList();
    else if (lvl.level === 'nb-category') renderNbCategory(lvl);
    else if (lvl.level === 'competitors') renderCompetitors();
    else if (lvl.level === 'competitors-detail') renderCompetitorsDetail();
    else if (lvl.level === 'gaps') renderGaps();
    else if (lvl.level === 'analyze-summary') renderAnalyzeSummary();
    else if (lvl.level === 'token-usage') renderTokenUsage();
    else if (lvl.level === 'queries-editor') renderQueriesEditor();
    else if (lvl.level === 'downloads') renderDownloads();
    else if (lvl.level === 'nb-config') renderNbConfig();
    else if (lvl.level === 'git-status') renderGitStatus();
    else if (lvl.level === 'articles') renderArticles();
    else if (lvl.level === 'progress') renderProgress(lvl.data);
    else renderHome();
  }

  // ===========================
  // Tile HTML helper
  // ===========================
  function createTileHtml(t, idx) {
    const cls = ['tile'];
    const dataIdx = idx !== undefined ? ` data-tile-index="${idx}"` : '';
    if (t.type === 'section') return `<div class="section-header"><span class="section-icon">${t.icon}</span><span class="section-title">${t.label}</span></div>`;
    if (t.type === 'nav') cls.push('tile-nav');
    else if (t.type === 'action') cls.push('tile-action');
    else if (t.type === 'toggle') cls.push('tile-toggle');
    else if (t.type === 'choice') cls.push('tile-choice');
    else if (t.type === 'config') cls.push('tile-config');
    else if (t.type === 'back') cls.push('tile-back');
    if (t.selected) cls.push('selected');
    if (t.running) cls.push('running');
    const icon = t.type === 'back' ? '←' : t.icon;
    const label = t.label || '';
    const desc = t.desc || '';

    if (t.type === 'config') {
      return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
        <div class="config-label">${label}</div>
        <div class="config-value${desc ? '' : ' empty'}">${desc || '—'}</div>
      </div>`;
    }
    if (t.type === 'back') {
      return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
        <span class="tile-icon">${icon}</span>
        <div class="tile-label">${label || 'Powrót'}</div>
      </div>`;
    }
    if (t.type === 'stat') {
      cls.push('tile-stat');
      return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
        <span class="stat-icon">${icon}</span>
        <div class="stat-value">${t.value || '—'}</div>
        <div class="tile-label">${label}</div>
      </div>`;
    }
    return `<div class="${cls.join(' ')}" data-type="${t.type}"${dataIdx}>
      <span class="tile-icon">${icon}</span>
      <div class="tile-label">${label}</div>
      ${desc ? `<div class="tile-desc">${desc}</div>` : ''}
    </div>`;
  }

  function renderTiles(tiles, onTileClick) {
    tilesEl.innerHTML = tiles.map((t, i) => createTileHtml(t, i)).join('');
    // stagger reveal
    requestAnimationFrame(() => {
      tilesEl.querySelectorAll('.tile').forEach((el, i) => {
        setTimeout(() => el.classList.add('visible'), 60 + i * 50);
      });
    });
    // click handlers
    tilesEl.querySelectorAll('.tile').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tile')) {
          const idx = parseInt(el.dataset.tileIndex);
          if (!isNaN(idx)) onTileClick(tiles[idx], el);
        }
      });
    });
  }

  // ===========================
  // Level renderers
  // ===========================

  function renderHome() {
    const tiles = [];
    function sec(icon, title) { tiles.push({ type:'section', icon, label:title }); }

    // Status section — always visible at top
    sec('🧠','Status systemu');
    const ollamaOnline = modelsList.length > 0;
    tiles.push(
      { type:'config', icon: ollamaOnline ? '🟢' : '🔴', label:'Ollama', desc: ollamaOnline ? `Online · ${modelsList[0] || settingsCache.model || '—'}` : 'Offline — uruchom `ollama serve`' },
    );
    if (!nbAuthed) {
      tiles.push(
        { type:'action', icon:'🔑', label:'Zaloguj do NotebookLM', desc:'Wymagane do analizy i badań AI', nbAuthAction:'login' },
        { type:'config', icon:'🔴', label:'NotebookLM', desc:'Nie zalogowano' },
      );
    } else {
      tiles.push(
        { type:'config', icon:'🟢', label:'NotebookLM', desc:'Zalogowano — gotowe do pracy' },
      );
    }

    // Workflow pipeline
    sec('📋','Pipeline pracy');
    tiles.push(
      { type:'nav', icon:'1️⃣', label:'Przeglądaj artykuły', desc:'Zobacz co już wygenerowano · otwórz, podgląd, metadane' },
      { type:'nav', icon:'2️⃣', label:'Znajdź newsy', desc:'RSS, Google News, Auto-watch · zbierz materiał do przeróbki' },
      { type:'nav', icon:'3️⃣', label:'Generuj treści', desc:'AI pisze artykuł · z tematu, RSS lub NotebookLM' },
      { type:'nav', icon:'4️⃣', label:'Publikuj i analizuj', desc:'Newsletter · Git push · Analiza konkurencji · Luki' },
    );

    // Quick actions
    sec('⚡','Szybkie akcje');
    tiles.push(
      { type:'action', icon:'💬', label:'Generuj z tematu', desc:'Wpisz temat — AI napisze artykuł', action:'generate', needsInput:true, inputLabel:'Temat artykułu', inputPlaceholder:'np. Jak zacząć dropshipping B2B...', inputDefault:'Czym jest dropshipping B2B', askPush:true },
      { type:'action', icon:'🔥', label:'Warmup Ollama', desc:'Załaduj model do RAM (przyspiesza ~2x)', action:'warmup' },
    );

    sec('🛠️','Narzędzia');
    tiles.push(
      { type:'nav', icon:'⚙', label:'Ustawienia', desc:'Model, format, persona, ton, język' },
      { type:'nav', icon:'📉', label:'Telemetria', desc:'Statystyki, historia, użycie' },
      { type:'nav', icon:'🧠', label:'NotebookLM Studio', desc:'Źródła, raporty, audio, research' },
      { type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium, commity' },
    );

    // Target mapping
    const targetMap = {
      'Przeglądaj artykuły':'articles','Znajdź newsy':'rss','Generuj treści':'generuj','Publikuj i analizuj':'newsletter',
      'Ustawienia':'settings','Telemetria':'telemetry','NotebookLM Studio':'notebooklm','Git / Deploy':'git-status',
    };
    renderTiles(tiles, (t, el) => {
      if (t.action === 'warmup') { handleWarmup(el); return; }
      if (t.action === 'generate') { handleActionTile(t, el); return; }
      if (t.nbAuthAction === 'login') { handleNbLoginFromDashboard(el); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      if (t.type === 'section' || t.type === 'config') return;
      const target = targetMap[t.label];
      if (target) pushLevel({ level: target });
    });
  }

  // NB login from dashboard button
  async function handleNbLoginFromDashboard(el) {
    el.classList.add('running');
    try {
      const r = await fetch('/api/nb/login', { method:'POST' });
      const d = await r.json();
      el.classList.remove('running');
      if (d.ok) {
        showToast('✅ ' + (d.message || 'Zalogowano do NotebookLM'), '');
        nbAuthed = true;
        updateNbStatusUI();
        render();
      } else {
        showToast('Błąd logowania: ' + (d.error || 'nieznany'), 'err');
      }
    } catch (e) { el.classList.remove('running'); showToast('Błąd sieci: ' + e.message, 'err'); }
  }

  // ===========================
  // Article browsing (Problem #2)
  // ===========================
  async function renderArticles() {
    tilesEl.innerHTML = '<div class="result-card"><div class="result-icon">📄</div><div class="result-title">Artykuły</div><div class="result-desc">Ładowanie...</div></div>';
    let data;
    try { const r = await fetch('/api/articles'); data = await r.json(); } catch { data = { articles: [], error: 'Błąd sieci' }; }
    const articles = data.articles || [];
    const tiles = [];
    tiles.push({ type:'config', icon:'📊', label:'Łącznie artykułów', desc: String(data.total || 0) });
    if (articles.length === 0) {
      tiles.push({ type:'config', icon:'📭', label:'Brak artykułów', desc:'Wygeneruj pierwszy artykuł przez "Generuj z tematu"' });
    } else {
      articles.slice(0, 50).forEach(a => {
        const d = a.date ? new Date(a.date).toLocaleDateString('pl-PL', {day:'numeric',month:'short',year:'numeric'}) : '';
        const words = a.words ? `${a.words} słów` : '';
        const format = a.format && a.format !== 'article' ? ` · ${a.format}` : '';
        const desc = [d, words, a.source ? `źródło: ${a.source}` : ''].filter(Boolean).join(' · ');
        tiles.push({ type:'config', icon:'📝', label: a.title || a.slug, desc: desc + format, articleSlug: a.slug, articleFile: a.file });
      });
    }
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.type === 'section') return;
      if (t.articleSlug) {
        showArticlePreview(t.articleSlug, t.articleFile, t.label, t.desc);
      }
    });
  }

  function showArticlePreview(slug, file, title, desc) {
    const filePath = file.replace(/\\/g, '/');
    const html = `
      <div style="text-align:left">
        <p style="color:var(--text-bright);font-weight:600;margin-bottom:4px">${escapeHtml(title)}</p>
        <p style="color:var(--text-dim);font-size:.75rem;margin-bottom:8px">${escapeHtml(desc)}</p>
        <p style="color:var(--text-dim);font-size:.7rem;margin-bottom:12px"><code style="color:var(--green);font-size:.68rem">${escapeHtml(filePath)}</code></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="dialog-btn dialog-btn-primary" style="text-decoration:none;display:inline-flex;align-items:center" href="/articles/${slug}.html" target="_blank">📎 Otwórz artykuł</a>
          <button class="dialog-btn dialog-btn-secondary" id="articlePreviewClose">↩ Zamknij</button>
        </div>
      </div>`;
    showDialog('Podgląd artykułu', html, []).then(() => {});
    setTimeout(() => {
      const closeBtn = document.getElementById('articlePreviewClose');
      if (closeBtn) closeBtn.addEventListener('click', closeDialog);
    }, 50);
  }

  // Action sub-levels (generuj, rss, review, analyze, newsletter)
  function renderActionLevel(level) {
    const defs = {
      generuj: [
        { type:'action', icon:'💬', label:'Generuj prompt', desc:'Generuj treść z własnego prompta', action:'generate', needsInput:true, inputLabel:'Treść prompta', inputPlaceholder:'Wpisz temat lub prompt...', askPush:true },
        { type:'action', icon:'📄', label:'Generuj feed', desc:'Generuj feed HTML/MD/JSON', action:'generate', askPush:true },
        { type:'action', icon:'📡', label:'Generuj z RSS', desc:'Generuj treść z kanału RSS', action:'rss', needsInput:true, inputLabel:'URL feedu RSS', inputPlaceholder:'https://techcrunch.com/category/artificial-intelligence/feed/', inputDefault:'https://techcrunch.com/category/artificial-intelligence/feed/', askPush:true },
        { type:'action', icon:'📝', label:'NB Blog Post', desc:'Raport blog-post z NB', gotoLevel:{ level:'nb-studio' } },
      ],
      rss: [
        { type:'action', icon:'🔍', label:'Sprawdź', desc:'Sprawdź nowe wpisy w feedzie (URL)', action:'rss', needsInput:true, inputLabel:'URL feedu RSS', inputPlaceholder:'https://techcrunch.com/category/artificial-intelligence/feed/', inputDefault:'https://techcrunch.com/category/artificial-intelligence/feed/' },
        { type:'action', icon:'🖼', label:'Generuj obrazki', desc:'Generuj artykuł + obrazki z feedu', action:'rss', needsInput:true, inputLabel:'URL feedu RSS', inputPlaceholder:'https://techcrunch.com/category/artificial-intelligence/feed/', inputDefault:'https://techcrunch.com/category/artificial-intelligence/feed/', askPush:true },
        { type:'action', icon:'📄', label:'Generuj feed', desc:'Generuj artykuł z feedu i wypchnij', action:'rss', needsInput:true, inputLabel:'URL feedu RSS', inputPlaceholder:'https://techcrunch.com/category/artificial-intelligence/feed/', inputDefault:'https://techcrunch.com/category/artificial-intelligence/feed/', askPush:true },
        { type:'action', icon:'📰', label:'NB Digest', desc:'Digest przez NotebookLM', gotoLevel:{ level:'nb-category', notebookKey:'news' } },
        { type:'action', icon:'🔬', label:'NB Web Research', desc:'Research z query — deep mode', gotoLevel:{ level:'nb-sources' } },
      ],
      review: [
        { type:'action', icon:'📝', label:'Review all', desc:'Przejrzyj wszystkie nowe wpisy', action:'review' },
        { type:'action', icon:'❌', label:'Review fail', desc:'Przejrzyj tylko błędne', action:'review' },
      ],
      analyze: [
        { type:'action', icon:'📊', label:'Analiza treści', desc:'Wykonaj analizę luk i konkurencji', action:'analyze' },
        { type:'action', icon:'💡', label:'NB Insights', desc:'Source guide + Research + Prompty', gotoLevel:{ level:'nb-insights' } },
        { type:'action', icon:'🔬', label:'NB Deep Research', desc:'Badania przez NotebookLM', gotoLevel:{ level:'nb-category', notebookKey:'research' } },
        { type:'action', icon:'🏁', label:'NB Keywords', desc:'Analiza słów kluczowych', gotoLevel:{ level:'nb-category', notebookKey:'ads' } },
        { type:'action', icon:'🏁', label:'Konkurencja', desc:'Lista konkurencji', gotoLevel:{ level:'competitors' } },
        { type:'action', icon:'🔍', label:'Luki tematyczne', desc:'Analiza luk', gotoLevel:{ level:'gaps' } },
        { type:'nav', icon:'📈', label:'Podsumowanie analizy', desc:'Metryki i statystyki', gotoLevel:{ level:'analyze-summary' } },
        { type:'nav', icon:'🔢', label:'Tokeny i zużycie', desc:'Statystyki użycia', gotoLevel:{ level:'token-usage' } },
      ],
      newsletter: [
        { type:'action', icon:'📧', label:'Generuj newsletter', desc:'Wygeneruj newsletter tygodniowy', action:'newsletter' },
        { type:'action', icon:'📤', label:'Wyślij newsletter', desc:'Wyślij newsletter do subskrybentów', action:'newsletter' },
        { type:'action', icon:'🎙️', label:'NB Audio Briefing', desc:'Briefing audio przez NotebookLM', gotoLevel:{ level:'nb-category', notebookKey:'audio' } },
        { type:'action', icon:'🎬', label:'NB Studio', desc:'Generuj audio/wideo/report', gotoLevel:{ level:'nb-studio' } },
      ],
    };
    const tiles = [...(defs[level] || [])];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleActionTile(t, el);
    });
  }

  // ===========================
  // NotebookLM
  // ===========================
  function renderNotebooklm() {
    const tiles = [
      { type:'nav', icon:'📚', label:'Sources', desc:'Dodaj URL / PDF / YouTube jako źródło' },
      { type:'nav', icon:'🎬', label:'Studio', desc:'Generuj raporty, audio i wideo' },
      { type:'nav', icon:'💡', label:'Insights', desc:'Słowa kluczowe, badania, prompty' },
    ];
    tiles.push({ type:'nav', icon:'📓', label:'Notebooki', desc:'Lista wszystkich notebooków' });
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      const idx = tiles.indexOf(t);
      if (idx === 0) pushLevel({ level:'nb-sources' });
      else if (idx === 1) pushLevel({ level:'nb-studio' });
      else if (idx === 2) pushLevel({ level:'nb-insights' });
      else if (idx === 3) pushLevel({ level:'notebooklm-list' });
    });
  }

  function renderNbSources() {
    const tiles = [
      { type:'action', icon:'🔗', label:'Dodaj URL', desc:'Dodaj stronę / artykuł jako źródło', nbAction:'source-url' },
      { type:'action', icon:'▶️', label:'Dodaj YouTube', desc:'Dodaj film jako źródło', nbAction:'source-youtube' },
      { type:'action', icon:'📄', label:'Dodaj PDF', desc:'Dodaj plik PDF jako źródło', nbAction:'source-pdf' },
      { type:'action', icon:'🔬', label:'Web Research', desc:'Dodaj research z query', nbAction:'source-research' },
      { type:'nav', icon:'📚', label:'Źródła — Sources', desc:'Lista istniejących źródeł', gotoLevel:{ level:'nb-category', notebookKey:'sources' } },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleNbSourceAdd(t, el);
    });
  }

  async function handleNbSourceAdd(t, el) {
    if (t.nbAction === 'source-url' || t.nbAction === 'source-youtube' || t.nbAction === 'source-pdf') {
      const label = t.nbAction === 'source-url' ? 'URL' : t.nbAction === 'source-youtube' ? 'YouTube URL' : 'Ścieżka do PDF';
      const url = await showInputDialogValue(`Dodaj ${label}`, `Wpisz ${label.toLowerCase()}...`);
      if (!url) return;
      el.classList.add('running');
      try {
        const typeMap = { 'source-url':'url', 'source-youtube':'youtube', 'source-pdf':'url' };
        const resp = await fetch('/api/nb/source-add', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ notebookId: NB_NOTEBOOKS.sources.id, content: url, type: typeMap[t.nbAction] }),
        });
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        pushLevel({ level:'result', data: { success:true, action:`NB Source Add`, output: JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    if (t.nbAction === 'source-research') {
      const query = await showInputDialogValue('Web Research', 'Czego szukać...');
      if (!query) return;
      el.classList.add('running');
      try {
        const resp = await fetch('/api/nb/add-research', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ notebookId: NB_NOTEBOOKS.research.id, query, mode:'deep' }),
        });
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        pushLevel({ level:'result', data: { success:true, action:`NB Research`, output: JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
    }
  }

  function renderNbStudio() {
    const tiles = [
      { type:'action', icon:'📝', label:'Generate Report', desc:'Raport blog-post z notebooka', nbAction:'studio-report' },
      { type:'action', icon:'🎙️', label:'Generate Audio', desc:'Podcast deep-dive z notebooka', nbAction:'studio-audio' },
      { type:'action', icon:'🎬', label:'Generate Video', desc:'Film z notebooka', nbAction:'studio-video' },
      { type:'action', icon:'⬇️', label:'Downloads', desc:'Pobierz artifacty z notebooka', nbAction:'studio-downloads' },
      { type:'nav', icon:'📰', label:'News Digest', desc:'Notebook News Digest', gotoLevel:{ level:'nb-category', notebookKey:'news' } },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleNbStudioAction(t, el);
    });
  }

  async function handleNbStudioAction(t, el) {
    const action = t.nbAction;
    // Downloads: list artifacts from a notebook
    if (action === 'studio-downloads') {
      const nbKeys = Object.keys(NB_NOTEBOOKS);
      const nbChoice = await showChoice('Wybierz notebook', 'Z którego notebooka pobrać?',
        { label: NB_NOTEBOOKS.news.title, value: 'news' },
        { label: NB_NOTEBOOKS.research.title, value: 'research' }
      );
      if (!nbChoice) return;
      const nbId = NB_NOTEBOOKS[nbChoice].id;
      el.classList.add('running');
      try {
        const resp = await fetch(`/api/nb/notebooks/${nbId}/artifacts`);
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        const artifacts = data.artifacts || [];
        if (!artifacts.length) { showToast('Brak artifactów', 'err'); return; }
        const items = artifacts.slice(0, 10).map(a => `• ${a.title || a.id} [${a.type || '?'}]`).join('\n');
        pushLevel({ level:'result', data: { success:true, action:`NB Artifacts (${artifacts.length})`, output: items || JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    // Pick a notebook first
    const nbKeys = Object.keys(NB_NOTEBOOKS);
    const nbChoice = await showChoice('Wybierz notebook', 'Z którego notebooka?',
      { label: NB_NOTEBOOKS.news.title, value: 'news' },
      { label: NB_NOTEBOOKS.research.title, value: 'research' }
    );
    if (!nbChoice) return;
    const nbId = NB_NOTEBOOKS[nbChoice].id;
    el.classList.add('running');
    try {
      let url, opts = { method:'POST', headers:{'Content-Type':'application/json'} };
      if (action === 'studio-report') {
        url = '/api/nb/generate-report';
        opts.body = JSON.stringify({ notebookId: nbId, format:'blog-post' });
      } else if (action === 'studio-audio') {
        url = '/api/nb/generate-audio';
        opts.body = JSON.stringify({ notebookId: nbId, format:'deep-dive' });
      } else if (action === 'studio-video') {
        url = '/api/nb/generate-report'; // fallback: report z wideo opisem
        opts.body = JSON.stringify({ notebookId: nbId, format:'briefing-doc' });
      }
      const resp = await fetch(url, opts);
      const data = await resp.json();
      el.classList.remove('running');
      if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
      pushLevel({ level:'result', data: { success:true, action:`NB ${action}`, output: JSON.stringify(data, null, 2) } });
    } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
  }

  function renderNbInsights() {
    const tiles = [
      { type:'action', icon:'🔑', label:'Source Guide', desc:'Słowa kluczowe z notebooka', nbAction:'insights-guide' },
      { type:'action', icon:'🔬', label:'Deep Research', desc:'Głębokie badanie tematu', nbAction:'insights-research' },
      { type:'action', icon:'💬', label:'Suggest Prompts', desc:'Sugerowane prompty AI', nbAction:'insights-prompts' },
      { type:'nav', icon:'🔍', label:'Gap Analysis', desc:'Widok luk w NB Research', gotoLevel:{ level:'nb-category', notebookKey:'research' } },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      handleNbInsightsAction(t, el);
    });
  }

  async function handleNbInsightsAction(t, el) {
    const action = t.nbAction;
    if (action === 'insights-guide') {
      // Pick a source from research notebook, get its guide/keywords
      const query = await showInputDialogValue('Source Guide', 'Nazwa źródła (lub pierwsze litery ID)...');
      if (!query) return;
      el.classList.add('running');
      try {
        // First get sources list
        const srcResp = await fetch(`/api/nb/notebooks/${NB_NOTEBOOKS.research.id}/sources`);
        const srcData = await srcResp.json();
        const sources = srcData.sources || [];
        // Try to match source
        const match = sources.find(s => (s.title || '').toLowerCase().includes(query.toLowerCase()) || (s.id || '').includes(query));
        if (!match) { el.classList.remove('running'); showToast('Nie znaleziono źródła', 'err'); return; }
        const resp = await fetch('/api/nb/source-guide', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ notebookId: NB_NOTEBOOKS.research.id, sourceId: match.id }),
        });
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        pushLevel({ level:'result', data: { success:true, action:`NB Source Guide (${match.title})`, output: JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    if (action === 'insights-research') {
      const query = await showInputDialogValue('Deep Research', 'Temat do zbadania...');
      if (!query) return;
      el.classList.add('running');
      try {
        const resp = await fetch('/api/nb/add-research', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ notebookId: NB_NOTEBOOKS.research.id, query, mode:'deep' }),
        });
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        pushLevel({ level:'result', data: { success:true, action:`NB Deep Research`, output: JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
      return;
    }
    if (action === 'insights-prompts') {
      showToast('Suggest prompts — poprzez ask() z promptem o sugestie', '');
      const question = 'Na podstawie zgromadzonych źródeł, zaproponuj 5 tematów artykułów które warto napisać. Podaj tytuł, format i uzasadnienie dla każdego.';
      el.classList.add('running');
      try {
        const resp = await fetch('/api/nb/ask', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ notebookId: NB_NOTEBOOKS.research.id, question }),
        });
        const data = await resp.json();
        el.classList.remove('running');
        if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
        pushLevel({ level:'result', data: { success:true, action:`NB Suggest Prompts`, output: JSON.stringify(data, null, 2) } });
      } catch (e) { el.classList.remove('running'); showToast(`Błąd sieci: ${e.message}`, 'err'); }
    }
  }

  function renderNotebooklmList() {
    const tiles = Object.values(NB_NOTEBOOKS).map(nb => ({
      type:'nav', icon:nb.icon, label:nb.title, desc:nb.desc,
    }));
    tiles.push({ type:'back' });
    const keys = Object.keys(NB_NOTEBOOKS);
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      const idx = tiles.indexOf(t);
      pushLevel({ level:'nb-category', notebookKey:keys[idx] });
    });
  }

  function renderNbCategory(lvl) {
    const nb = NB_NOTEBOOKS[lvl.notebookKey];
    if (!nb) { popLevel(); return; }
    const tiles = [
      { type:'action', icon:'📄', label:'Podsumowanie', desc:'Pokaż podsumowanie notebooka', notebookId:nb.id, nbAction:'summary' },
      { type:'action', icon:'🔗', label:'Źródła', desc:'Lista źródeł', notebookId:nb.id, nbAction:'sources' },
      { type:'action', icon:'📝', label:'Generuj raport', desc:'Generuj raport z notebooka', notebookId:nb.id, nbAction:'report' },
      { type:'action', icon:'🎙️', label:'Generuj audio', desc:'Generuj podcast/audio', notebookId:nb.id, nbAction:'audio' },
      { type:'action', icon:'💬', label:'Zadaj pytanie', desc:'AI o zgromadzonych źródłach', notebookId:nb.id, nbAction:'ask' },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      handleNbAction(t, el);
    });
  }

  async function handleNbAction(t, el) {
    const nbId = t.notebookId;
    const action = t.nbAction;
    if (!nbId || !action) return;
    el.classList.add('running');
    try {
      let url, opts = { headers:{'Content-Type':'application/json'} };
      if (action === 'summary') {
        url = `/api/nb/notebooks/${nbId}/summary`;
      } else if (action === 'sources') {
        url = `/api/nb/notebooks/${nbId}/sources`;
      } else if (action === 'report') {
        url = `/api/nb/generate-report`;
        opts.method = 'POST'; opts.body = JSON.stringify({ notebookId: nbId });
      } else if (action === 'audio') {
        url = `/api/nb/generate-audio`;
        opts.method = 'POST'; opts.body = JSON.stringify({ notebookId: nbId });
      } else if (action === 'ask') {
        const question = await showInputDialogValue('Pytanie', 'Zadaj pytanie o źródła...');
        if (!question) { el.classList.remove('running'); return; }
        url = `/api/nb/ask`;
        opts.method = 'POST'; opts.body = JSON.stringify({ notebookId: nbId, question });
      }
      const resp = await fetch(url, opts);
      const data = await resp.json();
      el.classList.remove('running');
      if (data.error) { showToast(`Błąd: ${data.error}`, 'err'); return; }
      const out = data.output || JSON.stringify(data, null, 2);
      pushLevel({ level:'result', data: { success: true, action: `NB ${action}`, output: out } });
    } catch (e) {
      el.classList.remove('running');
      showToast(`Błąd sieci: ${e.message}`, 'err');
    }
  }

  // ===========================
  // Competitors
  // ===========================
  function renderCompetitors() {
    const d = telemetryCache;
    if (!d) { loadTelemetry().then(() => renderCompetitors()); return pageSub.textContent = 'Ładowanie...'; }
    const tiles = [];
    const c = d.competitors || {};
    tiles.push({ type:'config', icon:'🏁', label:'Konkurencja łącznie', desc: String(c.total || 0) });
    if (c.total > 0) {
      tiles.push({ type:'nav', icon:'📋', label:'Artykuły konkurencji', desc:'Pełna lista artykułów', gotoLevel:{ level:'competitors-detail' } });
    }
    if (c.total > 0 && c.items) {
      c.items.forEach(item => {
        tiles.push({ type:'config', icon:'📄', label: item.feedName || '—', desc: `${item.articles || 0} artykułów` });
      });
    } else {
      tiles.push({ type:'config', icon:'📭', label:'Brak danych', desc:'Uruchom analizę aby zebrać dane konkurencji' });
    }
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); if (t.gotoLevel) pushLevel(t.gotoLevel); });
  }

  async function renderCompetitorsDetail() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">📋</div><div class="result-title">Artykuły konkurencji</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/telemetry/competitors'); data = await r.json(); } catch { data = { error: 'Błąd sieci' }; }
    const tiles = [];
    const items = data.items || [];
    tiles.push({ type:'config', icon:'🏁', label:'Łącznie artykułów konkurencji', desc: String(data.total || 0) });
    if (items.length > 0) {
      items.slice(0, 30).forEach(item => {
        const date = item.date ? new Date(item.date).toLocaleDateString('pl-PL') : '';
        const feed = item.feedName || item.source || '—';
        tiles.push({ type:'config', icon:'📄', label: item.title || '—', desc: `${feed}${date ? ' · ' + date : ''}` });
      });
    } else {
      tiles.push({ type:'config', icon:'📭', label:'Brak artykułów', desc:'Uruchom analyze.mjs aby śledzić konkurencję' });
    }
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  // ===========================
  // Gaps detail
  // ===========================
  function renderGaps() {
    const d = telemetryCache;
    if (!d) { loadTelemetry().then(() => renderGaps()); return pageSub.textContent = 'Ładowanie...'; }
    const tiles = [];
    const g = d.gaps || {};
    const kw = g.topKeywords || [];
    const gaps = g.gaps || [];
    tiles.push({ type:'config', icon:'🔍', label:'Słowa kluczowe', desc: `${kw.length} słów` });
    kw.slice(0, 10).forEach(k => {
      const word = typeof k === 'string' ? k : k.keyword || '';
      const score = typeof k === 'object' ? k.score : '';
      tiles.push({ type:'stat', icon:'🔑', label: word || '—', value: score ? score.toFixed(1) : '—' });
    });
    tiles.push({ type:'config', icon:'📊', label:'Luki tematyczne', desc: `${gaps.length} luk` });
    gaps.slice(0, 10).forEach(k => {
      const word = typeof k === 'string' ? k : k.keyword || '';
      const count = typeof k === 'object' ? k.count : '';
      tiles.push({ type:'stat', icon:'📌', label: word || '—', value: String(count || '') });
    });
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  async function renderAnalyzeSummary() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">📊</div><div class="result-title">Podsumowanie analizy</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/telemetry/analyze-summary'); data = await r.json(); } catch { data = { error: 'Błąd' }; }
    const tiles = [
      { type:'stat', icon:'📄', label:'Artykuły łącznie', value: String(data.articleCount || 0) },
      { type:'stat', icon:'🔑', label:'Unikalne słowa', value: String(data.uniqueWords || 0) },
      { type:'stat', icon:'🔍', label:'Luki tematyczne', value: String(data.gapCount || 0) },
      { type:'stat', icon:'📌', label:'Słowa kluczowe', value: String(data.keywordCount || 0) },
      { type:'config', icon:'📅', label:'Najstarszy artykuł', desc: data.oldestDate ? new Date(data.oldestDate).toLocaleDateString('pl-PL') : '—' },
      { type:'config', icon:'📅', label:'Najnowszy artykuł', desc: data.newestDate ? new Date(data.newestDate).toLocaleDateString('pl-PL') : '—' },
      { type:'back' },
    ];
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  async function renderTokenUsage() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">🔢</div><div class="result-title">Tokeny i zużycie</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/tokens'); data = await r.json(); } catch { data = { error: 'Błąd' }; }
    let nbData;
    try { const r = await fetch('/api/nb/telemetry'); nbData = await r.json(); } catch { nbData = {}; }
    const tiles = [
      { type:'stat', icon:'🧠', label:'Modele Ollama', value: String(data.ollamaModels || 0) },
      { type:'stat', icon:'📓', label:'Notebooki NB', value: String(nbData.notebooks || data.nbNotebooks || 0) },
      { type:'stat', icon:'📚', label:'Źródła NB', value: String(nbData.totalSources || 0) },
      { type:'stat', icon:'📄', label:'Wygenerowane artykuły', value: String(data.generatedTotal || 0) },
      { type:'stat', icon:'🔄', label:'Aktywne zadania', value: String(data.activeRuns || 0) },
      { type:'config', icon:'💡', label:'NB API', desc: nbData.error ? `Offline: ${nbData.error}` : 'Online' },
      { type:'back' },
    ];
    renderTiles(tiles, (t, el) => { if (t.type === 'back') popLevel(); });
  }

  async function renderQueriesEditor() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">🔗</div><div class="result-title">Zapytania Google News</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/queries'); data = await r.json(); } catch { data = { pool: [] }; }
    const pool = data.pool || [];
    const tiles = [
      { type:'config', icon:'🔗', label:'Liczba zapytań', desc: String(pool.length) },
      { type:'action', icon:'➕', label:'Dodaj zapytanie', desc:'Dodaj nowe zapytanie do puli', queryAction:'add' },
    ];
    pool.slice(0, 25).forEach((q, i) => {
      tiles.push({ type:'config', icon:'📝', label: q, desc: `#${i + 1} · kliknij aby usunąć` });
    });
    tiles.push({ type:'back' });
    renderTiles(tiles, async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.queryAction === 'add') {
        const text = await showInputDialogValue('Nowe zapytanie', 'Wpisz frazę do wyszukiwania Google News...');
        if (!text) return;
        pool.push(text);
        if (pool.length > 50) pool.shift();
        try {
          await fetch('/api/queries', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pool, _comment: data._comment }) });
          renderQueriesEditor();
        } catch { showToast('Błąd zapisu', 'err'); }
        return;
      }
      if (t.label && pool.includes(t.label)) {
        const newPool = pool.filter(q => q !== t.label);
        try {
          await fetch('/api/queries', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pool: newPool, _comment: data._comment }) });
          renderQueriesEditor();
        } catch { showToast('Błąd usuwania', 'err'); }
      }
    });
  }

  async function renderDownloads() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">⬇️</div><div class="result-title">Pobieranie</div><div class="result-desc">Ładowanie...</div></div>`;
    const tiles = [
      { type:'nav', icon:'📝', label:'Raporty (Research)', desc:'Pobierz raporty z NB Research', gotoLevel:{ level:'nb-category', notebookKey:'research' } },
      { type:'nav', icon:'🎙️', label:'Audio (News)', desc:'Pobierz podcasty z NB News', gotoLevel:{ level:'nb-category', notebookKey:'audio' } },
      { type:'nav', icon:'📰', label:'Digest (News)', desc:'Pobierz digesty', gotoLevel:{ level:'nb-category', notebookKey:'news' } },
      { type:'action', icon:'📦', label:'Wszystkie artifacty', desc:'Lista wszystkich artifactów NB', downloadAction:'list-all' },
      { type:'back' },
    ];
    renderTiles(async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      if (t.downloadAction === 'list-all') {
        el.classList.add('running');
        try {
          const resp = await fetch('/api/nb/downloads', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ notebookId: '7a31df6c', type:'all' }),
          });
          const data = await resp.json();
          el.classList.remove('running');
          const items = data.items || [];
          if (!items.length) { showToast('Brak artifactów', ''); return; }
          const out = items.map(a => `• [${a.type}] ${a.title || a.id}`).join('\n');
          pushLevel({ level:'result', data: { success:true, action:'NB Artifacts', output: out || JSON.stringify(data) } });
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
      }
    });
  }

  async function renderNbConfig() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">⚙</div><div class="result-title">NotebookLM Config</div><div class="result-desc">Ładowanie...</div></div>`;
    let cfg, authStatus;
    try { const r = await fetch('/api/nb/config'); cfg = await r.json(); } catch { cfg = {}; }
    try { const r = await fetch('/api/nb/auth-status'); authStatus = await r.json(); } catch { authStatus = { auth: false, error: 'Błąd sieci' }; }
    const defNb = cfg.defaultNotebook || 'research';
    const nbKeys = Object.keys(NB_NOTEBOOKS);
    const authIcon = authStatus.auth ? '✅' : '❌';
    const authDesc = authStatus.auth
      ? `Zalogowano · ${authStatus.notebooks ?? '?'} notebooków`
      : (authStatus.error || 'Nie zalogowano');
    const tiles = [
      { type:'config', icon:authIcon, label:'Autoryzacja', desc: authDesc },
      { type:'section', icon:'🔐', label:`Zaloguj / Wyloguj` },
      { type:'action', icon:'🔑', label:'Zaloguj się (przez przeglądarkę)', desc:'Otworzy okno logowania Google', nbAuthAction:'login' },
      { type:'action', icon:'🚪', label:'Wyloguj się', desc:'Usuń zapisane ciasteczka', nbAuthAction:'logout' },
      { type:'action', icon:'🔄', label:'Sprawdź auth', desc:'Odśwież status autoryzacji' },
      { type:'section', icon:'⚙️', label:`Ustawienia notebooków` },
      { type:'config', icon:'📓', label:'Domyślny notebook', desc: (NB_NOTEBOOKS[defNb] || {}).title || defNb },
      { type:'config', icon:'🎙️', label:'Styl audio', desc: cfg.audioStyle || 'deep-dive' },
      { type:'config', icon:'🎬', label:'Styl wideo', desc: cfg.videoStyle || 'whiteboard' },
      { type:'toggle', icon:'📡', label:'Auto-push źródeł', desc: cfg.autoPushSources ? 'Tak' : 'Nie', toggled: !!cfg.autoPushSources, nbCfgKey:'autoPushSources' },
      { type:'toggle', icon:'📝', label:'Auto-generuj raport', desc: cfg.autoGenerateReport ? 'Tak' : 'Nie', toggled: !!cfg.autoGenerateReport, nbCfgKey:'autoGenerateReport' },
    ];
    nbKeys.forEach(k => {
      tiles.push({ type:'choice', icon: defNb === k ? '◉' : '○', label: NB_NOTEBOOKS[k].title, value: k, selected: defNb === k, nbCfgKey:'defaultNotebook', nbCfgVal: k });
    });
    tiles.push({ type:'back' });
    renderTiles(async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.nbCfgKey) {
        if (t.nbCfgKey === 'autoPushSources' || t.nbCfgKey === 'autoGenerateReport') {
          cfg[t.nbCfgKey] = !t.toggled;
        } else {
          cfg[t.nbCfgKey] = t.nbCfgVal;
        }
        try {
          await fetch('/api/nb/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(cfg) });
          renderNbConfig();
        } catch { showToast('Błąd zapisu', 'err'); }
        return;
      }
      if (t.nbAuthAction === 'login') {
        el.classList.add('running');
        try {
          const r = await fetch('/api/nb/login', { method:'POST' });
          const d = await r.json();
          el.classList.remove('running');
          if (d.ok) {
            showToast('✅ ' + d.message, '');
            nbAuthed = true;
            updateNbStatusUI();
            setTimeout(() => renderNbConfig(), 2000);
          } else {
            showToast('Błąd: ' + (d.error || 'nieznany'), 'err');
          }
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
        return;
      }
      if (t.nbAuthAction === 'logout') {
        el.classList.add('running');
        try {
          const r = await fetch('/api/nb/logout', { method:'POST' });
          const d = await r.json();
          el.classList.remove('running');
          if (d.ok) { showToast('Wylogowano', ''); nbAuthed = false; updateNbStatusUI(); renderNbConfig(); }
          else { showToast('Błąd: ' + (d.error || 'nieznany'), 'err'); }
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
        return;
      }
      if (t.label === 'Sprawdź auth') {
        el.classList.add('running');
        try {
          const r = await fetch('/api/nb/auth-status');
          const d = await r.json();
          el.classList.remove('running');
          pushLevel({ level:'result', data: { success:d.auth, action:'NB Auth', output: JSON.stringify(d, null, 2) } });
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
      }
    });
  }

  async function renderGitStatus() {
    tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">🔀</div><div class="result-title">Git / Deploy</div><div class="result-desc">Ładowanie...</div></div>`;
    let data;
    try { const r = await fetch('/api/git-status'); data = await r.json(); } catch { data = { error: 'Błąd' }; }
    const tiles = [
      { type:'config', icon:'🌿', label:'Branch', desc: data.branch || '—' },
      { type:'config', icon:'📝', label:'Ostatni commit', desc: data.lastCommit || '—' },
      { type:'config', icon:'🔍', label:'Google Indexing', desc: data.googleIndexing ? '✅ Skonfigurowany' : '❌ Brak klucza' },
      { type:'config', icon:'💼', label:'LinkedIn', desc: data.linkedin ? '✅ Skonfigurowany' : '❌ Brak tokena' },
      { type:'config', icon:'📋', label:'Ostatnie commity', desc: '' },
    ];
    (data.recentCommits || []).forEach(c => {
      tiles.push({ type:'config', icon:'📌', label: c, desc: '' });
    });
    tiles.push({ type:'action', icon:'🔄', label:'Git push', desc:'Wypchnij zmiany na GitHub', gitAction:'push' });
    tiles.push({ type:'back' });
    renderTiles(async (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gitAction === 'push') {
        el.classList.add('running');
        try {
          const resp = await fetch('/api/git-status');
          el.classList.remove('running');
          showToast('Git status odświeżony — push przez akcję generowania', '');
        } catch (e) { el.classList.remove('running'); showToast(`Błąd: ${e.message}`, 'err'); }
      }
    });
  }

  // Auto-watch level with toggles
  function renderAutoWatch() {
    const s = settingsCache;
    const tiles = [
      { type:'config', icon:'', label:'Ustawienia auto-watch', desc: `${s.model || '—'} · ${FORMAT_OPTS[s.format] || s.format} · tryb${s._digest ? '' : ' standard'}` },
      { type:'toggle', icon:'🌙', label:'Tryb digest', desc: s._digest ? 'Wł.' : 'Wył.', toggled: !!s._digest, configKey:'_digest' },
      { type:'toggle', icon:'📬', label:'Newsletter', desc: s._newsletter ? 'Tak' : 'Nie', toggled: !!s._newsletter, configKey:'_newsletter' },
      { type:'toggle', icon:'📝', label:'Szczegółowe logi', desc: s._verbose ? 'Wł.' : 'Wył.', toggled: !!s._verbose, configKey:'_verbose' },
      { type:'action', icon:'▶', label:'Uruchom auto-watch', desc:'Monitoruj feedy i generuj', action:'auto-watch', askPush:true },
    ];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.type === 'toggle') {
        settingsCache[t.configKey] = !t.toggled;
        saveSettings(settingsCache);
        renderAutoWatch();
        return;
      }
      if (t.type === 'action') {
        handleActionTile(t, el);
      }
    });
  }

  // ===========================
  // Telemetry
  // ===========================
  let telemetryCache = null;
  let nbTelemetryCache = null;

  async function loadTelemetry() {
    try { const r = await fetch('/api/telemetry'); telemetryCache = await r.json(); updateSidebarStats(); } catch { telemetryCache = null; }
    try { const r = await fetch('/api/nb/telemetry'); nbTelemetryCache = await r.json(); } catch { nbTelemetryCache = null; }
    return telemetryCache;
  }

  function renderTelemetry() {
    if (!telemetryCache) {
      tilesEl.innerHTML = `<div class="result-card"><div class="result-icon">📉</div><div class="result-title">Telemetria</div><div class="result-desc">Statystyki i dane</div></div>`;
      loadTelemetry().then(() => renderTelemetry());
      return;
    }
    const d = telemetryCache;
    const nb = nbTelemetryCache;
    const tiles = [];

    // summary tile
    const summaryParts = [];
    if (d.articles) summaryParts.push(`${d.articles.total} artykułów`);
    if (d.feeds) summaryParts.push(`${d.feeds.total} feedów`);
    if (d.competitors) summaryParts.push(`${d.competitors.total} konkurencji`);
    if (d.gaps) summaryParts.push(`${d.gaps.gapCount} luk`);
    tiles.push({ type:'config', icon:'', label:'Podsumowanie', desc: summaryParts.join(' · ') || 'Brak danych' });

    // articles stat
    const a = d.articles || {};
    tiles.push({ type:'stat', icon:'📄', label:'Artykuły łącznie', value: String(a.total || 0) });
    if (a.lastDate) tiles.push({ type:'stat', icon:'📅', label:'Ostatni artykuł', value: new Date(a.lastDate).toLocaleDateString('pl-PL') });

    // month tiles
    if (a.byMonth) {
      const months = Object.entries(a.byMonth).sort((a,b) => a[0].localeCompare(b[0])).slice(-6);
      months.forEach(([m, count]) => {
        const label = new Date(m + '-01').toLocaleDateString('pl-PL', { month:'short', year:'numeric' });
        tiles.push({ type:'stat', icon:'📊', label, value: String(count) });
      });
    }

    // gaps
    if (d.gaps) {
      const kw = (d.gaps.topKeywords || []).map(k => k.keyword || k).join(' · ');
      tiles.push({ type:'config', icon:'🔑', label:'Top słowa kluczowe', desc: kw || '—' });
      tiles.push({ type:'stat', icon:'🔍', label:'Luki tematyczne', value: String(d.gaps.gapCount || 0) });
    }

    // feeds & competitors
    if (d.feeds) {
      const modeParts = Object.entries(d.feeds.byMode || {}).map(([m, c]) => `${m}:${c}`).join(' · ');
      tiles.push({ type:'config', icon:'📡', label:'Feedy', desc: `${d.feeds.total} (${modeParts || '—'})` });
    }
    if (d.competitors) {
      tiles.push({ type:'stat', icon:'🏁', label:'Konkurencja', value: String(d.competitors.total || 0) });
    }

    // notebooklm status
    if (nb) {
      const nbDesc = nb.notebooks ? `${nb.notebooks} notebooków · ${nb.totalSources} źródeł` : nb.error || 'Offline';
      tiles.push({ type:'config', icon:'🧠', label:'NotebookLM', desc: nbDesc });
    } else {
      tiles.push({ type:'config', icon:'🧠', label:'NotebookLM', desc: 'Ładowanie...' });
    }

    // quick links
    tiles.push({ type:'nav', icon:'🔢', label:'Tokeny i zużycie', desc:'Statystyki użycia', gotoLevel:{ level:'token-usage' } });
    tiles.push({ type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium', gotoLevel:{ level:'git-status' } });
    tiles.push({ type:'nav', icon:'⬇️', label:'Pobieranie', desc:'Artifacty NB', gotoLevel:{ level:'downloads' } });

    // recent runs
    const runs = d.runs || [];
    if (runs.length) {
      tiles.push({ type:'config', icon:'🔄', label:'Ostatnie uruchomienia', desc: `${runs.length} wpisów` });
      runs.slice(-8).reverse().forEach(r => {
        const icon = r.success ? '✅' : '❌';
        const elapsed = r.elapsed ? `${r.elapsed.toFixed(1)}s` : '';
        const body = r.bodyLen ? `${r.bodyLen} zn` : '';
        const articles = r.articleCount ? `${r.articleCount} art` : '';
        const date = new Date(r.date).toLocaleString('pl-PL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        tiles.push({ type:'config', icon, label: `${r.action}${elapsed ? ' · ' + elapsed : ''}`, desc: [body, articles, date].filter(Boolean).join(' · ') });
      });
    }

    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') popLevel();
      if (t.gotoLevel) pushLevel(t.gotoLevel);
    });
  }

  // Settings level
  function renderSettings() {
    const s = settingsCache;
    const tiles = [
      { type:'config', icon:'🧠', label:'Model', desc: s.model || '—' },
      { type:'config', icon:'📋', label:'Format', desc: FORMAT_OPTS[s.format] || s.format },
      { type:'config', icon:'👤', label:'Persona', desc: PERSONA_OPTS[s.persona] || s.persona },
      { type:'config', icon:'🎭', label:'Ton', desc: TONE_OPTS[s.tone] || s.tone },
      { type:'config', icon:'🌐', label:'Język', desc: LANG_OPTS[s.lang] || s.lang },
      { type:'config', icon:'🔗', label:'Zapytania (rotacja)', desc: String(s.queries ?? 0) },
      { type:'nav', icon:'📝', label:'Edytor zapytań', desc:'Zarządzaj pulą zapytań Google News', gotoLevel:{ level:'queries-editor' } },
      { type:'nav', icon:'🧠', label:'NB Config', desc:'Konfiguracja NotebookLM', gotoLevel:{ level:'nb-config' } },
      { type:'nav', icon:'🔀', label:'Git / Deploy', desc:'Status repozytorium', gotoLevel:{ level:'git-status' } },
      { type:'nav', icon:'⬇️', label:'Pobieranie', desc:'Artifacty NB do pobrania', gotoLevel:{ level:'downloads' } },
      { type:'action', icon:'🔄', label:'Reset do domyślnych', desc:'Przywróć domyślne ustawienia' },
    ];
    const pickerMap = ['model', 'format', 'persona', 'tone', 'lang'];
    const inputKeys = ['queries'];
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.gotoLevel) { pushLevel(t.gotoLevel); return; }
      const idx = tiles.indexOf(t);
      if (idx < 5) {
        pushLevel({ level: 'pickers', picker: pickerMap[idx] });
      } else if (idx === 5) {
        showInputDialog('queries');
      } else if (t.label === 'Reset do domyślnych') {
        showResetConfirm();
      }
    });
  }

  // Picker level
  function renderPickers(lvl) {
    const picker = lvl.picker;
    const opts = picker === 'model' ? modelsList.map(m => ({ value: m, label: m }))
      : picker === 'format' ? Object.entries(FORMAT_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : picker === 'persona' ? Object.entries(PERSONA_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : picker === 'tone' ? Object.entries(TONE_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : picker === 'lang' ? Object.entries(LANG_OPTS).map(([v,l]) => ({ value: v, label: l }))
      : [];
    const current = settingsCache[picker] || '';
    const tiles = opts.map(o => ({
      type:'choice', icon: o.value === current ? '◉' : '○', label: o.label, value: o.value, selected: o.value === current,
    }));
    tiles.push({ type:'back' });
    renderTiles(tiles, (t, el) => {
      if (t.type === 'back') { popLevel(); return; }
      if (t.type === 'choice') {
        settingsCache[picker] = t.value;
        saveSettings(settingsCache);
        popLevel(); // back to settings
      }
    });
  }

  // Result card (Penpot: Generation Complete)
  function renderResult(data) {
    const success = data.success !== false;
    const cancelled = data.error === 'cancel';
    const icon = cancelled ? '⚠️' : success ? '✔️' : '❌';
    const iconClass = cancelled ? 'warn' : success ? 'ok' : 'err';
    const title = cancelled ? 'Przerwano' : success ? 'Artykuł wygenerowany' : 'Błąd';
    const actionLabel = ACTION_LABELS[data.action] || data.action || '';
    const output = data.output || '';
    const hasFile = data.file && !cancelled;

    // Extract article info from output
    let artTitle = '', artSlug = '', artWords = '', artTime = '', artDate = '', artSize = '', artH2 = '';
    const titleM = output.match(/(?:→|artTitle:)\s*(.+?)(?:\s*[|·]\s*|$)/m);
    const slugM = output.match(/(?:slug|articles[\\/])([\w-]+)/);
    const wordsM = output.match(/Body:\s*(\d+)\s*zn/);
    const h2M = output.match(/\b(\d+)\s*H2/);
    const sizeM = output.match(/([\d.]+)\s*KB/);
    const dateM = output.match(/(\d{2}\.\d{2}\.\d{4})/);
    const timeM = output.match(/(?:min czytania|min read).*?(\d+)/i);
    if (titleM) artTitle = titleM[1].trim();
    if (slugM) artSlug = slugM[1];
    if (wordsM) artWords = wordsM[1];
    if (h2M) artH2 = h2M[1];
    if (sizeM) artSize = sizeM[1];
    if (dateM) artDate = dateM[1];
    if (timeM) artTime = timeM[1];

    const preview = output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(l => l.trim() && !l.includes('═══') && !l.includes('───')).slice(-6).join('\n').substring(0, 400);

    let actionButtons = '';
    if (success) {
      if (hasFile) actionButtons += `<a class="result-link" href="/${data.file}" target="_blank">📎  Otwórz artykuł</a>`;
      actionButtons += `<button class="result-btn primary" id="resultBack" style="margin:0 4px">🔄  Generuj kolejny</button>`;
    }
    actionButtons += `<button class="result-btn" id="resultBack2">↩  Powrót</button>`;

    const statsHtml = (artWords || artSize || artH2 || artTime)
      ? `<div class="stats-row">
          ${artWords ? `<div class="stat-item"><div class="stat-val">${artWords}</div><div class="stat-lbl">słów</div></div>` : ''}
          ${artH2 ? `<div class="stat-item"><div class="stat-val">${artH2}</div><div class="stat-lbl">sekcji H2</div></div>` : ''}
          ${artSize ? `<div class="stat-item"><div class="stat-val">${artSize}</div><div class="stat-lbl">KB HTML</div></div>` : ''}
          ${artTime ? `<div class="stat-item"><div class="stat-val">${artTime}</div><div class="stat-lbl">min czyt.</div></div>` : ''}
        </div>`
      : '';

    const previewHtml = (success && (artTitle || artSlug))
      ? `<div class="article-preview">
          <div class="article-preview-title">${artTitle || artSlug.replace(/-/g, ' ')}</div>
          <div class="article-preview-meta">${artDate ? '<span>📅 '+artDate+'</span>' : ''}${artTime ? '<span>📖 '+artTime+' min</span>' : ''}<span>🤖 gemma4:e4b</span></div>
          <div class="article-preview-body">${preview.split('\n').filter(l=>l.length>20).slice(0,1)[0] || 'Treść wygenerowana pomyślnie...'}</div>
          ${artSlug ? `<div class="article-preview-slug">articles/${artSlug}.html</div>` : ''}
        </div>`
      : '';

    tilesEl.innerHTML = `
      <div class="result-card">
        <div class="result-icon ${iconClass}">${icon}</div>
        <div class="result-title">${title}</div>
        ${actionLabel ? `<div class="result-desc">${actionLabel}</div>` : ''}
        ${statsHtml}
        ${previewHtml}
        ${!success ? `<div class="progress-output" style="max-height:200px">${preview}</div>` : ''}
        <div style="display:flex;gap:8px;justify-content:center;margin-top:1rem;flex-wrap:wrap">
          ${actionButtons}
        </div>
      </div>`;
    const backBtn = document.getElementById('resultBack');
    const backBtn2 = document.getElementById('resultBack2');
    if (backBtn) backBtn.addEventListener('click', () => {
      // Go back two levels: result → action level
      if (navStack.length > 2) { navStack = navStack.slice(0, navStack.length - 2); render(); }
      else popLevel();
    });
    if (backBtn2) backBtn2.addEventListener('click', popLevel);
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ===========================
  // Live Progress view (Penpot 8-step design)
  // ===========================
  function renderProgress(data) {
    const label = data.label || '';
    const startTime = Date.now();
    const steps = [
      { id:'loading', icon:'🔄', label:'Ładowanie modelu', desc:'gemma4:e4b (9GB) — ładuję do RAM...' },
      { id:'warmup', icon:'⏳', label:'Warmup', desc:'Pierwsze zapytanie testowe do modelu' },
      { id:'prompt', icon:'📝', label:'Prompt', desc:'Budowanie promptu SEO według formatu i persony' },
      { id:'generating', icon:'✍️', label:'Generowanie', desc:'AI pisze artykuł — streaming tokenów' },
      { id:'validate', icon:'✅', label:'Walidacja', desc:'Sprawdzanie JSON i poprawności treści' },
      { id:'html', icon:'📄', label:'HTML', desc:'Budowanie dokumentu z Schema.org i Open Graph' },
      { id:'save', icon:'💾', label:'Zapis', desc:'Zapis do articles/ + aktualizacja indeksu' },
      { id:'deploy', icon:'🚀', label:'Deploy', desc:'Git push + Google Indexing + LinkedIn' },
    ];
    const stepsHtml = steps.map((s, i) => {
      const isActive = i === 0 ? ' active' : '';
      const connector = i < steps.length - 1 ? '<div class="progress-step-connector"></div>' : '';
      return `<div class="progress-step${isActive}" data-step="${s.id}">
        <div class="progress-step-dot">${i+1}</div>
        ${connector}
        <div class="progress-step-body">
          <div class="progress-step-label">${s.icon} ${s.label}</div>
          <div class="progress-step-desc">${s.desc}</div>
        </div>
      </div>`;
    }).join('');

    tilesEl.innerHTML = `
      <div class="result-card" id="progressCard" style="padding:1.5rem 1rem;">
        <div class="result-title" id="progressTitle">${label || 'Generowanie artykułu'}</div>
        <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.8rem" id="progressTimer">⏱ 0s</div>
        <div class="progress-steps">${stepsHtml}</div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-bg"><div class="progress-bar-fill" id="progressBar" style="width:2%"></div></div>
        </div>
        <div class="progress-output" id="progressOutput">⌛  Ładowanie modelu gemma4:e4b do RAM... (9GB, może potrwać ~60s)</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:.8rem">
          <button class="result-btn" id="progressCancel">✕  Anuluj (Esc)</button>
        </div>
      </div>`;
    // Auto-update elapsed time every second
    const timerEl = document.getElementById('progressTimer');
    const timerInterval = setInterval(() => {
      if (!timerEl || !document.getElementById('progressCard')) { clearInterval(timerInterval); return; }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      timerEl.textContent = `⏱ ${elapsed}s`;
    }, 1000);
    // Store for cleanup
    if (running) running._progressTimer = timerInterval;
    document.getElementById('progressCancel').addEventListener('click', () => {
      if (running) doCancel();
      popLevel();
    });
    requestAnimationFrame(() => {
      const el = document.getElementById('progressOutput');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function renderProgressLive(output) {
    const outEl = document.getElementById('progressOutput');
    if (!outEl) return;
    const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
    outEl.textContent = clean || '⌛  Oczekiwanie...';
    outEl.scrollTop = outEl.scrollHeight;

    // Detect which step is active based on output content
    const activeStep = detectStep(clean);
    updateProgressSteps(activeStep);

    // Update progress bar
    const steps=['loading','warmup','prompt','generating','validate','html','save','deploy'];
    const idx = steps.indexOf(activeStep);
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = `${Math.max(2, ((idx+1)/steps.length)*100)}%`;

    // Update title based on step
    const titleEl = document.getElementById('progressTitle');
    if (titleEl) {
      const titles = {
        loading:'🔄 Ładowanie modelu do RAM...',
        warmup:'⏳ Warmup — testowe zapytanie',
        prompt:'📝 Budowanie promptu',
        generating:'✍️ AI pisze artykuł...',
        validate:'✅ Walidacja wyniku',
        html:'📄 Budowanie HTML + SEO',
        save:'💾 Zapis pliku',
        deploy:'🚀 Git push + Deploy',
      };
      titleEl.textContent = titles[activeStep] || 'Generowanie artykułu';
    }
  }

  function detectStep(text) {
    if (!text) return 'loading';
    if (text.includes('Warmup') || text.includes('ładuję model') || text.includes('ładuję')) return 'loading';
    if (text.includes('Gotowe!') || text.includes('Warmup') && text.match(/[0-9]+\.[0-9]+s/)) return 'warmup';
    if (text.includes('Prompt') && (text.includes('znaków') || text.includes('System:'))) return 'prompt';
    if (text.includes('Generowanie') || text.includes('Wciąż generuję') || text.includes('pisze artykuł')) return 'generating';
    if (text.includes('streamResponse') || text.includes('JSON') || text.includes('walidac')) return 'validate';
    if (text.includes('HTML') || text.includes('Schema') || text.includes('buildHtml')) return 'html';
    if (text.includes('Zapis') || text.includes('zapis') || text.includes('articles/')) return 'save';
    if (text.includes('Push') || text.includes('push') || text.includes('Commit') || text.includes('Deploy') || text.includes('Indexing')) return 'deploy';
    return 'loading';
  }

  function updateProgressSteps(activeId) {
    const container = document.getElementById('progressCard');
    if (!container) return;
    const allSteps = container.querySelectorAll('.progress-step');
    const ids = ['loading','warmup','prompt','generating','validate','html','save','deploy'];
    const activeIdx = ids.indexOf(activeId);
    allSteps.forEach((step, i) => {
      step.classList.remove('active', 'done');
      if (i < activeIdx) step.classList.add('done');
      else if (i === activeIdx) step.classList.add('active');
    });
  }

  // ===========================
  // Warmup handler
  // ===========================
  async function handleWarmup(el) {
    if (running) { showToast('Poczekaj na zakończenie zadania', 'err'); return; }
    el.classList.add('running');
    running = { el, output: '' };
    pushLevel({ level: 'progress', data: { action: 'warmup', label: 'Warmup Ollama' } });
    
    const es = new EventSource('/api/warmup');
    running.es = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') return;
        if (msg.done) {
          es.close();
          el.classList.remove('running');
          if (running && running._progressTimer) clearInterval(running._progressTimer);
          running = null;
          const success = msg.success !== false;
          navStack = navStack.filter(l => l.level !== 'progress');
          showToast(success ? '✅ Model załadowany!' : '❌ ' + (msg.error || 'Błąd'), success ? '' : 'err');
          if (success) popLevel();
          else pushLevel({ level: 'result', data: { success: false, error: msg.error, action: 'warmup', output: msg.output || '' } });
          return;
        }
        if (msg.data) {
          running.output = (running.output || '') + msg.data;
          if (currentLevel().level === 'progress') renderProgressLive(running.output);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      showToast('Połączenie przerwane', 'err');
      el.classList.remove('running');
      if (running && running._progressTimer) clearInterval(running._progressTimer);
      running = null;
      navStack = navStack.filter(l => l.level !== 'progress');
      render();
    };
  }

  // ===========================
  // Handle action tile click
  // ===========================
  async function handleActionTile(t, el) {
    // if already running, ask to cancel
    if (running) {
      const ok = await showConfirm('Przerwać?', 'Zadanie jest w trakcie. Przerwać?', 'Przerwij', 'Kontynuuj');
      if (ok) await doCancel();
      return;
    }
    let input = null;

    // input dialog
    if (t.needsInput) {
      input = await showInputDialogValue(t.inputLabel || 'Wprowadź dane', t.inputPlaceholder || '', t.inputDefault);
      if (input === null) return;
    }

    // push question for content tiles
    let pushFlag = true;
    if (t.askPush) {
      pushFlag = await showChoice('Push na gita?', 'Wypushować zmiany na GitHub?', { label:'Nie', value: false }, { label:'Tak', value: true });
      if (pushFlag === null) return;
    }

    el.classList.add('running');

    const body = { push: pushFlag };
    if (t.needsInput && input) {
      if (t.action === 'rss') body.url = input;
      else body.topic = input;
    }
    body.digest = !!settingsCache._digest;
    body.newsletter = !!settingsCache._newsletter;
    body.verbose = !!settingsCache._verbose;

    try {
      const resp = await fetch(`/api/run/${t.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!data.ok) {
        showToast(`Błąd: ${data.error}`, 'err');
        el.classList.remove('running');
        running = null;
        return;
      }

      // Show progress view immediately (before setting running to avoid pushLevel guard)
    running = { tileAction: t, el, output: '' };
    pushLevel({ level: 'progress', data: { action: t.action, label: t.label || t.action } });

    // start SSE
    const es = new EventSource(`/api/run/${data.runId}/stream`);
      running.es = es;
      running.runId = data.runId;

      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'connected') return;
          if (msg.done) {
            es.close();
            el.classList.remove('running');
            if (running && running._progressTimer) clearInterval(running._progressTimer);
            addJobToQueue(running?.tileAction?.label || 'Zadanie', msg.error ? 'error' : 'done', msg.output);
            running = null;
            const out = msg.output || '';
            const fileMatch = out.match(/(?:output[/\\])[^\s\n]+\.(?:md|json|html)/i) || out.match(/(?:do|:|→)\s*([^\s\n]+\.(?:md|json|html|txt))/i);
            // Replace progress level with result
            navStack = navStack.filter(l => l.level !== 'progress');
            pushLevel({ level: 'result', data: { success: !msg.error, error: msg.error, action: t.action, output: out, file: fileMatch ? (fileMatch[1] || fileMatch[0]).trim() : null } });
            return;
          }
          // Live update: accumulate output and re-render progress
          if (msg.data) {
            running.output = (running.output || '') + msg.data;
            if (currentLevel().level === 'progress') renderProgressLive(running.output);
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        showToast('Utracono połączenie z serwerem', 'err');
        el.classList.remove('running');
        if (running && running._progressTimer) clearInterval(running._progressTimer);
        running = null;
        // Pop progress level on error
        navStack = navStack.filter(l => l.level !== 'progress');
        render();
      };
    } catch (e) {
      showToast(`Błąd sieci: ${e.message}`, 'err');
      el.classList.remove('running');
      running = null;
    }
  }

  async function doCancel() {
    const r = running;
    if (!r) return;
    if (r.es) r.es.close();
    if (r._progressTimer) clearInterval(r._progressTimer);
    if (r.runId) {
      try { await fetch(`/api/run/${r.runId}/cancel`, { method: 'POST' }); } catch {}
    }
    if (r.el) r.el.classList.remove('running');
    running = null;
    showToast('Przerwano');
  }

  // ===========================
  // Dialog system
  // ===========================
  let dialogResolve = null;

  function showDialog(title, htmlContent, actions) {
    return new Promise(resolve => {
      dialogResolve = resolve;
      dialogTitle.textContent = title;
      dialogBody.innerHTML = htmlContent;
      dialogActions.innerHTML = '';
      actions.forEach(a => {
        const btn = document.createElement('button');
        btn.className = `dialog-btn dialog-btn-${a.style || 'secondary'}`;
        btn.textContent = a.label;
        btn.addEventListener('click', () => { resolve(a.value); closeDialog(); });
        dialogActions.appendChild(btn);
      });
      dialog.classList.add('open');
      dialogOverlay.classList.add('open');
      requestAnimationFrame(() => { const f = dialog.querySelector('button, input, select, textarea'); if (f) f.focus(); trapFocus(dialog); });
    });
  }

  function closeDialog() {
    dialog.classList.remove('open');
    dialogOverlay.classList.remove('open');
    dialogResolve = null;
  }

  function trapFocus(container) {
    const focusable = container.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    container.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dialog.classList.contains('open')) {
      if (dialogResolve) dialogResolve(null);
      closeDialog();
    }
  });
  dialogOverlay.addEventListener('click', () => {
    if (dialogResolve) dialogResolve(null);
    closeDialog();
  });

  function showInputDialogValue(label, placeholder, defaultValue) {
    return showDialog(label, `<label style="display:block;font-size:.85rem;color:var(--text-dim);margin-bottom:8px">${label}</label><textarea class="dialog-textarea" id="dialogInput" placeholder="${placeholder}" rows="3"></textarea>`, [
      { label:'Anuluj', style:'secondary', value: null },
      { label:'Uruchom', style:'primary', value: 'ok' },
    ]).then(val => {
      if (val === null) return null;
      const inp = document.getElementById('dialogInput');
      return inp.value.trim() || defaultValue || '';
    });
  }

  function showInputDialog(key) {
    const labelMap = { queries:'Zapytania (rotacja) — oddzielone przecinkami' };
    const current = settingsCache[key] ?? '';
    showDialog(labelMap[key] || key, `<label style="display:block;font-size:.85rem;color:var(--text-dim);margin-bottom:8px">${labelMap[key] || key}</label><textarea class="dialog-textarea" id="dialogInput" rows="2">${current}</textarea>`, [
      { label:'Anuluj', style:'secondary', value: null },
      { label:'Zapisz', style:'primary', value: 'ok' },
    ]).then(val => {
      if (val === null) return;
      const inp = document.getElementById('dialogInput');
      const v = inp.value.trim();
      settingsCache[key] = key === 'queries' ? (parseInt(v,10) || 0) : v;
      saveSettings(settingsCache);
      renderSettings();
    });
  }

  function showConfirm(title, message, okLabel, cancelLabel) {
    return showDialog(title, `<p style="line-height:1.7;margin-bottom:0">${message}</p>`, [
      { label: cancelLabel || 'Anuluj', style: 'secondary', value: null },
      { label: okLabel || 'Uruchom', style: 'primary', value: true },
    ]);
  }

  function showChoice(title, message, optA, optB) {
    return showDialog(title, `<p style="line-height:1.7;margin-bottom:0">${message}</p>`, [
      { label: optA.label, style: optA.style || 'secondary', value: optA.value },
      { label: optB.label, style: optB.style || 'primary', value: optB.value },
    ]);
  }

  function showResetConfirm() {
    showConfirm('Przywróć domyślne', 'Czy na pewno przywrócić domyślne ustawienia?', 'Przywróć', 'Anuluj').then(ok => {
      if (!ok) return;
      settingsCache = { model:'gemma4:e4b', format:'article', persona:'journalist', tone:'casual', lang:'pl', queries:0 };
      delete settingsCache._digest;
      delete settingsCache._newsletter;
      delete settingsCache._verbose;
      saveSettings(settingsCache);
      renderSettings();
    });
  }

  // ===========================
  // Toast
  // ===========================
  let toastTimer;
  function showToast(msg, type) {
    toast.textContent = msg;
    toast.style.borderColor = type === 'err' ? 'var(--red)' : 'var(--cyan)';
    toast.style.color = type === 'err' ? 'var(--red)' : 'var(--cyan)';
    toast.style.boxShadow = type === 'err' ? '0 0 15px rgba(239,68,68,.2)' : '';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ===========================
  // Settings API
  // ===========================
  async function loadSettings() {
    try { const r = await fetch('/api/settings'); settingsCache = await r.json(); }
    catch { settingsCache = {}; }
    return settingsCache;
  }
  async function saveSettings(data) {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      settingsCache = data;
      updateHeaderInfo();
    } catch { showToast('Błąd zapisu ustawień', 'err'); }
  }

  function updateHeaderInfo() {
    const s = settingsCache || {};
    const parts = [];
    if (s.format && s.format !== 'article') parts.push(`<span>format</span> <strong>${s.format}</strong>`);
    if (s.persona && s.persona !== 'journalist') parts.push(`<span>persona</span> <strong>${s.persona}</strong>`);
    if (s.tone && s.tone !== 'casual') parts.push(`<span>ton</span> <strong>${s.tone}</strong>`);
    if (s.lang && s.lang !== 'pl') parts.push(`<span>język</span> <strong>${s.lang.toUpperCase()}</strong>`);
    if (parts.length) {
      headerInfo.innerHTML = parts.join('<span style="opacity:.25;margin:0 4px">|</span>');
      headerInfo.classList.add('show');
    } else {
      headerInfo.classList.remove('show');
    }
  }

  // ===========================
  // Status
  // ===========================
  async function updateNbStatus() {
    const prev = nbAuthed;
    try {
      const resp = await fetch('/api/nb/auth-status');
      const data = await resp.json();
      nbAuthed = !!data.auth;
    } catch { nbAuthed = false; }
    updateNbStatusUI();
    if (prev !== nbAuthed && currentLevel().level === 'home') render();
  }
  function updateNbStatusUI() {
    if (!headerNbStatus) return;
    const dot = headerNbStatus.querySelector('.status-dot');
    const label = headerNbStatus.querySelector('.status-label');
    if (nbAuthed) {
      if (dot) dot.className = 'status-dot on';
      if (label) label.textContent = 'NB: Online';
    } else {
      if (dot) dot.className = 'status-dot off';
      if (label) label.textContent = 'NB: Offline';
    }
  }
  async function updateStatus() {
    try {
      const resp = await fetch('/api/status');
      const data = await resp.json();
      const dot = headerStatus.querySelector('.status-dot');
      const label = headerStatus.querySelector('.status-label');
      if (data.ollama) {
        dot.className = 'status-dot on';
        label.textContent = 'Online';
        headerModel.textContent = data.models[0] || '—';
      } else {
        dot.className = 'status-dot off';
        label.textContent = 'Ollama offline';
        headerModel.textContent = '—';
      }
    } catch {
      headerStatus.querySelector('.status-dot').className = 'status-dot off';
      headerStatus.querySelector('.status-label').textContent = 'Offline';
    }
  }

  async function loadModels() {
    try {
      const r = await fetch('/api/models');
      modelsList = await r.json();
    } catch { modelsList = []; }
  }

  // ===========================
  // Custom cursor
  // ===========================
  let mx = -100, my = -100, cx = -100, cy = -100;
  function initCursor() {
    if (!matchMedia('(hover:hover)and(pointer:fine)').matches) return;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; cursorDot.style.left = mx+'px'; cursorDot.style.top = my+'px'; });
    function lerp() {
      cx += (mx - cx) * 0.1;
      cy += (my - cy) * 0.1;
      cursorRing.style.left = cx+'px';
      cursorRing.style.top = cy+'px';
      requestAnimationFrame(lerp);
    }
    cx = mx; cy = my;
    requestAnimationFrame(lerp);
    document.addEventListener('mouseover', e => {
      if (e.target.closest('.tile, .dialog-btn, .result-btn, .result-link')) cursorRing.classList.add('hover');
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest('.tile, .dialog-btn, .result-btn, .result-link')) cursorRing.classList.remove('hover');
    });
    document.addEventListener('mousedown', () => cursorDot.classList.add('click'));
    document.addEventListener('mouseup', () => cursorDot.classList.remove('click'));
  }

  // ===========================
  // Preloader
  // ===========================
  function initPreloader() {
    const fill = preloader.querySelector('.preloader-fill');
    fill.style.width = '100%';
    setTimeout(() => {
      preloader.classList.add('reveal');
    }, 600);
  }

  // ===========================
  // Sidebar job queue
  // ===========================
  function addJobToQueue(label, status, output) {
    jobHistory.unshift({ label, status, time: new Date(), output: output || '' });
    if (jobHistory.length > 20) jobHistory.length = 20;
    renderJobQueue();
  }
  function renderJobQueue() {
    const el = document.getElementById('jobQueue');
    if (!el) return;
    const items = [];
    if (running) items.push({ label: running.tileAction?.label || 'Zadanie', status: 'running', output: running.output, _isRunning: true });
    jobHistory.forEach(j => {
      if (!running || j.label !== (running.tileAction?.label || 'Zadanie')) items.push(j);
    });
    if (items.length === 0) { el.innerHTML = '<div class="job-empty">Brak aktywnych zadań</div>'; return; }
    el.innerHTML = items.slice(0, 12).map((j, i) => {
      const cls = j.status === 'running' ? 'running' : j.status === 'error' ? 'error' : 'done';
      const icon = j.status === 'running' ? '🔄' : j.status === 'error' ? '❌' : '✅';
      const time = j.time ? new Date(j.time).toLocaleTimeString('pl-PL', {hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="job-item ${cls}" data-job-idx="${i}" title="Kliknij aby zobaczyć szczegóły">
        <span class="job-label">${icon} ${j.label}</span>
        <span class="job-status">${time}</span>
      </div>`;
    }).join('');
    el.querySelectorAll('.job-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.jobIdx);
        if (isNaN(idx)) return;
        const job = items[idx];
        if (!job) return;
        if (job._isRunning && running) {
          if (currentLevel().level !== 'progress') pushLevel({ level: 'progress', data: { action: running.tileAction?.action, label: running.tileAction?.label } });
          return;
        }
        if (job.output) {
          const clean = (job.output || '').replace(/\x1b\[[0-9;]*m/g, '');
          const preview = clean.split('\n').filter(l => l.trim()).slice(-12).join('\n').substring(0, 600);
          showDialog('Szczegóły zadania', `<p style="color:var(--text-dim);margin-bottom:8px;font-size:.75rem">${escapeHtml(job.label)} · ${job.status}</p><pre style="font-family:var(--font-mono);font-size:.7rem;color:var(--text-dim);max-height:300px;overflow-y:auto;white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:4px">${escapeHtml(preview)}</pre>`, [{ label:'Zamknij', style:'secondary', value: null }]).then(() => {});
        } else {
          showToast('Brak danych dla tego zadania', '');
        }
      });
    });
  }
  function updateSidebarStats() {
    const aEl = document.getElementById('sidebarArticles');
    const mEl = document.getElementById('sidebarModel');
    if (aEl && telemetryCache) aEl.textContent = `${telemetryCache.articles?.total || 0} artykułów`;
    if (mEl) mEl.textContent = (settingsCache.model || '—');
  }

  // Sidebar action clicks
  document.querySelectorAll('.sidebar-action').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      if (action === 'home' && !running) { navStack = [{ level: 'home' }]; render(); }
      if (action === 'articles' && !running) pushLevel({ level: 'articles' });
    });
  });
  // Sidebar stat click for articles
  const articlesStat = document.getElementById('sidebarArticles');
  if (articlesStat) {
    articlesStat.addEventListener('click', () => { if (!running) pushLevel({ level: 'articles' }); });
  }
  async function init() {
    initPreloader();
    initCursor();
    await Promise.all([loadSettings(), loadModels()]);
    updateStatus(); updateNbStatus(); updateSidebarStats();
    setInterval(updateStatus, 15000);
    setInterval(updateNbStatus, 45000);
    updateHeaderInfo();
    const warmupBtn = document.querySelector('.sidebar-action[data-action="warmup"]');
    if (warmupBtn) warmupBtn.addEventListener('click', () => handleWarmup(warmupBtn));
    render();
  }

  init();
})();
