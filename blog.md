---
layout: default
title: Blog
---

# Blog

{% for post in site.posts %}
## [{{ post.title }}]({{ post.url }})

{{ post.excerpt | strip_html | truncate: 200 }}
<small>{{ post.date | date: "%d.%m.%Y" }}</small>

---
{% endfor %}

{% if site.posts.size == 0 %}
*Brak wpisów na blogu. Pierwszy wkrótce!*
{% endif %}
