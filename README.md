# Acta

GitHub issue 風の「コメント」UIで、Markdown を日次ファイルへ追記していくシンプルなエディタです。

## できること
- Markdown 入力 + リアルタイムプレビュー
- タグ入力（区切り: `,` / `、`）→ タグでフィルター
- 画面上部の検索（`Ctrl+F` / `Cmd+F` でフォーカス）
- 追記保存（テキスト/Markdown）
- 既存投稿の編集/削除

## 保存先
既定: `~/Documents/Acta/YYYY-MM-DD.md`

日付ファイルが存在しない場合は作成し、追記します。  
同一日のファイルが既に存在する場合は、記録に日時（`YYYY-MM-DD HH:mm`）を含めます。

保存先はアプリ右上の「保存先 -> 変更」からフォルダを選択して切り替えできます。

## 開発
```sh
npm install
npm run dev
```

## 配布（macOS DMG）
```sh
npm install
npm run dist
```

## リリース自動化（タグ push）
`v*` タグを push すると GitHub Actions で以下を実行します。
- DMG をビルド
- GitHub Release を作成して DMG を添付
- `inamuu/homebrew-tap` の `Casks/acta.rb` を更新して push

事前に、このリポジトリの Actions secrets に `HOMEBREW_TAP_TOKEN` を設定してください。  
必要権限は `inamuu/homebrew-tap` への push（`contents:write`）です。
