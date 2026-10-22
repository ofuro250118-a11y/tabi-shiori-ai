# 旅のしおりAI（Webサイト版）

行き先・日数・予算などを入れると、AIが旅行プランを作るWebサイトです。

- 行き先や見どころの写真を、Wikipedia / Wikimedia Commons から自動で表示します（自由に使える写真で、撮影者とライセンスを写真の右下に表示）。
- ごはんは一番のおすすめ店を表示し、「ほかのおすすめ」をタップすると他の候補が見られます。
- AIは Google の Gemini API を使います（無料枠あり）。

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` | 画面（入力フォーム・プラン表示・写真の読み込み） |
| `api/plan.js` | サーバー側の処理。Gemini APIを呼んでプランを作る（APIキーはここだけで使う） |
| `package.json` | Vercel用の設定 |

## 公開のしかた（無料・パソコン推奨）

### 1. Gemini APIキーを取る
1. https://aistudio.google.com を開いて、Googleアカウントでログイン
2. 「Get API key」→「APIキーを作成」
3. 出てきたキーをコピーしておく（人に見せない）

### 2. GitHubにアップロード
1. https://github.com でアカウントを作る
2. 右上の「＋」→「New repository」→ 名前を `tabi-shiori-ai` にして「Create repository」
3. 「uploading an existing file」をクリック
4. このフォルダの中身（`index.html`、`package.json`、`README.md`、`api` フォルダ）をまとめてドラッグして「Commit changes」
   - `api` フォルダごと入れること。`api/plan.js` という形で入っていればOK

### 3. Vercelで公開
1. https://vercel.com を開いて「Continue with GitHub」でログイン
2. 「Add New…」→「Project」→ さっきの `tabi-shiori-ai` の「Import」
3. 「Environment Variables」を開いて、次を追加
   - Name: `GEMINI_API_KEY`
   - Value: 1でコピーしたキー
4. 「Deploy」を押す → 1分くらいで `https://tabi-shiori-ai-xxxx.vercel.app` のようなURLができます

### うまくいかないとき
- 「サーバーにGEMINI_API_KEYが設定されていません」→ Vercelの Settings → Environment Variables を確認して、Deployments から「Redeploy」
- 「AIの呼び出しに失敗しました」→ モデル名が変わった可能性があります。Environment Variables に `GEMINI_MODEL` を追加して、AI Studio に載っている Flash 系のモデル名（例: `gemini-3.8-flash`）を入れて Redeploy
- 「今はAIが混み合っています」→ 無料枠の回数制限です。少し待つと使えます

## 注意
- AIが出すお店の情報は、間違っていたり閉店していたりすることがあります。
- 写真はWikipediaにある写真を使うので、あまり有名でない場所は写真が出ないことがあります（その時はやわらかい色の枠だけ表示されます）。

