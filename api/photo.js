// Wayleaf — Openverse（Flickr・Wikimediaなどの自由に使える写真）を探す中継
// ブラウザから直接 Openverse に聞けなかったときだけ使います。
// 同じ言葉の検索結果は Vercel に1日保存して、Openverse への問い合わせを減らします。

import { sameSite, allow } from "./_guard.js";

export default async function handler(req, res) {
  if (!sameSite(req)) return res.status(403).json({ results: [] });
  if (!allow(req, "photo", [{ windowMs: 10 * 60e3, max: 150 }])) return res.status(429).json({ results: [] });
  const q = String(req.query?.q || "").slice(0, 100).trim();
  if (!q) return res.status(400).json({ results: [] });
  const url = "https://api.openverse.org/v1/images/?" + new URLSearchParams({
    q, page_size: "12", license_type: "commercial", mature: "false",
  });
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Wayleaf (travel plan site)" } });
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ results: [] });
    const data = await r.json();
    const results = (data.results || []).map(x => ({
      id: x.id, title: x.title, thumbnail: x.thumbnail, url: x.url,
      creator: x.creator, license: x.license, license_version: x.license_version,
      foreign_landing_url: x.foreign_landing_url, tags: (x.tags || []).slice(0, 15).map(t => ({ name: t.name })),
    }));
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ results });
  } catch {
    return res.status(502).json({ results: [] });
  }
}
