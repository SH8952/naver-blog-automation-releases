#!/bin/bash
cd "$(dirname "$0")"

echo "================================================"
echo " 네이버 블로그 자동화 - 최신 코드 받기"
echo "================================================"
echo ""

echo "[1/5] 원격 저장소 확인 중 (git fetch)..."
if ! git fetch; then
  echo ""
  echo "[오류] 위에 나온 git 메시지를 확인해주세요 (인터넷 문제뿐 아니라,"
  echo "깃허브 인증 정보가 이 Mac에 아직 없는 경우에도 이렇게 나올 수 있습니다)."
  echo ""
  read -p "계속하려면 아무 키나 누르세요..." -n1 -s
  exit 1
fi

BEHIND=$(git log HEAD..origin/main --oneline)
AHEAD=$(git log origin/main..HEAD --oneline)

if [ -z "$BEHIND" ]; then
  echo ""
  echo "이미 최신 상태입니다 - 받아올 새 내용이 없습니다."
  echo ""
  read -p "계속하려면 아무 키나 누르세요..." -n1 -s
  exit 0
fi

echo ""
echo "[2/5] 새로 받아올 변경사항:"
echo "$BEHIND" | sed 's/^/  - /'
echo ""

if [ -n "$AHEAD" ]; then
  echo "[중단] 이 Mac에만 있는, 아직 올리지 않은 커밋이 있습니다:"
  echo "$AHEAD" | sed 's/^/  - /'
  echo ""
  echo "안전을 위해 자동으로 받지 않습니다. 먼저 이 커밋들을 직접 확인해주세요"
  echo "(git push로 올리거나, 필요 없으면 개발자와 상의 후 처리)."
  echo ""
  read -p "계속하려면 아무 키나 누르세요..." -n1 -s
  exit 1
fi

STATUS=$(git status --porcelain)
if [ -n "$STATUS" ]; then
  echo "[중단] 저장 안 된 변경사항이 있어 안전하게 받아올 수 없습니다:"
  echo "$STATUS" | sed 's/^/  /'
  echo ""
  echo "아래 중 하나를 선택해 처리한 뒤 다시 실행해주세요:"
  echo "  1) git stash        (변경사항을 잠깐 치워두기)"
  echo "  2) git checkout .   (변경사항을 그냥 버리고 최신으로 받기)"
  echo ""
  read -p "계속하려면 아무 키나 누르세요..." -n1 -s
  exit 1
fi

echo "[3/5] 최신 코드 받는 중 (git pull)..."
if ! git pull; then
  echo ""
  echo "[오류] git pull 중 문제가 발생했습니다. 위 메시지를 확인해주세요."
  echo ""
  read -p "계속하려면 아무 키나 누르세요..." -n1 -s
  exit 1
fi

echo ""
echo "[4/5] 받아온 파일 요약:"
echo "$BEHIND" | sed 's/^/  ✓ /'

echo ""
echo "[5/5] 의존성 패키지 확인 중 (npm install)..."
npm install

echo ""
echo "================================================"
echo " 완료! 최신 버전으로 업데이트되었습니다."
echo "================================================"
echo ""
read -p "계속하려면 아무 키나 누르세요..." -n1 -s
