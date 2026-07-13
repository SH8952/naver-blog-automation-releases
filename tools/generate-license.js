// ────────────────────────────────────────────────────────────────────────
// tools/generate-license.js
// 판매/갱신 시마다 개발자가 직접 실행해서 라이선스 키를 발급하는 도구.
//
// 사용법 예시:
//   node tools/generate-license.js --tier=premium --devices=2 --days=90 --email=buyer@example.com
//   node tools/generate-license.js --tier=standard --devices=1 --days=30 --id=KM-0001
//   node tools/generate-license.js --tier=premium --devices=1              (만료일 없음 = 영구 라이선스)
//
// 옵션:
//   --tier=standard|premium   구매 등급 (기본값 standard)
//   --devices=N               최대 사용 기기 수 (기본값 1, 참고 정보용 — 실제 강제는
//                              2026-07-13부터 추가된 HWID 첫 실행 자동 등록으로 대체)
//   --days=N                  오늘부터 N일 후 만료 (생략 시 만료일 없음 = 영구)
//   --expires=YYYY-MM-DD      만료일을 날짜로 직접 지정 (--days 대신 사용 가능)
//   --id=문자열                라이선스 번호/구매자 식별용 메모 (선택, 생략 가능)
//   --email=문자열             구매자 이메일 (2026-07-13 추가, 선택 — 기록/표시용이며
//                              검증 로직에는 영향 없음)
//
// keys/private.pem 이 있어야 동작한다(최초 1회 tools/gen-keypair.js로 생성).
// ────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { signPayload } = require('../license/licenseCore');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function todayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + Number(days));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const args = parseArgs(process.argv.slice(2));

const tier = args.tier === 'premium' ? 'premium' : 'standard';
const maxDevices = args.devices ? parseInt(args.devices, 10) : 1;
const issuedAt = todayStr();
const userEmail = args.email ? String(args.email).trim() : null;

let expiresAt = null;
if (args.expires) expiresAt = args.expires;
else if (args.days) expiresAt = addDays(issuedAt, args.days);

const licenseId = args.id || `LIC-${issuedAt.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const privPath = path.join(__dirname, '..', 'keys', 'private.pem');
if (!fs.existsSync(privPath)) {
  console.error('[오류] keys/private.pem 을 찾을 수 없습니다.');
  console.error('       먼저 node tools/gen-keypair.js 를 실행해 키페어를 생성하세요.');
  process.exit(1);
}
const privateKeyPem = fs.readFileSync(privPath, 'utf8');

const payload = { tier, maxDevices, expiresAt, issuedAt, licenseId, userEmail };
const key = signPayload(payload, privateKeyPem);

console.log('발급 내역');
console.log('  등급        :', tier === 'premium' ? '프리미엄' : '스탠다드');
console.log('  최대 기기 수:', maxDevices, '대 (참고용 — 실제 잠금은 첫 실행한 기기에 자동 적용)');
console.log('  발급일      :', issuedAt);
console.log('  만료일      :', expiresAt || '없음(영구)');
console.log('  라이선스 번호:', licenseId);
console.log('  구매자 이메일:', userEmail || '(미기재)');
console.log('');
console.log('라이선스 키 (구매자에게 전달):');
console.log(key);
