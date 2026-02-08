# Acta

GitHub issue 風の「コメント」UIで、Markdown を日次ファイルへ追記していくシンプルなエディタです。

## できること
- Markdown 入力 + リアルタイムプレビュー
- タグ入力（区切り: `,` / `、`）→ タグでフィルター
- 画面上部の検索（`Ctrl+F` / `Cmd+F` でフォーカス）
- 追記保存（テキスト/Markdown）

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
