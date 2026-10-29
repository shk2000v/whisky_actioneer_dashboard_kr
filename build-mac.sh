#!/usr/bin/env bash
# Build Whisky Tracker.app (+ .dmg) on this Mac.
#   ./build-mac.sh            → build for this Mac's CPU (Apple Silicon or Intel)
#   ./build-mac.sh --install  → also copy the app to /Applications
#
# Needs: Xcode Command Line Tools, Rust (rustup), Node.js 20+.
# A locally built app is not quarantined, so Gatekeeper does not block it on this Mac.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || fail "macOS에서만 실행할 수 있습니다."

say "1/4 도구 확인"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode Command Line Tools가 없습니다. 설치 창이 뜨면 설치를 끝낸 뒤 이 스크립트를 다시 실행하세요."
  xcode-select --install || true
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  [[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
fi
if ! command -v cargo >/dev/null 2>&1; then
  read -r -p "Rust가 없습니다. rustup으로 설치할까요? (https://rustup.rs) [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || fail "Rust를 설치한 뒤 다시 실행하세요."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi
command -v node >/dev/null 2>&1 || fail "Node.js 20 이상이 필요합니다. https://nodejs.org 에서 LTS를 설치하거나 'brew install node' 후 다시 실행하세요."
node_major=$(node -p 'process.versions.node.split(".")[0]')
(( node_major >= 20 )) || fail "Node.js $node_major 버전입니다. 20 이상으로 올려 주세요."
echo "rustc $(rustc --version | awk '{print $2}'), node $(node --version), $(uname -m)"

say "2/4 패키지 설치"
npm ci --no-audit --no-fund

say "3/4 앱 빌드 (처음은 5~10분 걸립니다)"
if ! npx tauri build --bundles app,dmg; then
  # The dmg step drives Finder via AppleScript; if macOS blocked that, the .app is still usable.
  echo "DMG 만들기에 실패했습니다. .app은 그대로 쓸 수 있습니다. (Finder 제어 권한을 거부했다면 시스템 설정 > 개인정보 보호 및 보안 > 자동화에서 허용)"
fi

APP=$(ls -d target/release/bundle/macos/*.app 2>/dev/null | head -1 || true)
[[ -n "$APP" ]] || fail "앱 빌드에 실패했습니다. 위 오류 메시지를 확인하세요."
DMG=$(ls target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)

say "4/4 완료"
echo "앱:  $APP"
[[ -n "$DMG" ]] && echo "DMG: $DMG"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/$(basename "$APP")"
  cp -R "$APP" /Applications/
  echo "/Applications 에 복사했습니다."
fi
open -R "$APP"
