#!/bin/bash
cd "$(dirname "$0")"

DEFAULT_MSG="feat: 검수 대기 '발행 완료' 수동 확인 버튼 추가(개발자 전용)

테스트 발행 후 사용자가 편집기에서 직접 발행 버튼을 눌러 실제 게시를
마쳤을 때, 검수 대기 화면에서 '발행 완료'를 눌러 상태/집계를 동기화.
- main.js: post:markPublished IPC 신규(isDev 가드)
- preload.js: post.markPublished(id) 노출
- ReviewQueue.jsx: '발행하기' 좌측에 '✅ 발행 완료' 버튼(개발 모드 전용)
실사용 검증 완료(2026-08-25: 대시보드/검수 대기/발행 스케줄러/발행 이력)."

CURRENT_TTY=$(tty)

if [ -z "$(git status --porcelain)" ]; then
  echo "변경사항이 없습니다. 3초 후 창을 닫습니다."
  sleep 3
  rm -f "$0"
  osascript -e "tell application \"Terminal\" to close (first window whose tty is \"$CURRENT_TTY\")" &
  exit 0
fi

git add -A
if ! git commit -m "$DEFAULT_MSG"; then
  echo ""
  echo "❌ 커밋 실패. 위 오류 메시지를 확인하세요."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi

if ! git push; then
  echo ""
  echo "❌ push 실패. 위 오류 메시지를 확인하세요."
  read -p "엔터를 누르면 창이 닫힙니다..."
  exit 1
fi

echo ""
echo "✅ 커밋 및 push 완료. 3초 후 창을 닫습니다."
sleep 3
rm -f "$0"
osascript -e "tell application \"Terminal\" to close (first window whose tty is \"$CURRENT_TTY\")" &
