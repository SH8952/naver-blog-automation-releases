#!/bin/bash
# 네이버 블로그 자동화 - 자동 커밋 스크립트
# 더블클릭으로 실행하세요.
# 확인 질문 없이 자동으로 커밋 + push 하고, 성공하면 이 스크립트 자신과
# 실행 중인 터미널 창까지 스스로 정리합니다. (2026-08-24 확정 표준,
# [[commit-script-full-auto-requirement]] 참고 — 오류 발생 시에는 자동
# 삭제/종료를 하지 않고 창을 열어둔 채 원인을 보여줍니다.)

cd "$(dirname "$0")"
SCRIPT_PATH="$(pwd)/$(basename "$0")"

echo "================================================"
echo " 네이버 블로그 자동화 - 자동 커밋"
echo "================================================"
echo ""

# 0. 잔여 git 잠금 파일(index.lock) 자가 진단
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
      echo "   실제로 쓰기 위해 잠근 것은 아니므로 무시하고 계속 진행합니다:"
      echo "$LSOF_OUTPUT"
      echo ""
    fi
    echo "   이전 실행이 남긴 잔여 파일로 판단, 자동으로 제거합니다."
    rm -f "$LOCK_FILE"
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

MSG="update: $(date '+%Y-%m-%d %H:%M')"

# 2. add + commit
echo "[2/3] 변경사항 커밋 중... (메시지: $MSG)"
if ! git add -A; then
  echo ""
  echo "[오류] git add 중 문제가 발생했습니다. 위 메시지를 확인해주세요."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi
if ! git commit -m "$MSG"; then
  echo ""
  echo "[오류] git commit 중 문제가 발생했습니다. 위 메시지를 확인해주세요."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi

# 3. push
echo ""
echo "[3/3] main 브랜치 push 중..."
if ! git push; then
  echo ""
  echo "[오류] git push 중 문제가 발생했습니다. 위 메시지를 확인해주세요."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi

echo ""
echo "완료되었습니다. 잠시 후 창이 자동으로 닫힙니다."

# 성공한 경우에만: 스크립트 자기 삭제 + 터미널 창 자동 종료
rm -f "$SCRIPT_PATH"

CURRENT_TTY=$(tty)
( sleep 1
  osascript -e "tell application \"Terminal\" to close (every window whose tty of selected tab is \"$CURRENT_TTY\")" >/dev/null 2>&1
) &
disown

exit 0
