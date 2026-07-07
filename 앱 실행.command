#!/bin/bash

# 쉘 프로파일 로드 (npm PATH 포함)
[ -f "$HOME/.zprofile" ]    && source "$HOME/.zprofile"
[ -f "$HOME/.zshrc" ]       && source "$HOME/.zshrc"
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile"
[ -f "$HOME/.bashrc" ]      && source "$HOME/.bashrc"
[ -f "$HOME/.nvm/nvm.sh" ]  && source "$HOME/.nvm/nvm.sh"

# Homebrew 경로 추가 (Intel / Apple Silicon)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# 이 파일이 있는 폴더로 이동
cd "$(dirname "$0")"

echo "================================================"
echo "  네이버 블로그 자동화 앱 실행기"
echo "================================================"
echo ""

# npm 존재 확인
if ! command -v npm &> /dev/null; then
  echo "❌ Node.js / npm 을 찾을 수 없습니다."
  echo ""
  echo "아래 주소에서 Node.js LTS를 설치 후 다시 실행해주세요:"
  echo "  https://nodejs.org"
  echo ""
  read -p "Enter 키를 누르면 창이 닫힙니다..."
  exit 1
fi

echo "✅ Node.js $(node -v) / npm $(npm -v) 확인"
echo ""

# node_modules 없으면 설치
if [ ! -d "node_modules" ]; then
  echo "📦 패키지 설치 중... (최초 1회, 약 3~5분 소요)"
  echo ""
  npm install --legacy-peer-deps
  echo ""
  echo "✅ 설치 완료!"
  echo ""
fi

echo "🚀 앱 실행 중..."
echo ""
npm start
