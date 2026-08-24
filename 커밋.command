#!/bin/bash
# 네이버 블로그 자동화 - 커밋 전용 스크립트 (배포/태그 없음)
# 더블클릭으로 실행하세요.
# 하는 일: 변경된 파일 확인 → 커밋 → main push
# (버전 태그 push + GitHub Actions 빌드까지 하려면 "업데이트 배포.command"를 사용하세요.)

set -e
cd "$(dirname "$0")"

echo "================================================"
echo " 네이버 블로그 자동화 - 커밋"
echo "================================================"
echo ""

# 0. 잔여 git 잠금 파일(index.lock) 자가 진단 (업데이트 배포.command와 동일한 로직)
LOCK_FILE=".git/index.lock"
if [ -f "$LOCK_FILE" ]; then
  echo "⚠️  잔여 git 잠금 파일을 발견했습니다: $LOCK_FILE"
  LSOF_OUTPUT=$(lsof "$LOCK_FILE" 2>/dev/null)
  BLOCKING=$(echo "$LSOF_OUTPUT" | awk 'NR>1 { fd=$4; mode=substr(fd, length(fd), 1); if ($1 == "git" || mode == "w" || mode == "u") print }')
  if [ -n "$BLOCKING" ]; then
    echo "   이 파일을 아래 프로세스가 실제로(쓰기 모드로) 사용 중인 것으로 확인됩니다:"
    echo ""
    echo "$BLOCKING"
    echo ""
    echo "   위 프로그램을 종료한 뒤 다시 실행해주세요."
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
echo "[1/3] 변경된 파일 확인 중..."
echo ""
git status --short
echo ""

CHANGES=$(git status --porcelain)
if [ -z "$CHANGES" ]; then
  echo "변경된 파일이 없습니다. 커밋할 내용이 없어 종료합니다."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 0
fi

read -p "위 변경사항을 커밋하고 push할까요? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "취소되었습니다."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 0
fi

# 2. 커밋 메시지 입력
echo ""
DEFAULT_MSG="fix: 본문 이미지 가운데 정렬 안정화(정렬 물림/빈 줄/보너스 간격 수정)"
read -p "커밋 메시지를 입력하세요 (엔터 시 기본값 사용): " MSG
if [ -z "$MSG" ]; then
  MSG="$DEFAULT_MSG"
fi

# 3. add + commit + push
echo ""
echo "[2/3] 변경사항 커밋 중..."
git add -A
git commit -m "$MSG"

echo ""
echo "[3/3] main 브랜치 push 중..."
git push

echo ""
echo "완료되었습니다. (버전 태그/자동 빌드는 진행하지 않았습니다.)"
echo "배포가 필요하면 \"업데이트 배포.command\"를 별도로 실행하세요."
echo ""
read -p "엔터를 누르면 창이 닫힙니다..."
