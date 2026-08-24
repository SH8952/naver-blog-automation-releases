#!/bin/bash
# 네이버 블로그 자동화 - 커밋 전용 스크립트 (배포/태그 없음, 완전 자동)
# 더블클릭으로 실행하세요.
# 하는 일: 변경된 파일 확인 → 자동 커밋 → main push → 완료 확인 후
#          이 스크립트 자신을 삭제 → 터미널 창 자동 종료
# 질문 없이 곧바로 진행됩니다(사용자 요청, 2026-08-24 확정된 표준 패턴).
# 오류(git 잠금 충돌 등)로 중단되는 경우에는 안전을 위해 자동 삭제/
# 종료를 하지 않고 창을 열어둔 채 원인을 보여줍니다.
# (버전 태그 push + GitHub Actions 빌드까지 하려면 "업데이트 배포.command"를 사용하세요.)

cd "$(dirname "$0")"
SCRIPT_PATH="$(pwd)/$(basename "$0")"

echo "================================================"
echo " 네이버 블로그 자동화 - 커밋(자동)"
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
    echo "   (오류로 중단되어 이 창은 자동으로 닫지 않습니다.)"
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
  echo "변경된 파일이 없습니다. 커밋할 내용이 없어 3초 후 창을 닫습니다."
  sleep 3
  CURRENT_TTY=$(tty)
  osascript -e "tell application \"Terminal\" to close (first window whose tty is \"$CURRENT_TTY\")" >/dev/null 2>&1 &
  exit 0
fi

# 2. 자동 커밋(질문 없이 곧바로 진행)
DEFAULT_MSG="feat: 사용자 문체 학습 기능 추가(파일 가져오기 → AI 분석 → DB 저장 → 사용자 톤 재사용)"
echo "[2/3] 아래 내용으로 자동 커밋합니다:"
echo "   $DEFAULT_MSG"
echo ""
git add -A
if ! git commit -m "$DEFAULT_MSG"; then
  echo ""
  echo "⚠️  커밋 중 오류가 발생했습니다. 이 창은 자동으로 닫지 않습니다."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi

echo ""
echo "[3/3] main 브랜치 push 중..."
if ! git push; then
  echo ""
  echo "⚠️  push 중 오류가 발생했습니다(네트워크/충돌 등). 이 창은 자동으로 닫지 않습니다."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi

echo ""
echo "완료되었습니다. (버전 태그/자동 빌드는 진행하지 않았습니다.)"
echo "배포가 필요하면 \"업데이트 배포.command\"를 별도로 실행하세요."
echo ""
echo "3초 후 이 스크립트를 삭제하고 창을 닫습니다..."
sleep 3

# 완료 후 자기 자신 삭제
rm -f "$SCRIPT_PATH"

# 이 스크립트를 실행 중인 터미널 창만 자동 종료(macOS Terminal.app 기준)
CURRENT_TTY=$(tty)
osascript -e "tell application \"Terminal\" to close (first window whose tty is \"$CURRENT_TTY\")" >/dev/null 2>&1 &
exit 0
