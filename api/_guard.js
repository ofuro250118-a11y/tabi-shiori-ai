// Wayleaf — 使いすぎ防止（plan.js と photo.js から使う）
// 1. 自分のサイト以外（ほかのWebサイトやツール）からの呼び出しを断る
// 2. 同じ人（IPアドレス）が短い時間に何回も呼べないようにする
//
// 回数は、サーバーのメモリに一時的に数えるだけで保存はしない。
// サーバーが入れ替わると数え直しになる簡易版なので、
// 本格的に守るなら Vercel の Firewall（Rate Limiting）も一緒に使う。

const buckets = new Map(); // "名前|IP" → 呼んだ時刻の一覧

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || String(req.headers["x-real-ip"] || "") || "unknown";
}

// 同じサイトからの呼び出しかどうか（Origin か Referer のホストが、このサイトと同じか）
export function sameSite(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase();
  const from = String(req.headers.origin || req.headers.referer || "");
  if (!host || !from) return false;
  try { return new URL(from).host.toLowerCase() === host; } catch { return false; }
}

// rules: [{ windowMs, max }, ...] のどれか1つでも超えたら false
export function allow(req, name, rules) {
  const key = name + "|" + clientIp(req);
  const now = Date.now();
  const longest = Math.max(...rules.map(r => r.windowMs));
  const list = (buckets.get(key) || []).filter(t => now - t < longest);
  for (const r of rules) {
    if (list.filter(t => now - t < r.windowMs).length >= r.max) { buckets.set(key, list); return false; }
  }
  list.push(now);
  buckets.set(key, list);
  // メモリが増えすぎないように、たまに古い記録を捨てる
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > longest) buckets.delete(k);
  return true;
}
