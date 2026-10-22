// Wayleaf — プランを作るサーバー側の処理（Vercel のサーバーレス関数）
// APIキーはブラウザに出さず、ここ（サーバー）だけで使います。
//
// 速くするために、プランは2段階で作ります。
//   mode:"outline" … 旅全体の骨組み（タイトル・見どころ・各日のエリアとスポット・予算など）
//   mode:"day"     … 骨組みをもとに、1日分の細かい予定（時刻・お店）
// 画面側は outline を作ったあと、各日の day を同時に呼びます。

// 上から順に試し、混んでいる・使えないモデルは飛ばして次へ
const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
].filter((m, i, a) => m && a.indexOf(m) === i);

const clip = (v, n) => String(v ?? "").slice(0, n).trim();

// ---------- 共通の条件 ----------
function conditions(b) {
  const n = Math.min(Math.max(parseInt(b.days, 10) || 3, 1), 10);
  const pace = ["のんびり", "ふつう", "ぎっしり"].includes(b.pace) ? b.pace : "ふつう";
  const hotel = clip(b.hotel, 120);
  const gender = GENDERS.includes(b.gender) ? b.gender : "";
  const age = AGES.includes(b.age) ? b.age : "";
  const interests = Array.isArray(b.interests) ? b.interests.slice(0, 15).map(s => clip(s, 20)).join("、") : "";
  const text = `条件:
- 行き先: ${clip(b.dest, 60)}
- 日程: ${n === 1 ? "日帰り" : `${n - 1}泊${n}日`}（${n}日分）
- 出発日: ${clip(b.start, 20) || "未定"}（季節やイベントがあれば反映）
- 出発地: ${clip(b.from, 40) || "未定"}
- 人数: ${clip(b.people, 10)}
- 性別: ${gender || "指定なし"}
- 年代: ${age || "指定なし"}
- 予算(1人あたり): ${clip(b.budget, 20)}
- したいこと: ${interests || "おまかせ"}
- ペース: ${pace}
- 泊まるホテル: ${hotel || "未定（おまかせ）"}
- その他: ${clip(b.notes, 400) || "なし"}${hotel ? `

ホテルについて:
- 泊まるホテルは「${hotel}」に決まっている。ここを拠点にする。
- 朝はホテルから出発し、夜はホテルに戻る流れで組む。ホテルからの移動時間も考え、ホテルから行きやすいエリア・お店を優先する。
- 初日はホテルにチェックイン（または荷物を預ける）、最終日はチェックアウトを予定に入れる。` : ""}`;
  const perDay = pace === "ぎっしり" ? "4〜6" : pace === "のんびり" ? "2〜3" : "3〜4";
  return { n, pace, perDay, text, gender, age };
}

const GENDERS = ["女性", "男性", "男女ミックス"];
const AGES = ["10代", "20代", "30代", "40代", "50代", "60代以上"];

// 誰が行く旅かによって、プランナーへの頼み方を変える
function intro(b) {
  const { gender, age, people } = { ...conditions(b), people: clip(b.people, 10) };
  const pre = age ? `${age}の` : "";
  const who = gender === "男女ミックス" ? `${pre}男女${people === "2人" ? "（カップルや友だち）" : "のグループ"}`
    : gender ? (people === "1人" ? `ひとり旅をする${pre}${gender}` : `${pre}${gender}どうし`)
    : age ? `${age}の旅行者` : "";
  const target = who ? `${who}が「ここ行きたい！」と思えて、その年代・メンバーで楽しめる` : "「ここ行きたい！」と思えるような";
  return `あなたは、おしゃれでトレンドに詳しい日本語の旅行プランナーです。${target}、具体的で現実的な旅行プランを作ります。
観光地・お店はすべて実在するものだけを使ってください。費用は円で目安を書きます（海外でも円換算）。`;
}

// ---------- 1. 骨組み ----------
function outlinePrompt(b) {
  const c = conditions(b);
  return `${intro(b)}

${c.text}

今回は旅全体の「骨組み」だけを作ってください（細かい時刻やお店は、あとで1日ずつ作ります）。
- 各日に、まわるエリア(area)、その日の流れ(flow：1〜2文。初日は出発地から着く時間、最終日は帰る時間も意識する)、主な観光スポット(spots：実在の名前を ${c.perDay} 個)を割り当てる。
- 日ごとにエリアを分けて、移動が少なくなるようにする。同じスポットを2日に入れない。
- destWiki: 行き先の日本語版Wikipediaの記事名（例 "京都市"）。destEn: 英語名。
- highlights: 行き先を代表する有名な場所・景色がきれいな場所を6つ。name は正式な名前、feature は見た目の特徴や魅力を1文、wiki は日本語版Wikipediaの記事名、en は英語名、lat/lng はおおよその緯度経度（わからなければ null）。

JSONだけで答えてください。形式:
{"title":"旅のタイトル","summary":"2〜3文の概要","destWiki":"","destEn":"",
"meta":[{"label":"出発","value":"..."},{"label":"人数","value":"..."},{"label":"ペース","value":"..."}],
"highlights":[{"name":"","feature":"","wiki":"","en":"","lat":35.0,"lng":135.7}],
"days":[{"label":"1日目","theme":"その日のテーマ","area":"","flow":"","spots":[""]}],
"budget":[{"item":"交通","amount":"¥..."},{"item":"合計","amount":"約¥..."}],
"tips":["旅のコツを3つ"],"packing":["持ち物を3〜5個"]}
days は必ず ${c.n} 日分。budget の最後は合計。`;
}

// ---------- 2. 1日分の細かい予定 ----------
function slimOutline(o) {
  const days = Array.isArray(o?.days) ? o.days.slice(0, 10) : [];
  return {
    title: clip(o?.title, 80),
    days: days.map(d => ({
      label: clip(d?.label, 20), theme: clip(d?.theme, 60), area: clip(d?.area, 60), flow: clip(d?.flow, 200),
      spots: Array.isArray(d?.spots) ? d.spots.slice(0, 8).map(s => clip(s, 40)) : [],
    })),
  };
}

function dayPrompt(b, outline, i) {
  const c = conditions(b);
  const o = slimOutline(outline);
  const d = o.days[i];
  const isFirst = i === 0, isLast = i === o.days.length - 1;
  return `${intro(b)}

${c.text}

旅全体の骨組み（決まっていること）:
${JSON.stringify(o)}

このうち「${d.label}（${d.theme}）」の細かい予定を作ってください。
- エリア「${d.area}」の、この日のスポット ${JSON.stringify(d.spots)} を中心に、移動時間も考えて時刻を組む。ほかの日のスポットは入れない。
- この日の流れ: ${d.flow}${isFirst ? "\n- 初日なので、出発地から着く時間を考えて始める。" : ""}${isLast ? "\n- 最終日なので、帰りの時間を考えて終える。" : ""}
- ごはん以外の予定は ${c.perDay} 個くらい。駅やホテルも予定に入れてよい。
- ランチとディナーは必ず入れる（着く前・帰ったあとの分は除く）。カフェやスイーツ休憩も1回くらい入れてよい。
- ごはんの予定は type:"meal" にして、その時間・場所・予算・好みに一番合う、この日のエリアの実在のお店を shop に1つ、ほかの候補を alternatives に3つ。各お店は name(正式な店名), genre, price(1人の目安 例 "¥1,500前後"), why(おすすめの理由を1文)。
- ごはん以外の予定には wiki を入れる。wiki は「その場所そのもの」の日本語版Wikipediaの記事名（例：清水寺、サンタモニカ・ピア）。
  その場所の記事がない場合（ホテル・小さなお店・エリア全体など）は空文字にする。街や地域の記事、近くの別の名所の記事で代用しない。
- ごはん以外の予定には en（その場所の英語での正式な名前、例 "Santa Monica Pier"、"Kiyomizu-dera"）も入れる。
- すべての場所とお店に lat, lng(おおよその緯度・経度の数値、わからなければ null)を入れる。

JSONだけで答えてください。形式:
{"items":[
 {"time":"09:00","place":"場所名","wiki":"","en":"","lat":35.0,"lng":135.7,"activity":"何をするか1文","tip":"短いひとこと(なければ空文字)","cost":"¥1,000(なければ空文字)"},
 {"time":"12:00","type":"meal","meal":"ランチ","shop":{"name":"","genre":"","price":"","why":"","lat":35.0,"lng":135.7},"alternatives":[{"name":"","genre":"","price":"","why":"","lat":35.0,"lng":135.7}]}
]}`;
}

// ---------- Gemini の呼び出し ----------
// 1回の呼び出しを待つ最長時間（Vercelの上限300秒より短く）
const CALL_TIMEOUT = 120000;

async function postGemini(model, prompt, key, thinking) {
  const generationConfig = { responseMimeType: "application/json", temperature: 0.8 };
  // 考える時間を短めにして速く返してもらう
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  } catch (e) {
    return { status: 504, data: { error: { message: "timeout" } } };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(model, prompt, key) {
  let out = await postGemini(model, prompt, key, true);
  // このモデルが「考える時間」の設定に対応していなければ、設定なしでやり直す
  if (out.status === 400 && /think/i.test(out.data?.error?.message || "")) out = await postGemini(model, prompt, key, false);
  return out;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

// 混んでいるモデルは飛ばしながら、JSONの答えをもらう
async function generate(prompt, key, isValid) {
  const started = Date.now();
  let status = 0, data = {}, busy = false;
  for (const model of MODELS) {
    if (Date.now() - started > 150000) break; // 次のモデルを試すと上限(300秒)に間に合わないので打ち切り
    ({ status, data } = await callGemini(model, prompt, key));
    if (status === 200) {
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      const json = parseJson(text);
      if (json && isValid(json)) return { ok: true, json };
      status = 502; data = { error: { message: "bad json" } };
      continue; // 読めない答えなら次のモデルで
    }
    if (status === 401 || status === 403 || (status === 400 && /API key/i.test(data?.error?.message || ""))) {
      return { ok: false, code: 500, body: { error: "APIキーが正しくないようです。Vercelに入れたキーを確認してね。" } };
    }
    if (status === 429 || status === 503 || status === 504 || /high demand|overloaded/i.test(data?.error?.message || "")) busy = true;
  }
  if (busy) return { ok: false, code: 503, body: { error: "今はAIがとても混み合っています。少し時間をおいて試してね。" } };
  if (data?.error?.message === "bad json") return { ok: false, code: 502, body: { error: "AIの返事をうまく読み取れませんでした。もう一度試してね。" } };
  return { ok: false, code: 502, body: { error: "AIの呼び出しに失敗しました。", detail: data?.error?.message } };
}

// ---------- 入口 ----------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTで送ってください。" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "サーバーにGEMINI_API_KEYが設定されていません。" });

  const body = typeof req.body === "string" ? (parseJson(req.body) || {}) : (req.body || {});
  if (!clip(body.dest, 60)) return res.status(400).json({ error: "行き先を入れてね。" });

  try {
    if (body.mode === "day") {
      const o = slimOutline(body.outline);
      const i = parseInt(body.dayIndex, 10);
      if (!o.days.length || !(i >= 0 && i < o.days.length)) return res.status(400).json({ error: "日にちの指定が正しくありません。" });
      const r = await generate(dayPrompt(body, body.outline, i), key, j => Array.isArray(j.items));
      return r.ok ? res.status(200).json({ items: r.json.items }) : res.status(r.code).json(r.body);
    }
    // それ以外は骨組み
    const { n } = conditions(body);
    const r = await generate(outlinePrompt(body), key, j => Array.isArray(j.days) && j.days.length > 0);
    if (!r.ok) return res.status(r.code).json(r.body);
    const o = r.json;
    o.days = o.days.slice(0, n);
    return res.status(200).json(o);
  } catch (e) {
    return res.status(500).json({ error: "通信に失敗しました。もう一度試してね。" });
  }
}
