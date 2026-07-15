#!/bin/bash
# 네이버 블로그 자동화 - 원스톱 릴리스 스크립트
# 더블클릭으로 실행하세요.
# 하는 일: 변경된 파일 커밋 → main push → package.json 버전으로 태그 push
#          (태그 push 시 GitHub Actions가 자동으로 Mac/Windows 패키징 + Release 생성)

set -e
cd "$(dirname "$0")"

echo "================================================"
echo " 네이버 블로그 자동화 - 원스톱 릴리스"
echo "================================================"
echo ""

# 0. 잔여 git 잠금 파일(index.lock) 자가 진단 (2026-07-14 추가, 같은 날 2차 보강)
#    이전 실행이 비정상 종료(터미널 강제종료/잠자기/다른 Git 프로그램과
#    충돌 등)되면 .git/index.lock이 지워지지 않고 남아 다음 실행부터
#    계속 "File exists" 오류로 막힐 수 있음.
#    2026-07-14 2차 보강: 실사용 중 lsof가 "com.apple..."로 시작하는
#    macOS 백그라운드 프로세스(Spotlight 색인 등으로 추정)를 FD 'r'
#    (읽기 전용)로 잡아낸 사례를 확인함 — 이건 git이 실제로 쓰기 위해
#    잠근 게 아니라 시스템이 방금 바뀐 파일을 잠깐 읽어본 흔적일 뿐이라
#    배포를 막을 이유가 없음. 그래서 "git 프로세스 자신" 또는 "쓰기(w)
#    /읽기쓰기(u) 접근"인 경우에만 진짜 충돌로 보고 중단하고, 그 외
#    읽기 전용(r) 접근은 안전하게 무시하고 잔여 파일을 지운 뒤 진행한다.
LOCK_FILE=".git/index.lock"
if [ -f "$LOCK_FILE" ]; then
  echo "⚠️  잔여 git 잠금 파일을 발견했습니다: $LOCK_FILE"
  LSOF_OUTPUT=$(lsof "$LOCK_FILE" 2>/dev/null)
  # FD 컬럼(4번째 필드)의 마지막 글자가 w(쓰기) 또는 u(읽기+쓰기)이거나,
  # COMMAND(1번째 필드)가 git 자신인 경우만 "진짜 사용 중"으로 판단.
  BLOCKING=$(echo "$LSOF_OUTPUT" | awk 'NR>1 { fd=$4; mode=substr(fd, length(fd), 1); if ($1 == "git" || mode == "w" || mode == "u") print }')
  if [ -n "$BLOCKING" ]; then
    echo "   이 파일을 아래 프로세스가 실제로(쓰기 모드로) 사용 중인 것으로 확인됩니다:"
    echo ""
    echo "$BLOCKING"
    echo ""
    echo "   위 프로그램을 종료한 뒤 다시 실행해주세요."
    echo "   (위 프로세스가 이 배포 작업과 무관한 프로그램이 확실하다면,"
    echo "    터미널에서 직접 다음 명령으로 지운 뒤 다시 실행할 수도 있습니다:)"
    echo "    rm "$(pwd)/$LOCK_FILE""
    read -p "엔터를 누르면 창이 닫힙니다..."
    exit 1
  else
    if [ -n "$LSOF_OUTPUT" ]; then
      echo "   아래 프로세스가 파일을 읽기 전용으로 잠깐 열어본 흔적이 있지만"
      echo "   (Spotlight 색인 등 macOS 백그라운드 서비스로 추정), git이 실제로"
      echo "   쓰기 위해 잠근 것은 아니므로 무시하고 계속 진행합니다:"
      echo "$LSOF_OUTPUT"
      echo ""
    fi
    echo "   이전 실행이 남긴 잔여 파일로 판단, 자동으로 제거합니다."
    rm -f "$LOCK_FILE"
    echo "   제거 완료 — 계속 진행합니다."
  fi
  echo ""
fi

# 1. 변경된 파일 확인
echo "[1/6] 변경된 파일 확인 중..."
echo ""
git status --short
echo ""

CHANGES=$(git status --porcelain)
if [ -z "$CHANGES" ]; then
  echo "변경된 파일이 없습니다. 커밋할 내용이 없어 종료합니다."
  echo "(태그만 다시 push하고 싶다면 이 스크립트 대신 직접 git tag 명령을 사용하세요.)"
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 0
fi

read -p "위 변경사항을 커밋하고 배포를 진행할까요? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "취소되었습니다."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 0
fi

# 2. package.json 버전 읽기
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
echo ""
echo "[2/6] package.json 버전: $VERSION  ->  태그: $TAG"
echo ""
echo "   (주의: 업데이트이력.md와 package.json의 버전을 먼저 맞춰두셨는지"
echo "    확인해주세요. 이 스크립트는 버전을 자동으로 올리지 않습니다.)"
echo ""
read -p "이 버전($TAG)으로 계속 진행할까요? (y/n): " VCONFIRM
if [ "$VCONFIRM" != "y" ] && [ "$VCONFIRM" != "Y" ]; then
  echo "취소되었습니다. package.json/업데이트이력.md 버전을 먼저 맞춘 뒤 다시 실행해주세요."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 0
fi

# 3. 커밋 메시지 입력
echo ""
read -p "커밋 메시지를 입력하세요 (엔터 시 기본값 'release: $TAG' 사용): " MSG
if [ -z "$MSG" ]; then
  MSG="release: $TAG"
fi

# 4. add + commit + push
echo ""
echo "[3/6] 변경사항 커밋 중..."
git add -A
git commit -m "$MSG"

echo ""
echo "[4/6] main 브랜치 push 중..."
git push

# 5. 태그 처리 (이미 존재하면 삭제 후 재생성 — 같은 버전으로 재빌드하는 경우)
echo ""
echo "[5/6] 태그 $TAG 처리 중..."
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "   기존 태그 $TAG 가 이미 있어, 삭제 후 방금 커밋 위치로 다시 생성합니다."
  git tag -d "$TAG" || true
  git push origin ":refs/tags/$TAG" || true
fi
git tag "$TAG"
git push origin "$TAG"

echo ""
echo "[6/6] 완료되었습니다."
echo ""
echo "GitHub Actions에서 Mac/Windows 빌드가 자동으로 시작됩니다 (5~10분 소요)."
echo "진행 상황: https://github.com/SH8952/naver-blog-automation-releases/actions"
echo ""
read -p "엔터를 누르면 창이 닫힙니다..."
