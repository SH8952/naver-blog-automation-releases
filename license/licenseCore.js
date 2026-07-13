// ────────────────────────────────────────────────────────────────────────
// license/licenseCore.js
// 오프라인 서명 기반 라이선스 키 — 생성/검증 공용 모듈 (2026-07-04 신규,
// 2026-07-13 이메일/HWID 필드 추가)
//
// 키 형식: base64url(JSON payload) + "." + base64url(Ed25519 서명)
// payload 필드: tier(등급) / maxDevices(PC 대수) / expiresAt(만료일) /
//              issuedAt(발급일) / licenseId(라이선스 번호) /
//              userEmail(구매자 이메일, 2026-07-13 추가 — 기록/표시용이며
//              검증 로직에는 관여하지 않음)
//
// 서명은 Ed25519(Node.js crypto 내장, 별도 npm 설치 불필요)를 사용한다.
// 개발자만 가진 개인키(keys/private.pem, 절대 앱에 포함되지 않음)로 서명하고,
// 앱에는 아래 공개키만 내장되어 있어 위조된 키를 만들 수 없다.
//
// 주의(현재 구현의 한계): maxDevices(PC 대수)는 키 안에 담긴 "메타데이터"일
// 뿐, 여러 대의 실제 PC에 걸쳐 사용 대수를 실시간으로 교차 검증하지는
// 않는다(순수 오프라인 구조라 서버 없이는 다른 PC의 사용 여부를 알 수 없음).
// 지금은 설정 화면에 참고 정보로 표시하는 용도로만 쓰이며, 실제 기기 수
// 제한을 강제하려면 추후 최소한의 온라인 확인(체크인 서버) 컴포넌트가
// 필요하다.
//
// 2026-07-13 추가: getHardwareId()는 이 기기의 고유 식별값을 계산한다.
// 실제 "기기 고정"(첫 실행 자동 등록 + 이후 대조)은 main.js에서
// electron-store에 활성화 기록을 저장/대조하는 방식으로 처리하며, 이
// 파일은 순수하게 서명 검증과 HWID 계산만 담당한다(관심사 분리 유지).
// ────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const os = require('os');

// 공개키 — 노출되어도 안전 (검증 전용, 위조 불가능)
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANufZ1MdOmnr2BYkhnApTqQdL1Y3W0WErKZ2oxBXifdA=
-----END PUBLIC KEY-----
`;

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function encodePayload(payload) {
  return b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
}

function decodePayload(encoded) {
  return JSON.parse(b64urlDecode(encoded).toString('utf8'));
}

// 개발자 전용 — 라이선스 발급 도구(tools/generate-license.js)에서만 사용.
// privateKeyPem은 이 함수 호출자가 직접 전달해야 하며, 이 파일 자체에는
// 개인키가 전혀 포함되어 있지 않다.
function signPayload(payload, privateKeyPem) {
  const payloadEncoded = encodePayload(payload);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payloadEncoded, 'utf8'), privateKey);
  return `${payloadEncoded}.${b64urlEncode(signature)}`;
}

// 앱(main.js)에서 사용 — 공개키만으로 검증 가능.
function verifyLicenseKey(keyString) {
  try {
    const trimmed = String(keyString || '').trim();
    if (!trimmed) return { valid: false, expired: false, reason: '라이선스 키가 비어 있음' };

    const parts = trimmed.split('.');
    if (parts.length !== 2) {
      return { valid: false, expired: false, reason: '라이선스 키 형식 오류' };
    }
    const [payloadEncoded, sigEncoded] = parts;

    const publicKey = crypto.createPublicKey(LICENSE_PUBLIC_KEY_PEM);
    const signature = b64urlDecode(sigEncoded);
    const ok = crypto.verify(null, Buffer.from(payloadEncoded, 'utf8'), publicKey, signature);
    if (!ok) {
      return { valid: false, expired: false, reason: '서명 불일치 — 위조되었거나 손상된 키' };
    }

    const payload = decodePayload(payloadEncoded);
    const tier = payload.tier === 'premium' ? 'premium' : 'standard';
    const maxDevices = Number.isFinite(payload.maxDevices) ? payload.maxDevices : 1;

    let expired = false;
    let daysRemaining = null;
    if (payload.expiresAt) {
      const exp = new Date(`${payload.expiresAt}T23:59:59`);
      const now = new Date();
      daysRemaining = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
      expired = now.getTime() > exp.getTime();
    }

    return {
      valid: !expired,
      expired,
      tier,
      maxDevices,
      expiresAt: payload.expiresAt || null,
      issuedAt: payload.issuedAt || null,
      licenseId: payload.licenseId || null,
      userEmail: payload.userEmail || null,
      daysRemaining,
      reason: expired ? '라이선스 기간 만료' : null,
    };
  } catch (e) {
    return { valid: false, expired: false, reason: '라이선스 키를 읽을 수 없음: ' + e.message };
  }
}

// 2026-07-13 신규 — 이 기기의 고유 식별값(HWID) 계산.
// hostname + platform + arch + (내부용이 아닌 첫 네트워크 인터페이스의
// MAC 주소)를 SHA-256으로 해시해 32자 hex 문자열로 만든다. 외부
// 라이브러리 없이 Node 내장 os/crypto만 사용(이 프로젝트의 기존 방침과
// 동일 — Ed25519 서명도 별도 설치 없이 Node 내장 crypto만 사용했음).
// 실패 시(권한 문제 등) 'unknown-hwid'를 반환해 앱이 죽지 않게 한다.
function getHardwareId() {
  try {
    const ifaces = os.networkInterfaces();
    let mac = '';
    outer:
    for (const name of Object.keys(ifaces || {})) {
      for (const iface of ifaces[name] || []) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          mac = iface.mac;
          break outer;
        }
      }
    }
    const raw = [os.hostname(), os.platform(), os.arch(), mac].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  } catch (e) {
    return 'unknown-hwid';
  }
}

module.exports = {
  b64urlEncode,
  b64urlDecode,
  encodePayload,
  decodePayload,
  signPayload,
  verifyLicenseKey,
  getHardwareId,
};
