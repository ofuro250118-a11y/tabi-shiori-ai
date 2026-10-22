// 旅のしおりAI — プランを作るサーバー側の処理（Vercel のサーバーレス関数）
// APIキーはブラウザに出さず、ここ（サーバー）だけで使います。

// 上から順に試し、混んでいる・使えないモデルは飛ばして次へ
const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
].filter((m, i, a) => m && a.indexOf(m) === i);

const clip = (v, n) => String(v ?? "").slice(0, n).trim();

function buildPrompt(b) {
  const n = Math.min(Math.max(parseInt(b.days, 10) || 3, 1), 10);
  const pace = ["のんびり", "ふつう", "ぎっしり"].includes(b.pace) ? b.pace : "ふつう";
  const interests = Array.isArray(b.interests) ? b.interests.slice(0, 15).map(s => clip(s, 20)).join("、") : "";
  return `あなたは、おしゃれでトレンドに詳しい日本語の旅行プランナーです。20代の女の子が「ここ行きたい！」と思えるような、具体的で現実的な旅行プランを作ってください。
観光地・お店はすべて実在するものだけを使い、移動時間も考えて時刻を組んでください。費用は円で目安を書きます（海外でも円換算）。

条件:
- 行き先: ${clip(b.dest, 60)}
- 日程: ${n === 1 ? "日帰り" : `${n - 1}泊${n}日`}（${n}日分）
- 出発日: ${clip(b.start, 20) || "未定"}（季節やイベントがあれば反映）
- 出発地: ${clip(b.from, 40) || "未定"}
- 人数: ${clip(b.people, 10)}
- 予算(1人あたり): ${clip(b.budget, 20)}
- したいこと: ${interests || "おまかせ"}
- ペース: ${pace}
- その他: ${clip(b.notes, 400) || "なし"}

写真のための名前:
- destWiki: 行き先の日本語版Wikipediaの記事名（例 "京都市"）。destEn: 英語名。
- highlights: その行き先を代表する有名な場所・景色がきれいな場所を6つ。name は正式な名前、feature は見た目の特徴や魅力を1文、wiki は日本語版Wikipediaの記事名、en は英語名。
- ごはん以外の予定(観光スポット)にも、あれば wiki(日本語版Wikipediaの記事名)を入れる。駅やホテルなどには不要(空文字)。

ごはんのルール:
- 各日のランチとディナーは必ず入れる（到着が遅い日・帰る日は時間に合う分だけ）。カフェやスイーツ休憩も1日1回くらい入れてよい。
- ごはんの予定は type:"meal" にして、その時間・場所・予算・好みに一番合う実在のお店を shop に1つ、ほかの候補を alternatives に3つ入れる。
- 各お店は name(正式な店名), genre, price(1人の目安 例 "¥1,500前後"), why(おすすめの理由を1文)。

JSONだけで答えてください。形式:
{"title":"旅のタイトル","summary":"2〜3文の概要","destWiki":"","destEn":"",
"meta":[{"label":"出発","value":"..."},{"label":"人数","value":"..."},{"label":"ペース","value":"..."}],
"highlights":[{"name":"","feature":"","wiki":"","en":""}],
"days":[{"label":"1日目","theme":"その日のテーマ","items":[
 {"time":"09:00","place":"場所名","wiki":"","activity":"何をするか1文","tip":"短いひとこと(なければ空文字)","cost":"¥1,000(なければ空文字)"},
 {"time":"12:00","type":"meal","meal":"ランチ","shop":{"name":"","genre":"","price":"","why":""},"alternatives":[{"name":"","genre":"","price":"","why":""}]}
]}],
"budget":[{"item":"交通","amount":"¥..."},{"item":"合計","amount":"約¥..."}],
"tips":["旅のコツを3つ"],"packing":["持ち物を3〜5個"]}
days は必ず ${n} 日分。ごはん以外の予定は1日あたり ${pace === "ぎっしり" ? "4〜6" : pace === "のんびり" ? "2〜3" : "3〜4"} 個。budget の最後は合計。`;
}

async function callGemini(model, prompt, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
    }),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POSTで送ってください。" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "サーバーにGEMINI_API_KEYが設定されていません。" });

  const body = typeof req.body === "string" ? (parseJson(req.body) || {}) : (req.body || {});
  if (!clip(body.dest, 60)) return res.status(400).json({ error: "行き先を入れてね。" });

  const prompt = buildPrompt(body);
  try {
    const started = Date.now();
    let status = 0, data = {}, busy = false;
    for (const model of MODELS) {
      if (Date.now() - started > 25000) break; // 制限時間(60秒)に間に合わなくなるので打ち切り
      ({ status, data } = await callGemini(model, prompt, key));
      if (status === 200) break;
      if (status === 401 || status === 403 || (status === 400 && /API key/i.test(data?.error?.message || ""))) {
        return res.status(500).json({ error: "APIキーが正しくないようです。Vercelに入れたキーを確認してね。" });
      }
      if (status === 429 || status === 503 || /high demand|overloaded/i.test(data?.error?.message || "")) busy = true;
      // 404(モデルなし)・429・500・503 などは次のモデルを試す
    }
    if (status !== 200 && busy) return res.status(503).json({ error: "今はAIがとても混み合っています。少し時間をおいて試してね。" });
    if (status !== 200) return res.status(502).json({ error: "AIの呼び出しに失敗しました。", detail: data?.error?.message });

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const plan = parseJson(text);
    if (!plan || !Array.isArray(plan.days)) return res.status(502).json({ error: "AIの返事をうまく読み取れませんでした。もう一度試してね。" });
    return res.status(200).json(plan);
  } catch (e) {
    return res.status(500).json({ error: "通信に失敗しました。もう一度試してね。" });
  }
}
