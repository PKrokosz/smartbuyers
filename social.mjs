const C = { rst: "\x1b[0m", red: "\x1b[31m", grn: "\x1b[32m", ylw: "\x1b[33m", dim: "\x1b[2m" };

export async function postToLinkedIn(title, desc, url) {
  const token = process.env.LINKEDIN_TOKEN;
  if (!token) { console.log(`  ${C.dim}→ LinkedIn: brak LINKEDIN_TOKEN (pomijam)${C.rst}`); return; }
  try {
    const me = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!me.ok) { console.log(`  ${C.ylw}→ LinkedIn: nie można pobrać profilu (${me.status})${C.rst}`); return; }
    const profile = await me.json();
    const sub = profile.sub;
    const body = { author: `urn:li:person:${sub}`, lifecycleState: "PUBLISHED", specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: `${title}\n\n${desc.slice(0, 300)}\n\n${url}` }, shareMediaCategory: "ARTICLE" } }, visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" } };
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" }, body: JSON.stringify(body) });
    if (res.ok) console.log(`  ${C.grn}→ LinkedIn: opublikowane ✅${C.rst}`);
    else { const e = await res.text(); console.log(`  ${C.ylw}→ LinkedIn: ${res.status} ${e.slice(0, 120)}${C.rst}`); }
  } catch (e) { console.log(`  ${C.ylw}→ LinkedIn: ${e.message}${C.rst}`); }
}
