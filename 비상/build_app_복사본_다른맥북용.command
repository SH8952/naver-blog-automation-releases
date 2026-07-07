#!/bin/bash

# ══════════════════════════════════════════════════════════════
#  ⚠️  이 파일은 build_app.command의 "복사본"입니다 (원본 아님)
#  생성일: 2026-07-07
#  목적: 다른 맥북에서 better-sqlite3 NODE_MODULE_VERSION 불일치
#        오류(예: "was compiled against ... 115" / "requires ... 130")로
#        앱이 실행되지 않는 문제를 자동으로 복구하기 위한 수정본입니다.
#  변경점: STEP 4의 better-sqlite3 체크 로직을 "파일 존재 여부만 확인"에서
#          "Electron 런타임으로 실제 로드가 되는지 확인"으로 강화했습니다.
#          (원본 build_app.command는 전혀 수정되지 않았습니다)
# ══════════════════════════════════════════════════════════════

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

clear
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  네이버 블로그 자동화 — 원클릭 설치 & 실행 (복사본) ║"
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

# [복사본 수정] 기존에는 better_sqlite3.node "파일이 존재하는지"만 확인했습니다.
# 다른 맥에서 폴더(node_modules 포함)를 통째로 옮겨온 경우, 파일 자체는
# 존재하지만 그 맥/Node 버전으로 컴파일된 것이라 현재 Electron의
# NODE_MODULE_VERSION과 맞지 않는 경우가 있습니다 (파일은 있으니 재컴파일을
# 건너뛰어 버려서 문제가 해결되지 않았습니다).
# → Electron의 내장 Node 런타임(ELECTRON_RUN_AS_NODE=1)으로 실제 로드해보고,
#   로드에 실패하면 파일 존재 여부와 상관없이 무조건 재컴파일합니다.
SQLITE_NODE="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
ELECTRON_BIN="node_modules/.bin/electron"

NEED_REBUILD=0
if [ ! -f "$SQLITE_NODE" ]; then
  NEED_REBUILD=1
elif [ -f "$ELECTRON_BIN" ]; then
  LOAD_CHECK=$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e "require('better-sqlite3'); console.log('SQLITE_OK')" 2>&1)
  if ! echo "$LOAD_CHECK" | grep -q "SQLITE_OK"; then
    echo "  → 기존 better-sqlite3가 이 Electron 버전과 맞지 않음을 확인:"
    echo "$LOAD_CHECK" | grep -m1 "NODE_MODULE_VERSION" | sed 's/^/     /'
    NEED_REBUILD=1
  fi
fi

if [ "$NEED_REBUILD" = "1" ]; then
  echo "  → better-sqlite3 Electron용 (재)컴파일 중 (약 1분)..."
  rm -rf node_modules/better-sqlite3/build
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
