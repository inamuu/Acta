#!/bin/bash

set -euo pipefail

# 起動中のActa.appを終了する（DMGの差し替え時に旧バージョンが残らないように）
quit_acta() {
  if ! pgrep -f "/Acta.app/Contents/MacOS/Acta" >/dev/null 2>&1; then
    return
  fi

  echo "起動中のActa.appを終了します"
  osascript -e 'quit app "Acta"' >/dev/null 2>&1 || true

  for _ in $(seq 1 20); do
    if ! pgrep -f "/Acta.app/Contents/MacOS/Acta" >/dev/null 2>&1; then
      return
    fi
    sleep 0.5
  done

  echo "通常終了しないため強制終了します"
  pkill -f "/Acta.app/Contents/MacOS/Acta" || true
  sleep 1
}

quit_acta

npm version patch --no-git-tag-version
npm run dist
version=$(node -p "require('./package.json').version")
dmg_path="release/Acta-${version}-arm64.dmg"
download_path="$HOME/Downloads/Acta-${version}-arm64.dmg"

cp "$dmg_path" "$download_path"
open "$download_path"
