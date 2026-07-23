#!/bin/bash

set -euo pipefail

npm version patch --no-git-tag-version
npm run dist
version=$(node -p "require('./package.json').version")
dmg_path="release/Acta-${version}-arm64.dmg"
download_path="$HOME/Downloads/Acta-${version}-arm64.dmg"

cp "$dmg_path" "$download_path"
open "$download_path"
