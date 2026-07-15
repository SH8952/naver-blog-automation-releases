// ────────────────────────────────────────────────────────────────────────
// scripts/obfuscate.js
// 배포 빌드 전용 소스 난독화 스크립트 (2026-07-15 신규, 같은 날 5차 수정)
//
// 목적: main.js / preload.js / src/db.js / license/**/*.js — 이 앱의
//       핵심 로직(AI 프롬프트, 네이버 SE3 자동화 셀렉터/재시도 로직,
//       라이선스 검증, 썸네일 생성 알고리즘 등)이 담긴 파일들을 배포
//       빌드에서만 난독화한다.
//
// 중요 — 원본 소스는 절대 건드리지 않는다:
//   이 스크립트는 프로젝트 루트의 main.js/preload.js/license/**/src/db.js를
//   "읽기"만 하고, 결과물은 build-obfuscated/ 폴더(신규, gitignore 대상)에
//   동일한 상대 경로 구조로 "새로" 써낸다. 개발자가 평소 열어서 수정하는
//   원본 파일은 이 스크립트 실행 전/후로 단 1바이트도 바뀌지 않는다.
//
// 실행 방법:
//   - 수동 확인용: npm run obfuscate
//   - 실제 배포 시 자동 실행: electron-builder의 beforePack 훅
//     (scripts/beforePack.js)이 패키징 직전에 이 스크립트를 자동으로
//     호출한다 — 개발자가 매번 따로 실행할 필요 없음.
//
// 소스맵: build-obfuscated-maps/ 에 별도로 생성한다(신규, gitignore 대상).
//   이 폴더는 package.json build.files에 절대 포함시키지 않는다 — 실제
//   배포되는 앱에는 소스맵이 들어가지 않고, 개발자 본인만 원인 추적용
//   으로 로컬에 보관한다.
//
// 2026-07-15 2차 수정 — 결정적(deterministic) 출력 보장:
//   Mac universal 빌드(x64+arm64를 하나로 합침)는 beforePack 훅이
//   아키텍처마다 한 번씩(총 2회) 실행된다. javascript-obfuscator는 실행할
//   때마다 식별자/문자열 배치를 무작위로 섞기 때문에, 같은 원본이어도
//   두 번 실행하면 서로 다른 결과 파일이 나온다 — 그 결과 @electron/
//   universal이 두 아키텍처의 main.js를 병합하지 못하고
//   "Can't reconcile two non-macho files main.js" 오류로 실패했다.
//   해결책: ①고정 seed로 결정적 출력 확보, ②캐시로 같은 빌드 내 재사용
//   (핵심 해결책, seed는 보조 안전장치).
//
// 2026-07-15 3차 수정 — 실행 시 크래시 수정(안정성 최우선으로 완화):
//   2차 수정까지 반영해 빌드/패키징 자체는 성공했으나, 만들어진 앱을
//   실제로 실행하자 켜지자마자 V8(자바스크립트 엔진) 내부에서
//   EXC_BREAKPOINT로 크래시(macOS 문제 리포트로 확인). 원인으로
//   지목된 옵션: selfDefending, controlFlowFlattening, deadCodeInjection.
//   사용자가 "보안보다 설치·실행이 우선"이라고 확인해 이 3개 비활성화.
//
// 2026-07-15 4차 수정 — 캐시 판단 방식을 "수정 시각" → "내용 해시"로 교체:
//   mtime 비교가 개발 환경/사용자 PC 간 동기화 문제로 신뢰할 수 없어
//   SHA-256 콘텐츠 해시 비교로 전면 교체(.obfuscate-cache/).
//
// 2026-07-15 5차 수정 — 진단용 SKIP_OBFUSCATION 스위치 추가:
//   4차 수정으로 캐시가 정상 동작함을 확인(빌드_에러_로그4.txt: 해시
//   일치로 재사용, "3차 수정이 실제 반영된 첫 빌드"였음이 확정됨).
//   그런데 이 빌드를 실행한 뒤 받은 크래시 리포트가 selfDefending 등을
//   켰을 때(BUG #3 발견 당시)의 크래시 리포트와 imageOffset까지 완전히
//   동일했다 — 즉 옵션 3개를 껐는데도 똑같은 지점에서 크래시가 남.
//   이는 그 3개 옵션이 크래시의 원인이 아닐 가능성이 높다는 뜻이며,
//   난독화 자체와 무관한 원인(Electron/V8/이 macOS 버전 호환성 문제
//   등)일 가능성을 시사한다. 이를 확인하기 위해 "난독화를 완전히
//   끈" 진단용 빌드가 필요해, 환경변수 SKIP_OBFUSCATION=1로 켜지는
//   임시 스위치를 추가했다 — 켜면 obfuscate/캐시 로직을 건너뛰고
//   원본 파일을 build-obfuscated/에 그대로(1바이트도 안 바꾸고) 복사만
//   한다. 배포용 코드 경로에는 영향 없음(환경변수를 안 주면 지금까지의
//   동작과 100% 동일) — 이번 1회성 진단 테스트만을 위한 것이며, 결과
//   확인 후 이 스위치 자체를 없앨 필요는 없다(평소엔 안 쓰이므로).
//
//   사용법(진단 1회용, 배포 빌드에는 절대 사용 금지):
//     SKIP_OBFUSCATION=1 npm run build:mac
// ────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'build-obfuscated');
const MAP_DIR = path.join(PROJECT_ROOT, 'build-obfuscated-maps');
// 캐시 키(해시) 저장 전용 폴더 — 배포에 포함되지 않음(gitignore 대상).
// OUT_DIR과 분리해두는 이유: OUT_DIR은 package.json build.files가
// 통째로 패키징에 매핑하므로, 캐시 파일이 여기 섞이면 배포물에 딸려
// 들어갈 위험이 있음.
const CACHE_DIR = path.join(PROJECT_ROOT, '.obfuscate-cache');

// 2026-07-15 5차 수정: 진단용 스위치. true면 난독화를 완전히 건너뛰고
// 원본 파일을 그대로 복사한다 — 크래시가 난독화 때문인지 아닌지
// 가려내기 위한 1회성 테스트 전용. 배포 빌드에는 절대 사용 금지.
const SKIP_OBFUSCATION = process.env.SKIP_OBFUSCATION === '1';

// 난독화 대상 — 배포에 포함되는 Node/Electron 메인 프로세스 쪽 소스만.
// (React 프론트엔드 build/**/*는 이번 1차 범위에서 제외 — react-scripts가
// 이미 Terser로 압축하고 있고, 실제 핵심 로직은 대부분 main.js 쪽에 있음.
// 필요하면 추후 별도로 논의 후 확장 가능.)
const TARGETS = [
  'main.js',
  'preload.js',
  'src/db.js',
  'license/licenseCore.js',
  'license/timeGuard.js',
];

// 고정 seed — 같은 소스 파일이면 몇 번을 다시 돌려도 항상 바이트 단위로
// 동일한 결과가 나오게 한다(재현 가능한 빌드). 값 자체는 의미 없는
// 임의의 숫자이며, 절대 바뀌면 안 되는 값도 아니다 — 바뀌어도 보안에
// 영향 없고, 단지 그 순간부터 결과물 모양만 달라질 뿐이다.
const OBFUSCATION_SEED = 892017432;

function loadObfuscator() {
  try {
    return require('javascript-obfuscator');
  } catch (e) {
    console.error('\n[obfuscate] javascript-obfuscator 패키지를 찾을 수 없습니다.');
    console.error('[obfuscate] 최초 1회, 터미널에서 아래 명령을 실행해 주세요:');
    console.error('[obfuscate]   npm install\n');
    throw e;
  }
}

// 안정성(설치/실행이 우선) > 보호 강도. 문자열/식별자 치환은 유지하고,
// 실행 크래시를 유발했던 구조 변형 옵션(selfDefending/
// controlFlowFlattening/deadCodeInjection)은 비활성화했다.
// 참고: [[iterative-round-trip-cost-feedback]] — 배포 후 재현/수정
// 사이클이 느린 프로젝트라 과도한 옵션으로 인한 회귀 위험을 최소화.
//
// 2026-07-15 5차 수정 참고: 이 3개를 끈 상태로도 동일한 크래시가
// 재현되어(SKIP_OBFUSCATION 진단 이전 시점 기준), 크래시 원인이 이
// 옵션들이 아닐 가능성이 높아짐 — 확정되면 이 주석도 갱신 예정.
function obfuscatorOptions() {
  return {
    compact: true,
    target: 'node',
    seed: OBFUSCATION_SEED,

    // 문자열(AI 프롬프트, DOM 셀렉터, 로그 메시지 등)을 배열로 추출 +
    // 인코딩 — 이 앱에서 가장 보호하고 싶은 부분(프롬프트/셀렉터)이
    // 실제로 여기서 가장 크게 보호됨. 크래시와 무관해 그대로 유지.
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    rotateStringArray: true,
    shuffleStringArray: true,
    splitStrings: true,
    splitStringsChunkLength: 8,

    // 식별자(변수/함수명) 완전 치환 — 크래시와 무관해 그대로 유지.
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,

    // 2026-07-15 3차 수정: 실행 크래시(EXC_BREAKPOINT, V8 내부)의
    // 원인으로 지목되어 전부 비활성화.
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,

    numbersToExpressions: true,
    simplify: true,

    // Electron 메인 프로세스는 최종 사용자가 브라우저 DevTools로 들여다볼
    // 일이 거의 없어 debugProtection은 득보다 예기치 못한 부작용(무한루프
    // 등) 위험이 커서 끔.
    debugProtection: false,

    // 이 앱은 writeLog()/console 출력으로 사용자 문의·오류 로그를
    // 수집하는 구조라, console 출력 자체를 죽이면 안 됨 — 유지.
    disableConsoleOutput: false,

    // 객체 키(설정값/DB row/IPC payload 등)는 구조가 중요해 보수적으로 끔.
    transformObjectKeys: false,
    // 한글 문자열이 매우 많아 유니코드 이스케이프는 용량만 늘리고 실익이
    // 적어 끔.
    unicodeEscapeSequence: false,

    sourceMap: true,
    sourceMapMode: 'separate',
  };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

// 원본 코드 + 난독화 옵션 전체를 합쳐 SHA-256 해시를 계산한다. 옵션이
// 한 글자만 바뀌어도, 원본 소스가 1바이트만 바뀌어도 이 값이 달라진다
// — "수정 시각"에 전혀 의존하지 않는다.
function computeCacheKey(code) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(obfuscatorOptions()));
  hash.update(' '); // 옵션 JSON과 소스 코드 경계 구분자
  hash.update(code);
  return hash.digest('hex');
}

// 캐시 키 파일과 결과물이 둘 다 있고, 저장된 키가 현재 계산한 키와
// 정확히 같을 때만 재사용한다. 조금이라도 다르면(옵션 변경, 소스 변경,
// 혹은 캐시 파일이 아예 없는 최초 실행) 무조건 새로 만든다.
function isUpToDate(outPath, cacheKeyPath, currentKey) {
  if (!fs.existsSync(outPath)) return false;
  if (!fs.existsSync(cacheKeyPath)) return false;
  const storedKey = fs.readFileSync(cacheKeyPath, 'utf8').trim();
  return storedKey === currentKey;
}

function obfuscateOne(JavaScriptObfuscator, relPath) {
  const srcPath = path.join(PROJECT_ROOT, relPath);
  const outPath = path.join(OUT_DIR, relPath);
  const mapPath = path.join(MAP_DIR, relPath + '.map');
  const cacheKeyPath = path.join(CACHE_DIR, relPath + '.key');

  if (!fs.existsSync(srcPath)) {
    throw new Error(`[obfuscate] 원본 파일을 찾을 수 없음: ${relPath}`);
  }

  // 2026-07-15 5차 수정: 진단 모드 — 난독화 없이 원본 그대로 복사.
  if (SKIP_OBFUSCATION) {
    ensureDir(path.dirname(outPath));
    fs.copyFileSync(srcPath, outPath);
    console.log(`[obfuscate] ${relPath}: SKIP_OBFUSCATION=1 — 원본 그대로 복사(진단용, 배포 금지)`);
    return;
  }

  const code = fs.readFileSync(srcPath, 'utf8');
  const currentKey = computeCacheKey(code);

  if (isUpToDate(outPath, cacheKeyPath, currentKey)) {
    console.log(`[obfuscate] ${relPath}: 이미 최신 상태(해시 일치) — 재사용(재생성 건너뜀)`);
    return;
  }

  const result = JavaScriptObfuscator.obfuscate(code, obfuscatorOptions());

  ensureDir(path.dirname(outPath));
  ensureDir(path.dirname(mapPath));
  ensureDir(path.dirname(cacheKeyPath));

  fs.writeFileSync(outPath, result.getObfuscatedCode(), 'utf8');
  const map = result.getSourceMap();
  if (map) {
    fs.writeFileSync(mapPath, map, 'utf8');
  }
  fs.writeFileSync(cacheKeyPath, currentKey, 'utf8');

  const beforeKb = (code.length / 1024).toFixed(1);
  const afterKb = (result.getObfuscatedCode().length / 1024).toFixed(1);
  console.log(`[obfuscate] ${relPath}: ${beforeKb}KB -> ${afterKb}KB (새로 생성)`);
}

function runObfuscation() {
  if (SKIP_OBFUSCATION) {
    console.warn('[obfuscate] ⚠️  SKIP_OBFUSCATION=1 — 진단용 모드: 원본 파일을 그대로 복사합니다(난독화 없음). 이 결과물은 절대 배포하지 마세요.');
    console.log('[obfuscate] 시작 — 대상 파일:', TARGETS.length + '개');
    ensureDir(OUT_DIR);
    ensureDir(MAP_DIR);
    for (const rel of TARGETS) {
      obfuscateOne(null, rel);
    }
    console.log('[obfuscate] 완료(진단용, 미난독화) ->', path.relative(PROJECT_ROOT, OUT_DIR));
    return;
  }

  const JavaScriptObfuscator = loadObfuscator();

  console.log('[obfuscate] 시작 — 대상 파일:', TARGETS.length + '개');
  ensureDir(OUT_DIR);
  ensureDir(MAP_DIR);
  ensureDir(CACHE_DIR);

  for (const rel of TARGETS) {
    obfuscateOne(JavaScriptObfuscator, rel);
  }

  console.log('[obfuscate] 완료 ->', path.relative(PROJECT_ROOT, OUT_DIR));
  console.log('[obfuscate] 소스맵(비공개, 배포 미포함) ->', path.relative(PROJECT_ROOT, MAP_DIR));
}

// 빌드를 처음부터 완전히 새로 하고 싶을 때(강제 재생성) 쓰는 함수.
function cleanOutputDirs() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.rmSync(MAP_DIR, { recursive: true, force: true });
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}

module.exports = { runObfuscation, cleanOutputDirs, TARGETS, OUT_DIR, MAP_DIR, CACHE_DIR };

if (require.main === module) {
  try {
    if (process.argv.includes('--clean')) {
      cleanOutputDirs();
      console.log('[obfuscate] 기존 결과물 삭제 완료 — 다시 생성합니다.');
    }
    runObfuscation();
  } catch (e) {
    console.error('[obfuscate] 실패:', e.message);
    process.exit(1);
  }
}
