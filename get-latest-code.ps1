$ErrorActionPreference = "Stop"
# 콘솔 한글 깨짐 방지 (cmd.exe 기본 코드페이지가 UTF-8이 아닐 때 대비)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# PowerShell 7.3+ 에서 git 같은 외부 명령의 정상적인 안내 메시지(예: git
# fetch의 "From https://..." 같은 stderr 출력)까지 스크립트 중단 에러로
# 잘못 처리하는 문제 방지. 기존엔 Get-Variable로 존재 여부를 먼저 확인한
# 뒤에만 껐는데, 이 확인 자체가 일부 PC 환경에서 정상 동작하지 않는
#것으로 확인되어(2026-07-19), 존재 여부와 무관하게 무조건 시도하도록
# 변경(구버전 PowerShell에는 이 변수가 아예 없어 오류가 나므로 try/catch로 감쌈).
try { $global:PSNativeCommandUseErrorActionPreference = $false } catch {}

Set-Location -Path $PSScriptRoot

Write-Host "================================================"
Write-Host " 네이버 블로그 자동화 - 최신 코드 받기"
Write-Host "================================================"
Write-Host ""

Write-Host "[1/5] 원격 저장소 확인 중 (git fetch)..."
git fetch
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[오류] 위에 나온 git 메시지를 확인해주세요 (인터넷 문제뿐 아니라,"
    Write-Host "깃허브 인증 정보가 이 PC에 아직 없는 경우에도 이렇게 나올 수 있습니다)."
    Write-Host ""
    pause
    exit 1
}

$behind = git log HEAD..origin/main --oneline
$ahead  = git log origin/main..HEAD --oneline

if (-not $behind) {
    Write-Host ""
    Write-Host "이미 최신 상태입니다 - 받아올 새 내용이 없습니다."
    Write-Host ""
    pause
    exit 0
}

Write-Host ""
Write-Host "[2/5] 새로 받아올 변경사항:"
$behind | ForEach-Object { Write-Host "  - $_" }
Write-Host ""

if ($ahead) {
    Write-Host "[중단] 이 PC에만 있는, 아직 올리지 않은 커밋이 있습니다:"
    $ahead | ForEach-Object { Write-Host "  - $_" }
    Write-Host ""
    Write-Host "안전을 위해 자동으로 받지 않습니다. 먼저 이 커밋들을 직접 확인해주세요"
    Write-Host "(git push로 올리거나, 필요 없으면 개발자와 상의 후 처리)."
    Write-Host ""
    pause
    exit 1
}

$status = git status --porcelain
if ($status) {
    Write-Host "[중단] 저장 안 된 변경사항이 있어 안전하게 받아올 수 없습니다:"
    $status | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "아래 중 하나를 선택해 처리한 뒤 다시 실행해주세요:"
    Write-Host "  1) git stash        (변경사항을 잠깐 치워두기)"
    Write-Host "  2) git checkout .   (변경사항을 그냥 버리고 최신으로 받기)"
    Write-Host ""
    pause
    exit 1
}

Write-Host "[3/5] 최신 코드 받는 중 (git pull)..."
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[오류] git pull 중 문제가 발생했습니다. 위 메시지를 확인해주세요."
    Write-Host ""
    pause
    exit 1
}

Write-Host ""
Write-Host "[4/5] 받아온 파일 요약:"
$behind | ForEach-Object { Write-Host "  ✓ $_" }

Write-Host ""
Write-Host "[5/5] 의존성 패키지 확인 중 (npm install)..."
npm install

Write-Host ""
Write-Host "================================================"
Write-Host " 완료! 최신 버전으로 업데이트되었습니다."
Write-Host "================================================"
Write-Host ""
pause
