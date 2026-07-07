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
