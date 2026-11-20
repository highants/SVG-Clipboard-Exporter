# SVG Clipboard Exporter — v2.1.0

[English](README.en.md) | 日本語

クリップボードにコピーされた SVG コード、またはドラッグ＆ドロップされた `.svg` ファイルを、高解像度の **PNG** / **JPG** 画像へ変換してクリップボードにコピー・ファイル保存できる Chrome 拡張機能（Manifest V3）です。

## 主な機能

- **クリップボード SVG 自動検知**:
  - Gemini / ChatGPT / GitHub 等の「コードをコピー」ボタン（`navigator.clipboard.writeText` / `write`）、`Ctrl+C`（`copy` イベント）、外部エディタからのコピー（タブ復帰時）を自動検知し、変換確認 UI を起動します。
- **日本語 / 英語版 切り替え機能**:
  - ポップアップ・D&D 専用ウィンドウ右上の **「EN / 日本語」** ボタンでワンクリック切り替えできるほか、設定画面から `自動（ブラウザ設定）/ 日本語 / English` を選択できます。ページ内確認ダイアログや通知も連動して切り替わります。
- **画像保存時に SVG ファイルも一緒に保存するモード**:
  - 「保存時にSVGファイルも一緒に保存」をオンにすると、PNG または JPG 保存時に同じベースファイル名でサニタイズ済みの元 `.svg` ファイル（`xmlns`・XML 宣言付与）も同時にダウンロードします。
- **SVG ファイルの直接ドラッグ＆ドロップ変換**:
  - ポップアップ内のドロップエリア（クリック選択も可）に直接 `.svg` ファイルをドロップして変換できます。
  - Windows エクスプローラーや macOS Finder から直接ドラッグ＆ドロップしたい場合は、**「D&D専用ウィンドウ」** を開くことで、ウィンドウが閉じずに**単一および複数の `.svg` ファイルの一括ドラッグ＆ドロップ・プレビュー・一括 PNG/JPG（+SVG）保存**、さらに `Ctrl+V` 貼り付け変換が行えます。

## Chrome へのインストール手順

1. Chrome で `chrome://extensions/` を開きます。
2. 右上の **「デベロッパー モード」** をオンにします。
3. 左上の **「パッケージ化されていない拡張機能を読み込む」** をクリックします。
4. `gemini-svg-exporter` フォルダを選択します。

## 権限とプライバシー・セキュリティ

本拡張機能は **100% ローカル環境で完結** しており、外部サーバーへの通信・アナリティクス送信・クリップボード内容の永続保存を一切行いません。

| 権限 | 用途 |
| :--- | :--- |
| `storage` | 出力倍率・品質・背景色・表示言語などのユーザー設定を `chrome.storage.sync` に保存し、変換確認中の一時 SVG のみを `chrome.storage.session`（ブラウザ終了・処理完了時に破棄）に保持するため。 |
| `clipboardRead` / `offscreen` | 外部エディタ等からのコピー復帰時や選択範囲を伴わない `copy` イベント時にクリップボード内の SVG コードをローカル判定するため。SVG 以外の通常テキストコピーでは不要な読み取りや保存を行いません。 |
| `clipboardWrite` | ユーザーが「PNGに変換してコピー」「JPGに変換してコピー」を押したときに、生成した画像をクリップボードへ書き込むため。 |
| `content_scripts` (`http://*/*`, `https://*/*`) | Gemini を含む任意の Web サイト上でのコピー操作検知と、ポップアップ自動起動ができない場合のページ内確認ダイアログ表示のため。悪意あるページからの未操作 `postMessage` 偽装トリガーはユーザー操作検証によりブロックされます。 |

- **SVG サニタイズ**: プレビュー・変換・SVG 同時保存の前に `<script>`、`<iframe>`、`<object>`、`<embed>`、`<meta>`、`<link>`、`<base>`、`on*` イベント属性、危険な SMIL アニメーション（`<set>` / `<animate>`）、`javascript:` / `vbscript:` / `data:text/html` URI を除去しています。

## JPG クリップボードコピーの技術仕様

Chrome の標準 Async Clipboard API (`navigator.clipboard.write`) は標準形式として `image/png` のみをサポートしており、`image/jpeg` 単体の書き込みは拒否されます。

そのため **「JPGに変換してコピー」** 実行時は、指定された不透明背景色と JPG 圧縮品質で一度 JPEG を生成したうえで、OS 貼り付け互換のある `image/png` 形式へ変換してクリップボードへ書き込みます（対応ブラウザでは `web image/jpeg` カスタム形式も併記）。純粋な `.jpg` ファイルが必要な場合は **「JPG保存」** をご利用ください。

## テストの実行

Node.js（v20 以降）標準のテストランナーのみで実行できます（外部依存パッケージ不要）。

```powershell
node --test tests/manifest.test.mjs tests/i18n.test.mjs tests/svg-utils.test.mjs tests/renderer.test.mjs tests/workflow.test.mjs
```

## クレジット・ライセンス

- **制作ディレクション**: highants
- **開発**: Antigravity (Google Deepmind)
- **ライセンス**: [MIT License](LICENSE)
