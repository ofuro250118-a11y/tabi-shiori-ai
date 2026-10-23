// Wayleaf — 泊まる場所のおすすめ（PR）
// 国内：楽天トラベルの公式API（楽天ウェブサービス）で、本物のホテルの写真・最安料金・口コミを取る。
//       アフィリエイトIDを付けると、予約ページへのリンクが紹介料つきになる。
// 海外や見つからないとき：予約サイトの検索ページへのリンクを返す（Booking.com のIDがあれば紹介料つき）。
//
// Vercel の環境変数：
//   RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY … 楽天ウェブサービスのアプリIDとアクセスキー
//   RAKUTEN_AFFILIATE_ID                … 楽天アフィリエイトID
//   BOOKING_AID（任意）                  … Booking.com アフィリエイトのID

import { sameSite, allow } from "./_guard.js";

const RAKUTEN = "https://openapi.rakuten.co.jp/engine/api/Travel/KeywordHotelSearch/20260731";
const clip = (v, n) => String(v ?? "").slice(0, n).trim();

function toHotels(data) {
  // 1つのホテルの情報は [{hotelBasicInfo}, {hotelRatingInfo}] のように分かれて入っている
  const groups = [];
  const walk = n => {
    if (Array.isArray(n)) {
      const basic = n.find(x => x && x.hotelBasicInfo);
      if (basic) { groups.push(Object.assign({}, ...n.filter(x => x && typeof x === "object"))); return; }
      n.forEach(walk);
    } else if (n && typeof n === "object") {
      if (n.hotelBasicInfo) { groups.push(n); return; }
      if (n.hotel) return walk(n.hotel);
      Object.values(n).forEach(v => { if (v && typeof v === "object") walk(v); });
    }
  };
  walk(data.hotels || data);
  return groups.map(g => {
    const b = g.hotelBasicInfo || {}, r = g.hotelRatingInfo || {};
    return {
      no: b.hotelNo, name: b.hotelName, url: b.hotelInformationUrl || b.planListUrl,
      image: b.hotelImageUrl || b.hotelThumbnailUrl, minCharge: b.hotelMinCharge,
      review: b.reviewAverage, reviewCount: b.reviewCount, station: b.nearestStation, access: b.access,
      lat: b.latitude, lng: b.longitude, rating: r.serviceAverage ? { location: r.locationAverage, room: r.roomAverage } : null,
    };
  }).filter(h => h.name && h.url);
}

function searchLinks(area, city) {
  const q = [area, city].filter(Boolean).join(" ");
  const links = [];
  const aid = process.env.BOOKING_AID;
  links.push({
    label: "Booking.com でホテルを探す",
    url: "https://www.booking.com/searchresults.ja.html?" + new URLSearchParams({ ss: q, ...(aid ? { aid } : {}) }),
    sponsored: !!aid,
  });
  links.push({ label: "Google でホテルを探す", url: "https://www.google.com/travel/search?" + new URLSearchParams({ q: q + " ホテル" }), sponsored: false });
  return links;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!sameSite(req)) return res.status(403).json({ hotels: [], links: [] });
  if (!allow(req, "hotels", [{ windowMs: 10 * 60e3, max: 40 }])) return res.status(429).json({ hotels: [], links: [] });

  const keyword = clip(req.query?.keyword, 40);
  const area = clip(req.query?.area, 40), city = clip(req.query?.city, 40);
  const domestic = String(req.query?.domestic || "") === "1";
  const links = searchLinks(area || keyword, city);

  const appId = process.env.RAKUTEN_APP_ID, accessKey = process.env.RAKUTEN_ACCESS_KEY, affiliateId = process.env.RAKUTEN_AFFILIATE_ID;
  if (!domestic || !appId || !accessKey || keyword.length < 2) {
    res.setHeader("Cache-Control", "public, s-maxage=86400");
    return res.status(200).json({ hotels: [], links, source: null });
  }

  const params = new URLSearchParams({
    applicationId: appId, accessKey, keyword, format: "json", formatVersion: "2",
    hits: "12", responseType: "middle", datumType: "1",
    ...(affiliateId ? { affiliateId } : {}),
  });
  try {
    const site = "https://" + String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const r = await fetch(RAKUTEN + "?" + params, { headers: { accessKey, Referer: site + "/", Origin: site } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 見つからない（404）はふつうのこと。それ以外も、検索リンクだけは返す
      return res.status(200).json({ hotels: [], links, source: "rakuten", note: data?.error || String(r.status) });
    }
    // 口コミが多くて点数の高い順に、上位3つ
    const hotels = toHotels(data)
      .sort((a, b) => ((b.review || 0) * Math.log10((b.reviewCount || 0) + 10)) - ((a.review || 0) * Math.log10((a.reviewCount || 0) + 10)))
      .slice(0, 3);
    // ホテルの料金は変わるので、使い回しは6時間まで
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ hotels, links, source: "rakuten", affiliate: !!affiliateId });
  } catch (e) {
    return res.status(200).json({ hotels: [], links, source: "rakuten", note: "fetch_failed: " + String(e?.cause?.code || e?.message || e).slice(0, 120) });
  }
}
