---
layout: default
title: Blog
description: Blog SmartBuyers — artykuły o dropshippingu B2B, SelleeTools i e-commerce
---

<div class="hero">
  <div class="hero-inner">
    <div class="hero-eyebrow">SmartBuyers — Blog</div>
    <h1>📝 Blog</h1>
    <p>Wpisy o dropshippingu B2B, platformie SelleeTools i optymalizacji sprzedaży na marketplace'ach.</p>
    <div class="hero-line"></div>
  </div>
</div>

<main class="page-wrap">

  {% for post in site.posts %}
  <article class="blog-card">
    <span class="card-badge is-blog">blog</span>
    <h3><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h3>
    <div class="excerpt">{{ post.excerpt | strip_html | truncate: 250 }}</div>
    <div class="meta">{{ post.date | date: "%d.%m.%Y" }} · 📖 {{ post.content | number_of_words | divided_by: 200 | plus: 1 }} min czytania</div>
  </article>
  {% endfor %}

  {% if site.posts.size == 0 %}
  <div class="blog-empty">Brak wpisów na blogu. Pierwszy wkrótce!</div>
  {% endif %}

</main>
