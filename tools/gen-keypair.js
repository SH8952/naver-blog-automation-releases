// ────────────────────────────────────────────────────────────────────────
// tools/gen-keypair.js
// 라이선스 서명용 Ed25519 키페어를 1회 생성하는 개발자 전용 도구.
//
// 사용법: node tools/gen-keypair.js
//
// 결과:
//   keys/private.pem  — 라이선스 발급(서명)에 사용하는 개인키.
//                        [!] 앱에는 절대 포함되지 않으며, 외부에 유출되면
//                        안 됨. 안전한 곳에 별도 백업 권장(예: 개인 클라우드
//                        드라이브 비공개 폴더, 오프라인 저장 매체 등).
//   keys/public.pem   — 검증용 공개키(참고용 사본). license/licenseCore.js
//                        안에도 문자열로 이미 박혀 있어 앱 실행 시 이 파일을
//                        따로 읽지는 않음.
//
// 이미 keys/private.pem이 존재하면 실수로 덮어쓰지 않도록 중단한다.
// 새 키를 발급하면 기존에 발급된 모든 라이선스 키가 무효가 되므로 주의.
// ────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const keysDir = path.join(__dirname, '..', 'keys');
const privPath = path.join(keysDir, 'private.pem');
const pubPath = path.join(keysDir, 'public.pem');

if (fs.existsSync(privPath)) {
  console.error('[중단] keys/private.pem 이 이미 존재합니다.');
  console.error('       새로 생성하면 기존에 발급한 모든 라이선스 키가 무효화됩니다.');
  console.error('       정말 새로 만들려면 keys/private.pem 을 먼저 직접 삭제한 뒤 다시 실행하세요.');
  process.exit(1);
}

fs.mkdirSync(keysDir, { recursive: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

fs.writeFileSync(privPath, privPem, { mode: 0o600 });
fs.writeFileSync(pubPath, pubPem);

console.log('✓ 키페어 생성 완료');
console.log('  개인키: ' + privPath + '  (절대 공유/커밋 금지)');
console.log('  공개키: ' + pubPath);
console.log('');
console.log('다음 단계: 아래 공개키 내용을 license/licenseCore.js의');
console.log('LICENSE_PUBLIC_KEY_PEM 상수에 붙여넣어 앱에 반영하세요.');
console.log('(이미 최초 1회 반영되어 있다면 다시 할 필요 없음)');
console.log('');
console.log(pubPem);
