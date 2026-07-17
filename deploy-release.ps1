# 네이버 블로그 자동화 - 원스톱 릴리스 스크립트 (Windows용)
# 같은 폴더의 "업데이트_배포.bat"을 더블클릭하면 이 스크립트가 실행됩니다.
# 하는 일: 변경된 파일 커밋 → main push → package.json 버전으로 태그 push
#          (태그 push 시 GitHub Actions가 자동으로 빌드 + Release 생성)
#
# 2026-07-16 Windows 포팅 시 추가된 부분:
#   원본(Mac용 업데이트_배포.command)에는 없던 "빌드 대상 플랫폼 선택"
#   질문을 추가했습니다. GitHub Actions(build.yml)에 workflow_dispatch
#   플랫폼 선택 옵션을 반영해둔 경우에만 의미가 있습니다 — 아직 반영
#   전이라면 이 스크립트로 태그를 push해도 Mac/Windows가 항상 함께
#   빌드됩니다(원본과 동일한 동작).

$ErrorActionPreference = "Stop"
# 2026-07-17 수정: PowerShell 7.3+ 는 기본적으로 외부 명령(git 등)이 stderr에
# 뭔가 출력하면(종료 코드와 무관하게) 그걸 $ErrorActionPreference="Stop"과
# 결합해 스크립트를 강제 종료하는 에러로 취급한다. 그런데 "git rev-parse
# <아직 없는 태그>"처럼, 이 스크립트가 "실패해도 정상"으로 간주하고
# $LASTEXITCODE만 직접 확인하려던 지점들(예: 최초 배포 시 태그가 아직
# 없는 경우)까지 전부 여기 걸려 스크립트가 중간에 멈추는 문제가 실사용
# 중 확인됨. 이 설정을 꺼서, 외부 명령 실행 결과는 원래 의도대로
# $LASTEXITCODE로만 직접 판단하게 한다.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $global:PSNativeCommandUseErrorActionPreference = $false
}
Set-Location -Path $PSScriptRoot

function Pause-Exit {
    param([int]$Code = 0)
    Read-Host "엔터를 누르면 창이 닫힙니다"
    exit $Code
}

Write-Host "================================================"
Write-Host " 네이버 블로그 자동화 - 원스톱 릴리스 (Windows)"
Write-Host "================================================"
Write-Host ""

# 0. 잔여 git 잠금 파일(index.lock) 자가 진단
#    Mac 버전은 lsof로 "읽기 전용으로 잠깐 열어본 흔적(Spotlight 등)"과
#    "진짜 쓰기 잠금"을 구분했지만, Windows에는 lsof에 대응하는 표준
#    도구가 없어 이 구분은 생략합니다. 대신 파일이 있으면 사용자에게
#    다른 Git 프로그램(SourceTree, GitHub Desktop 등)이 열려있지 않은지
#    직접 확인받은 뒤 제거합니다.
$lockFile = ".git\index.lock"
if (Test-Path $lockFile) {
    Write-Host "⚠️  잔여 git 잠금 파일을 발견했습니다: $lockFile"
    Write-Host "   다른 Git 프로그램(GitHub Desktop, SourceTree, VS Code의 Git 기능 등)이"
    Write-Host "   열려 있다면 먼저 닫아주세요."
    Write-Host ""
    $confirmLock = Read-Host "다른 Git 프로그램을 모두 닫았습니다. 잠금 파일을 지우고 계속할까요? (y/n)"
    if ($confirmLock -ne "y" -and $confirmLock -ne "Y") {
        Write-Host "취소되었습니다."
        Pause-Exit 1
    }
    Remove-Item -Force $lockFile
    Write-Host "   제거 완료 — 계속 진행합니다."
    Write-Host ""
}

# 1. 변경된 파일 확인
Write-Host "[1/7] 변경된 파일 확인 중..."
Write-Host ""
git status --short
Write-Host ""

$changes = git status --porcelain
if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "변경된 파일이 없습니다. 커밋할 내용이 없어 종료합니다."
    Write-Host "(태그만 다시 push하고 싶다면 이 스크립트 대신 직접 git tag 명령을 사용하세요.)"
    Pause-Exit 0
}

$confirm = Read-Host "위 변경사항을 커밋하고 배포를 진행할까요? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "취소되었습니다."
    Pause-Exit 0
}

# 2. package.json 버전 읽기
$version = node -p "require('./package.json').version"
$tag = "v$version"
Write-Host ""
Write-Host "[2/7] package.json 버전: $version  ->  태그: $tag"
Write-Host ""
Write-Host "   (주의: 업데이트이력.md와 package.json의 버전을 먼저 맞춰두셨는지"
Write-Host "    확인해주세요. 이 스크립트는 버전을 자동으로 올리지 않습니다.)"
Write-Host ""
$vconfirm = Read-Host "이 버전($tag)으로 계속 진행할까요? (y/n)"
if ($vconfirm -ne "y" -and $vconfirm -ne "Y") {
    Write-Host "취소되었습니다. package.json/업데이트이력.md 버전을 먼저 맞춘 뒤 다시 실행해주세요."
    Pause-Exit 0
}

# 2-1. (Windows 포팅 시 추가) 빌드 대상 플랫폼 선택
#      build.yml에 workflow_dispatch 플랫폼 선택 옵션이 반영되어 있어야
#      실제로 의미가 있습니다. 태그 push는 원래 "on: push: tags"로 항상
#      두 플랫폼을 함께 빌드하므로, "Windows만"을 원하면 태그 push 대신
#      GitHub Actions 탭에서 workflow_dispatch를 이 태그 위치로 수동
#      실행해야 합니다 — 이 스크립트는 그 안내만 출력하고, 실제 선택은
#      GitHub 웹 화면에서 진행합니다.
Write-Host ""
Write-Host "[안내] 태그를 push하면 GitHub Actions의 'on: push: tags' 트리거가"
Write-Host "        작동해 Mac/Windows가 항상 함께 빌드됩니다."
Write-Host "        Windows만 빌드/배포하려면, 태그 push 후 GitHub Actions 탭에서"
Write-Host "        'Run workflow'(workflow_dispatch)로 이 태그를 선택하고"
Write-Host "        platform 값을 'win'으로 지정해 수동 실행해주세요."
Write-Host "        (build.yml에 플랫폼 선택 옵션이 반영되어 있어야 합니다.)"
Write-Host ""

# 3. 커밋 메시지 입력
$msg = Read-Host "커밋 메시지를 입력하세요 (엔터 시 기본값 'release: $tag' 사용)"
if ([string]::IsNullOrWhiteSpace($msg)) {
    $msg = "release: $tag"
}

# 4. add + commit + push
Write-Host ""
Write-Host "[3/7] 변경사항 커밋 중..."
git add -A
git commit -m "$msg"

Write-Host ""
Write-Host "[4/7] main 브랜치 push 중..."
git push

# 5. 태그 처리 (이미 존재하면 삭제 후 재생성 — 같은 버전으로 재빌드하는 경우)
Write-Host ""
Write-Host "[5/7] 태그 $tag 처리 중..."
git rev-parse "$tag" *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host "   기존 태그 $tag 가 이미 있어, 삭제 후 방금 커밋 위치로 다시 생성합니다."
    git tag -d "$tag" 2>$null
    git push origin ":refs/tags/$tag" 2>$null
}
git tag "$tag"

Write-Host ""
Write-Host "[6/7] 태그 push 중..."
git push origin "$tag"

Write-Host ""
Write-Host "[7/7] 완료되었습니다."
Write-Host ""
Write-Host "GitHub Actions에서 빌드가 자동으로 시작됩니다 (5~10분 소요)."
Write-Host "진행 상황: https://github.com/SH8952/naver-blog-automation-releases/actions"
Write-Host ""
Write-Host "Windows만 배포하려면 위 [안내]를 참고해 Actions 탭에서 수동 실행해주세요."
Write-Host ""
Pause-Exit 0
