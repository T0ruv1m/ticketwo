#!/usr/bin/env bash
# API (with reload) + Vite dev server (proxies /api to the API).
set -e
trap 'kill 0' EXIT
node_modules/.bin/tsx watch src/server/main.ts &
node_modules/.bin/vite
