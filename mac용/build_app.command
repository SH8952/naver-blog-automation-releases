#!/bin/bash

# ──────────────────────────────────────────
#  네이버 블로그 자동화 — 원클릭 빌드 & 실행
# ──────────────────────────────────────────

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

clear
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║    네이버 블로그 자동화 — 원클릭 설치 & 실행    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── STEP 1: Homebrew ───────────────────────
echo "[ 1 / 5 ]  Homebrew 확인..."
if ! command -v brew &>/dev/null; then
  echo "  → Homebrew 설치 중..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  [ -f "/opt/homebrew/bin/brew" ] && eval "$(/opt/homebrew/bin/brew shellenv)"
  [ -f "/usr/local/bin/brew" ]    && eval "$(/usr/local/bin/brew shellenv)"
fi
echo "  ✅ Homebrew OK"
echo ""

# ── STEP 2: nvm + Node.js v20 LTS ──────────
echo "[ 2 / 5 ]  Node.js v20 LTS 확인..."
echo "  (Electron은 Node.js v26과 호환되지 않아 v20 LTS를 사용합니다)"
echo ""

# nvm 설치
export NVM_DIR="$HOME/.nvm"
if [ ! -d "$NVM_DIR" ]; then
  echo "  → nvm 설치 중..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

# nvm 로드
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Node.js v20 설치 및 사용
if ! nvm list | grep -q "v20"; then
  echo "  → Node.js v20 LTS 설치 중 (약 2분)..."
  nvm install 20
fi
nvm use 20
echo "  ✅ Node.js $(node -v) / npm $(npm -v) (v20 LTS 활성화)"
echo ""

# ── STEP 3: 포트 3000 정리 ─────────────────
echo "[ 3 / 5 ]  포트 3000 확인..."
PORT_PID=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PORT_PID" ]; then
  echo "  → 포트 점유 프로세스 종료..."
  kill -9 $PORT_PID 2>/dev/null
  sleep 1
fi
echo "  ✅ 포트 3000 사용 가능"
echo ""

# ── STEP 4: 패키지 설치 ────────────────────
echo "[ 4 / 5 ]  패키지 설치..."

# 이전에 v26으로 설치된 node_modules가 있으면 삭제 후 재설치
if [ -d "node_modules/electron" ]; then
  CHECK=$(node -e "require('./node_modules/electron')" 2>&1)
  if echo "$CHECK" | grep -q "failed to install"; then
    echo "  → 기존 node_modules 삭제 후 재설치..."
    rm -rf node_modules
  fi
fi

if [ ! -d "node_modules" ]; then
  echo "  → 패키지 설치 중 (약 3~5분)..."
  echo ""
  npm install --legacy-peer-deps
  echo ""
fi

# Electron 바이너리 확인
CHECK=$(node -e "require('./node_modules/electron')" 2>&1)
if echo "$CHECK" | grep -q "failed to install"; then
  echo "  → Electron 바이너리 재다운로드..."
  rm -rf node_modules/electron
  npm install electron --legacy-peer-deps
fi

# ── better-sqlite3 네이티브 모듈 설치 & 재컴파일 ────────────
# better-sqlite3는 Electron용으로 별도 컴파일이 필요합니다
if [ ! -d "node_modules/better-sqlite3" ] || [ ! -d "node_modules/@electron/rebuild" ]; then
  echo "  → better-sqlite3 & rebuild 도구 설치 중..."
  npm install better-sqlite3 electron-store @electron/rebuild --legacy-peer-deps
  echo ""
fi

SQLITE_NODE="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ ! -f "$SQLITE_NODE" ]; then
  echo "  → better-sqlite3 Electron용 컴파일 중 (약 1분)..."
  npx @electron/rebuild -f -w better-sqlite3
  echo ""
fi

echo "  ✅ 패키지 설치 완료"
echo ""

# ── STEP 5: 앱 실행 ─────────────────────────
echo "[ 5 / 5 ]  앱 실행 중..."
echo ""
echo "  잠시 후 앱 창이 열립니다 🚀"
echo "  (이 창을 닫으면 앱도 종료됩니다)"
echo ""
npm start
