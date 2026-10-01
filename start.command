#!/bin/zsh
set -eu
cd "${0:A:h}"
if ! command -v npm >/dev/null 2>&1; then
  print 'Node.js 22 이상을 설치한 뒤 다시 실행하세요.'
  read '?Enter 키로 닫기'; exit 1
fi
if [[ ! -d node_modules || ! -d colyseus/node_modules ]]; then
  npm install
  npm --prefix colyseus install
fi
npm run dev:all
