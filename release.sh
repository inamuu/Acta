#!/bin/bash

npm run dist
cp release/Acta-0.1.0-arm64.dmg ~/Downloads
open ~/Downloads/Acta-0.1.0-arm64.dmg
