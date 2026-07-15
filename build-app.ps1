# ──────────────────────────────────────────
#  네이버 블로그 자동화 — 원클릭 빌드 & 실행 (Windows용)
# ──────────────────────────────────────────
# 같은 폴더의 "build_app.bat"을 더블클릭하면 이 스크립트가 실행됩니다.
#
# 2026-07-16 Windows 포팅 시 원본(Mac용 build_app.command)과 달라진 점:
#   - Mac 버전은 Homebrew/nvm이 없으면 스크립트가 "직접, 조용히" 설치까지
#     진행했지만, Windows는 관리자 권한 문제로 스크립트가 조용히 설치
#     프로그램을 실행하기 어렵습니다. 그래서 Node.js/nvm-windows가 없으면
#     "자동 설치" 대신 "설치 안내 + 다운로드 링크 출력 후 중단"으로
#     동작을 바꿨습니다. (참고: 이 프로젝트 Windows 최초 셋업 때도 Git/
#     Node.js를 이 방식대로 사용자가 직접 설치했던 사례가 있습니다.)
#   - nvm은 Mac용(nvm-sh/nvm)과 Windows용(coreybutler/nvm-windows)이
#     서로 다른 별개 도구라 명령어 문법이 조금 다릅니다(아래 참고).

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Pause-Exit {
    param([int]$Code = 0)
    Read-Host "엔터를 누르면 창이 닫힙니다"
    exit $Code
}

Clear-Host
Write-Host ""
Write-Host "======================================================"
Write-Host "   네이버 블로그 자동화 — 원클릭 설치 & 실행 (Windows)"
Write-Host "======================================================"
Write-Host ""

# ── STEP 1: Node.js 확인 ───────────────────────────────────────
# (Mac 버전의 "Homebrew 확인" 대응 — Windows엔 Homebrew가 없으므로
#  Node.js 자체가 설치되어 있는지를 직접 확인하는 것으로 대체)
Write-Host "[ 1 / 5 ]  Node.js 확인..."
$nodeExists = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeExists) {
    Write-Host "  ❌ Node.js가 설치되어 있지 않습니다."
    Write-Host "     아래에서 nvm-windows를 먼저 설치해주세요:"
    Write-Host "     https://github.com/coreybutler/nvm-windows/releases"
    Write-Host "     (nvm-setup.exe 다운로드 후 실행 → 설치 완료 후 이 창을 닫고"
    Write-Host "      새 터미널에서 이 스크립트를 다시 실행해주세요.)"
    Pause-Exit 1
}
Write-Host "  ✅ Node.js 확인됨"
Write-Host ""

# ── STEP 2: nvm-windows + Node.js v20 LTS ──────────────────────
Write-Host "[ 2 / 5 ]  Node.js v20 LTS 확인..."
Write-Host "  (Electron은 Node.js v26과 호환되지 않아 v20 LTS를 사용합니다)"
Write-Host ""

$nvmExists = Get-Command nvm -ErrorAction SilentlyContinue
if (-not $nvmExists) {
    Write-Host "  ⚠️  nvm-windows가 설치되어 있지 않습니다."
    Write-Host "     버전 전환 없이 현재 설치된 Node.js로 계속 진행합니다."
    Write-Host "     (v20 LTS로 전환하고 싶다면 아래에서 nvm-windows를 설치해주세요:"
    Write-Host "      https://github.com/coreybutler/nvm-windows/releases )"
    $currentVersion = node -v
    Write-Host "  현재 Node.js 버전: $currentVersion"
} else {
    $has20 = nvm list | Select-String "20\."
    if (-not $has20) {
        Write-Host "  → Node.js v20 LTS 설치 중 (약 2분)..."
        nvm install 20
    }
    nvm use 20
    Write-Host "  ✅ Node.js $(node -v) / npm $(npm -v) (v20 LTS 활성화)"
}
Write-Host ""

# ── STEP 3: 포트 3000 정리 ──────────────────────────────────────
Write-Host "[ 3 / 5 ]  포트 3000 확인..."
$portConn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($portConn) {
    $portPid = $portConn[0].OwningProcess
    Write-Host "  → 포트 점유 프로세스(PID $portPid) 종료..."
    Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
Write-Host "  ✅ 포트 3000 사용 가능"
Write-Host ""

# ── STEP 4: 패키지 설치 ─────────────────────────────────────────
Write-Host "[ 4 / 5 ]  패키지 설치..."

# 이전에 다른 Node 버전으로 설치된 node_modules가 있으면 삭제 후 재설치
if (Test-Path "node_modules/electron") {
    $check = node -e "require('./node_modules/electron')" 2>&1 | Out-String
    if ($check -match "failed to install") {
        Write-Host "  → 기존 node_modules 삭제 후 재설치..."
        Remove-Item -Recurse -Force "node_modules"
    }
}

if (-not (Test-Path "node_modules")) {
    Write-Host "  → 패키지 설치 중 (약 3~5분)..."
    Write-Host ""
    npm install --legacy-peer-deps
    Write-Host ""
}

# Electron 바이너리 확인
$check = node -e "require('./node_modules/electron')" 2>&1 | Out-String
if ($check -match "failed to install") {
    Write-Host "  → Electron 바이너리 재다운로드..."
    Remove-Item -Recurse -Force "node_modules/electron" -ErrorAction SilentlyContinue
    npm install electron --legacy-peer-deps
}

# ── better-sqlite3 네이티브 모듈 설치 & 재컴파일 ──────────────────
# better-sqlite3는 Electron용으로 별도 컴파일이 필요합니다
if (-not (Test-Path "node_modules/better-sqlite3") -or -not (Test-Path "node_modules/@electron/rebuild")) {
    Write-Host "  → better-sqlite3 & rebuild 도구 설치 중..."
    npm install better-sqlite3 electron-store "@electron/rebuild" --legacy-peer-deps
    Write-Host ""
}

$sqliteNode = "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if (-not (Test-Path $sqliteNode)) {
    Write-Host "  → better-sqlite3 Electron용 컴파일 중 (약 1분)..."
    Write-Host "     (Windows에서는 Visual Studio Build Tools가 필요할 수 있습니다."
    Write-Host "      오류가 나면 'windows-build-tools' 또는 Visual Studio 2022의"
    Write-Host "      'Desktop development with C++' 워크로드 설치가 필요합니다.)"
    npx @electron/rebuild -f -w better-sqlite3
    Write-Host ""
}

Write-Host "  ✅ 패키지 설치 완료"
Write-Host ""

# ── STEP 5: 앱 실행 ─────────────────────────────────────────────
Write-Host "[ 5 / 5 ]  앱 실행 중..."
Write-Host ""
Write-Host "  잠시 후 앱 창이 열립니다 🚀"
Write-Host "  (이 창을 닫으면 앱도 종료됩니다)"
Write-Host ""
# 2026-07-16 추가: React 개발 서버(react-scripts start)가 기본적으로
# localhost:3000을 여는 브라우저 탭을 자동으로 하나 띄우는데, 이 앱은
# Electron 창에서 이미 같은 주소를 불러오므로 불필요함. BROWSER=none으로
# 설정하면 이 자동 브라우저 실행만 막고, Electron 창 실행에는 영향 없음.
$env:BROWSER = "none"
npm start
