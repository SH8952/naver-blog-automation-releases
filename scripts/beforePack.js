// ────────────────────────────────────────────────────────────────────────
// scripts/beforePack.js
// electron-builder beforePack 훅 (2026-07-15 신규)
//
// electron-builder가 앱을 패키징(files 수집 -> asar 구성)하기 직전에
// 자동으로 실행된다. package.json의 build.beforePack 에 이 파일 경로가
// 등록되어 있어, "npm run build:mac" / "npm run build:win" / GitHub
// Actions 빌드 전부 별도 설정 없이 이 훅을 자동으로 탄다.
//
// 하는 일: scripts/obfuscate.js를 호출해 build-obfuscated/ 폴더를
// 최신 원본 기준으로 다시 생성한다. package.json build.files 안의
// FileSet 매핑({from: "build-obfuscated/...", to: "..."})이 실제
// 패키징 시 이 폴더의 내용을 main.js/preload.js/license/src/db.js
// 자리에 대신 넣는다 — 원본 파일 자체는 건드리지 않는다.
//
// mac universal 빌드는 x64/arm64 각각에 대해 이 훅이 여러 번 호출될
// 수 있음 — 매번 동일한 원본으로 재생성하므로 여러 번 실행돼도 결과는
// 항상 동일하다(문제 없음).
// ────────────────────────────────────────────────────────────────────────

const { runObfuscation } = require('./obfuscate');

exports.default = async function beforePack(context) {
  console.log('[beforePack] 난독화 빌드 단계 시작 (' +
    (context && context.electronPlatformName ? context.electronPlatformName : '') + ')');
  runObfuscation();
  console.log('[beforePack] 난독화 빌드 단계 완료');
};
