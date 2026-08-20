# Acta

GitHub issue 風の「コメント」UIで、Markdown を日次ファイルへ追記していくシンプルなエディタです。

## できること
- Markdown 入力 + リアルタイムプレビュー
- タグ入力（区切り: `,` / `、`）→ タグでフィルター
- 画面上部の検索（`Ctrl+F` / `Cmd+F` でフォーカス）
- 追記保存（テキスト/Markdown）
- 既存投稿の編集/削除
- 自分が作成したGitHub Issue・PRをActaのTaskへ同期
- 保存先フォルダの変更を監視して自動再読み込み（CLIやAIが直接書いたToDo・ナレッジもリロード不要で反映）
- ToDoの大カテゴリ（プロジェクト名）はプロジェクト画面の並び順に追従（追記時も並べ替え。並び順未登録のプロジェクトは名前順で末尾）
- プロジェクトのタスクを削除するとToDoの該当行も削除（空になった大カテゴリの見出しも削除）
- ToDoカードにチェックボックスの進捗（完了数/全体）を表示
- プロジェクト（カンバン）と今日のToDoを1画面に統合。右のToDoレールは折りたたみ可（状態を保存）
- キーボードショートカット: `Cmd+1`〜`Cmd+3` で プロジェクト / ナレッジ / 検索 を切り替え

## GitHubのIssue・PRを同期する

プロジェクト画面の「GitHub同期」を押すと、GitHub Projectsへの所属とは関係なく、自分が作成したOpenなIssue・Pull Requestを取得します。Closed・Mergedは同期対象外です。初回のみターミナルで`gh auth login`を実行してください。

新しい項目は、ラベルと既存のActaタスク名との類似度からActaプロジェクトへ自動分類されます。十分な関連がないものだけ「その他」へ入り、Actaプロジェクトが自動作成されることはありません。カード内のプロジェクト選択欄から所属を修正すると、次回以降の同期でもその所属が維持されます。

Projectsの状態は`Backlog`、`InProgress`、`Done`です。同期したOpenなIssue・PRは`InProgress`に入ります（Acta側で状態を変えた項目はその状態を維持します）。同期の結果は今日のToDoにも反映され、新しい`InProgress`は追記、クローズ・マージ済みで消えた項目は既存行を完了マークへ更新します（今日のToDoが無い場合は何もしません）。GitHub由来の項目も、ToDoでは各Actaプロジェクトの通常タスクと同じ階層へ追加されます。GitHub由来のURLはプロジェクト画面でのみ表示し、ToDo本文には出力しません。

## 保存先
既定: `~/Documents/Acta/YYYY-MM-DD.md`

日付ファイルが存在しない場合は作成し、追記します。  
同一日のファイルが既に存在する場合は、ナレッジに日時（`YYYY-MM-DD HH:mm`）を含めます。

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
