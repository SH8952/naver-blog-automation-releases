# 네이버 블로그 자동화 - 라이선스 키 생성기 실행 (Windows용)
# 같은 폴더의 "라이선스_발급.bat"을 더블클릭하면 이 스크립트가 실행됩니다.
# 브라우저가 자동으로 열리며(http://127.0.0.1:47100), 폼에 값을 채워
# 라이선스 키를 발급할 수 있습니다. 발급 이력은 keys/license-ledger.json에
# 로컬로만 기록되고(gitignore 대상, 외부 전송 없음), private.pem이 있어야
# 동작합니다(없으면 화면에 안내가 뜹니다).
#
# 종료하려면 이 터미널 창에서 Ctrl+C를 누르세요.

Set-Location -Path $PSScriptRoot

Write-Host "================================================"
Write-Host " 네이버 블로그 자동화 - 라이선스 키 생성기"
Write-Host "================================================"
Write-Host ""

node tools/generate-license-ui.js
