---
layout: default
title: SmartBuyers — B2B Dropshipping Intelligence
description: AI-powered content hub. Automatycznie generowane artykuły SEO z RSS feedów. Newsy z branży e-commerce i AI.
---

<div class="hero">
  <div class="hero-inner">
    <div class="hero-eyebrow">SmartBuyers — Content Hub</div>
    <h1>B2B Dropshipping Intelligence</h1>
    <p>AI-powered news & analysis. Automatycznie generowane artykuły SEO z TechCrunch, Google News, Reddit. Newsy z branży e-commerce i AI publikowane codziennie.</p>
    <div class="hero-line"></div>
    <div class="hero-featured">
      <div class="hero-featured-label">→ Przeglądaj</div>
      <a href="{{ '/articles/' | relative_url }}">Wszystkie artykuły &mdash; najnowsze analizy i newsy</a>
      <div class="meta">{{ site.time | date: "%d.%m.%Y" }} &middot; Generator AI</div>
    </div>
  </div>
</div>

<main class="page-wrap">

  <div class="section-header">
    <h2 class="section-title">📝 Ostatnie wpisy na blogu</h2>
    <a href="{{ '/blog/' | relative_url }}" class="section-link">Zobacz wszystkie →</a>
  </div>

  {% for post in site.posts limit:5 %}
  <article class="blog-card">
    <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
    <div class="excerpt">{{ post.excerpt | strip_html | truncate: 200 }}</div>
    <div class="meta">{{ post.date | date: "%d.%m.%Y" }}</div>
  </article>
  {% endfor %}

  {% if site.posts.size == 0 %}
  <div class="blog-empty">Brak wpisów na blogu. Pierwszy wkrótce!</div>
  {% endif %}

  <div class="section-header" style="margin-top:2.5rem">
    <h2 class="section-title">📰 Najnowsze artykuły</h2>
    <a href="{{ '/articles/' | relative_url }}" class="section-link">Zobacz wszystkie →</a>
  </div>

  <p style="color:var(--text-dim);margin-bottom:1.5rem;font-size:.9rem">
    AI-generated SEO content — newsy, analizy, poradniki z branży e-commerce, dropshippingu B2B i technologii.
    Artykuły generowane automatycznie z RSS feedów i publikowane na GitHub Pages.
  </p>

  <div style="background:var(--card-bg);border-radius:var(--radius);border:1px solid var(--border);padding:2rem;text-align:center">
    <p style="margin-bottom:.8rem;font-size:1.05rem;font-weight:600">
      <a href="{{ '/articles/' | relative_url }}" style="color:var(--accent);text-decoration:none">
        Przejdź do listy artykułów →
      </a>
    </p>
    <p style="font-size:.85rem;color:var(--text-dim)">
      Aktualnie {{ site.static_files | where_exp:"f","f.path contains '/articles/' and f.extname == '.html'" | size }} artykułów
    </p>
  </div>

</main>
