// ────────────────────────────────────────────────────────────────────────
// tools/generate-license-ui.js (2026-07-13 신규)
// 라이선스 키 생성기의 웹 폼 버전. 터미널에서 플래그를 직접 입력해야
// 하는 tools/generate-license.js 대신, 브라우저에서 폼에 값만 채우면
// 키가 만들어진다.
//
// 사용법: 프로젝트 루트에서 "라이선스 발급.command"를 더블클릭하거나
//         node tools/generate-license-ui.js 를 직접 실행.
//         자동으로 기본 브라우저가 열리며, 서버는 로컬(127.0.0.1)에서만
//         돌기 때문에 외부에서 접근할 수 없다. 창을 닫아도 서버가 계속
//         떠 있으니, 다 쓰면 터미널에서 Ctrl+C로 종료할 것.
//
// 기능:
//   1) 발급 폼 — 등급/기기수/기간/이메일/메모를 입력해 서명된 키 생성
//   2) 발급 이력 — keys/license-ledger.json에 누적 기록(이메일 등 개인정보
//      포함되므로 .gitignore의 keys/ 규칙에 따라 절대 커밋되지 않음)
//   3) 키 조회 — 이미 만든 키를 붙여넣으면 서명 검증 후 내용을 그대로
//      보여줌(등급/만료일/이메일/라이선스번호 등). 단, 이 조회는 키
//      "안에 서명된 값"만 보여주는 것이고, 구매자가 실제로 몇 대의 PC에
//      활성화했는지는 구매자 PC의 로컬 저장소에만 있어 여기서는 알 수
//      없음 — 원격/실시간 피드백은 별도 논의 후 추가 예정(2026-07-13,
//      구글시트/파이어베이스 중 미정, license-hardening 메모리 참고).
//
// 외부 라이브러리 없이 Node 내장 http/fs/path/child_process만 사용.
// ────────────────────────────────────────────────────────────────────────

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { signPayload, verifyLicenseKey } = require('../license/licenseCore');

const PORT = 47100;
const ROOT = path.join(__dirname, '..');
const PRIV_PATH = path.join(ROOT, 'keys', 'private.pem');
const LEDGER_PATH = path.join(ROOT, 'keys', 'license-ledger.json');

// ── Firebase 원격 발급 이력 (2026-07-14 신규) ────────────────────
// main.js의 firebasePush()와 동일한 목적(Realtime Database REST API에
// 직접 POST)이지만, 이 파일은 의도적으로 main.js를 import하지 않고 완전히
// 독립적으로 둔다 — 개인키(keys/private.pem)를 다루는 발급 도구는 고객에게
// 나가는 앱 코드와 절대 같은 파일/모듈 그래프를 공유하지 않는다는 원칙
// (2026-07-14 보안 설계 논의로 확정). Node 내장 https 모듈만 사용.
const FIREBASE_DB_URL = 'https://naver-blog-automation-4d9d6-default-rtdb.asia-southeast1.firebasedatabase.app';

function formatKoreanTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 실패해도(오프라인 등) 발급 자체는 계속 진행돼야 하므로 절대 throw하지
// 않고, 호출부에서도 await하지 않는다(fire-and-forget).
// method 파라미터 추가(2026-07-20) — 'POST'(자동생성 키로 계속 추가) 또는
// 'PUT'(지정한 경로에 그대로 저장/덮어쓰기, 라이선스ID를 키로 써서 라이선스
// 발급 기록을 저장할 때 씀). new URL()로 감싸므로 한글 경로도 자동으로
// 퍼센트 인코딩된다.
function firebasePush(pathSeg, data, method = 'POST') {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(data);
      const url = new URL(`${FIREBASE_DB_URL}/${pathSeg}.json`);
      const req = https.request(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ success: res.statusCode >= 200 && res.statusCode < 300 }));
      });
      req.on('error', () => resolve({ success: false }));
      req.write(body);
      req.end();
    } catch {
      resolve({ success: false });
    }
  });
}

function sanitizeFirebaseKey(str) {
  return String(str || '').replace(/[.#$[\]/]/g, '_');
}

// ── 원격 차단(2026-07-14 신규) — 관리자 인증 ─────────────────────
// /차단목록 쓰기는 파이어베이스 보안 규칙에서 "로그인한 관리자 계정만" 되도록
// 걸어둘 예정(레거시 database secret은 구글이 지원 중단해서 안 씀). 이 파일이
// Firebase Authentication(이메일/비밀번호)으로 직접 로그인해 idToken을 받고,
// 그 토큰을 REST 요청의 ?auth= 파라미터로 실어 보낸다. 자격증명은
// keys/firebase-admin.json에 저장(keys/ 전체가 .gitignore 대상이라 커밋 안 됨,
// keys/private.pem과 동일한 보호 수준).
const FIREBASE_API_KEY = 'AIzaSyAYzBZbRmmHuV8y-k6qXG-KZTiD3_-khvU';
const ADMIN_CRED_PATH = path.join(ROOT, 'keys', 'firebase-admin.json');

function identityToolkitRequest(endpoint, body) {
  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({ ...body, returnSecureToken: true });
      const url = new URL(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FIREBASE_API_KEY}`);
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let respBody = '';
        res.on('data', (chunk) => { respBody += chunk.toString(); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(respBody);
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ success: true, ...parsed });
            else resolve({ success: false, error: parsed?.error?.message || `HTTP ${res.statusCode}` });
          } catch {
            resolve({ success: false, error: '응답 파싱 실패' });
          }
        });
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.write(payload);
      req.end();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

function readAdminCred() {
  try {
    if (!fs.existsSync(ADMIN_CRED_PATH)) return null;
    return JSON.parse(fs.readFileSync(ADMIN_CRED_PATH, 'utf8'));
  } catch { return null; }
}

// 로그인 감사 기록(2026-07-20 신규) — 이 관리자 계정으로 인증이 성공할
// 때마다(계정 생성/명시적 로그인/이후 모든 관리 액션에서의 재인증 포함)
// "이 기기에서 이 계정이 쓰였다"는 기록을 파이어베이스에 남긴다. Firebase
// Auth 자체는 구글 계정처럼 "현재 로그인된 기기 목록" 조회 API를 제공하지
// 않아서(관리자 SDK로도 불가, 세션 전체 무효화만 가능) 이 로그가 사실상
// 유일한 "누가/어느 기기에서 이 계정을 썼는지" 확인 수단이다. 실패해도
// 절대 throw하지 않는 fire-and-forget — 로그 기록 실패가 실제 관리
// 작업을 막으면 안 됨.
function logAdminSession(uid, idToken, actionLabel) {
  try {
    const key = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    firebasePutAuthed(`관리자로그인기록/${sanitizeFirebaseKey(uid)}/${key}`, {
      '시각': formatKoreanTimestamp(),
      '기기명': os.hostname(),
      '플랫폼': process.platform,
      '작업': actionLabel || '-',
    }, idToken);
  } catch { /* 무시 */ }
}

async function setupAdmin(email, password) {
  const res = await identityToolkitRequest('signUp', { email, password });
  if (!res.success) return res;
  fs.mkdirSync(path.dirname(ADMIN_CRED_PATH), { recursive: true });
  fs.writeFileSync(ADMIN_CRED_PATH, JSON.stringify({ email, password }, null, 2), 'utf8');
  logAdminSession(res.localId, res.idToken, '계정 생성(최초 로그인)');
  return { success: true, uid: res.localId };
}

// 이미 만든 계정으로 로그인만(signUp 아님) — 2026-07-20 신규.
async function loginAdmin(email, password) {
  const res = await identityToolkitRequest('signInWithPassword', { email, password });
  if (!res.success) return res;
  fs.mkdirSync(path.dirname(ADMIN_CRED_PATH), { recursive: true });
  fs.writeFileSync(ADMIN_CRED_PATH, JSON.stringify({ email, password }, null, 2), 'utf8');
  logAdminSession(res.localId, res.idToken, '로그인');
  return { success: true, uid: res.localId };
}

// 매번 새로 로그인(짧은 세션 도구라 리프레시 토큰 관리는 생략, 관리자 액션
// 빈도가 낮아 매번 로그인해도 비용이 크지 않음). actionLabel을 넘기면 이
// 인증이 어떤 작업 때문이었는지까지 로그인 기록에 남는다 — 만약 이 계정
// 정보를 모르는 사람/기기가 도구를 실행해 라이선스를 차단 해제하거나
// 기기를 조회/해제하려 시도해도, 그 순간 자동으로 기록이 남는다는 뜻.
async function getAdminIdToken(actionLabel) {
  const cred = readAdminCred();
  if (!cred) return { success: false, error: '관리자 계정이 설정되지 않았습니다.' };
  const res = await identityToolkitRequest('signInWithPassword', { email: cred.email, password: cred.password });
  if (!res.success) return res;
  logAdminSession(res.localId, res.idToken, actionLabel);
  return { success: true, idToken: res.idToken, uid: res.localId };
}

// 로그인 기록 조회 — 이 계정 uid 하위 전체 기록을 최신순으로.
async function getAdminLoginLogs() {
  const auth = await getAdminIdToken('로그인 기록 조회');
  if (!auth.success) return auth;
  const res = await firebaseGetAuthed(`관리자로그인기록/${sanitizeFirebaseKey(auth.uid)}`, auth.idToken);
  if (!res.success) return res;
  const raw = res.data || {};
  const list = Object.keys(raw).map(k => raw[k]).sort((a, b) => String(b['시각'] || '').localeCompare(String(a['시각'] || '')));
  return { success: true, list };
}

// 원격(파이어베이스) 발급 이력 조회 — 2026-07-20 신규. 로컬
// keys/license-ledger.json은 기기마다 따로 있어서 다른 기기(예: 윈도우
// 데스크탑)에서 발급한 이력은 이 파일에 안 남는다. 반면 handleGenerate()는
// 발급마다 항상 라이선스발급/{라이선스ID}에도 fire-and-forget으로 같은
// 내용을 올려두므로, 그 경로를 읽으면 기기에 상관없이 전체 발급 이력을
// 볼 수 있다. 프론트에서 이 목록과 로컬 목록을 라이선스ID 기준으로
// 비교해 "로컬에 없는 것"만 따로 보여주는 데 쓴다(로컬 표 자체를 이걸로
// 대체하지는 않음 — 로컬 "삭제" 버튼의 기존 동작을 그대로 유지하기 위함).
// 2026-07-20 — licenses가 라이선스ID를 키로 쓰는 라이선스발급으로 바뀌면서
// Object.keys(raw)의 키 자체가 곧 라이선스ID다(예전엔 의미 없는 자동생성
// push 키였음). 각 레코드 하위에는 main.js가 쓰는 기기활성화 서브트리도
// 같이 딸려오지만 여기서는 안 쓰므로 무시된다.
async function getRemoteLicenses() {
  const auth = await getAdminIdToken('발급 이력(원격) 조회');
  if (!auth.success) return auth;
  const res = await firebaseGetAuthed('라이선스발급', auth.idToken);
  if (!res.success) return res;
  const raw = res.data || {};
  const list = Object.keys(raw).map((licenseId) => {
    const r = raw[licenseId] || {};
    return {
      licenseId,
      tier: r['등급'] || 'standard',
      maxDevices: r['기기수'] || 1,
      issuedAt: r['발급일'] || '-',
      expiresAt: r['만료일'] === '무제한' ? null : (r['만료일'] || null),
      userEmail: r['이메일'] || null,
      channel: r['판매채널'] || null,
      orderId: r['주문번호'] || null,
      note: r['메모'] || null,
    };
  });
  return { success: true, list };
}

// 비밀번호 변경 = 사실상 "전체 기기 로그아웃"(2026-07-20 신규). 이 도구는
// 리프레시 토큰을 저장해두지 않고 매 작업마다 signInWithPassword로 새로
// 인증하므로, 비밀번호를 바꾸면 예전 비밀번호를 알고 있는 다른 기기는
// 바로 다음 인증 시도부터 곧장 거부된다 — 별도의 "세션 무효화" API 없이도
// 이 도구의 사용 패턴상 즉시 로그아웃과 동일한 효과를 낸다. 변경 후
// 로컬 자격증명 파일도 새 비밀번호로 갱신해서, 이 기기의 이 도구는
// 계속 정상 동작하게 한다.
async function changeAdminPassword(newPassword) {
  const auth = await getAdminIdToken('비밀번호 변경(전체 기기 로그아웃)');
  if (!auth.success) return auth;
  const res = await identityToolkitRequest('update', { idToken: auth.idToken, password: newPassword });
  if (!res.success) return res;
  const cred = readAdminCred();
  fs.mkdirSync(path.dirname(ADMIN_CRED_PATH), { recursive: true });
  fs.writeFileSync(ADMIN_CRED_PATH, JSON.stringify({ email: cred.email, password: newPassword }, null, 2), 'utf8');
  return { success: true };
}

// /차단목록 쓰기 — 관리자 idToken 필요.
function firebasePutAuthed(pathSeg, data, idToken) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(data);
      const url = new URL(`${FIREBASE_DB_URL}/${pathSeg}.json?auth=${idToken}`);
      const req = https.request(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let respBody = '';
        res.on('data', (chunk) => { respBody += chunk.toString(); });
        res.on('end', () => {
          resolve({ success: res.statusCode >= 200 && res.statusCode < 300, error: res.statusCode >= 300 ? respBody.slice(0, 200) : undefined });
        });
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.write(body);
      req.end();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

async function setLicenseBlocked(licenseId, blockedFlag, reasonText) {
  const auth = await getAdminIdToken(blockedFlag ? '라이선스 차단' : '라이선스 차단 해제');
  if (!auth.success) return auth;
  return firebasePutAuthed(`차단목록/${sanitizeFirebaseKey(licenseId)}`, {
    '차단': !!blockedFlag,
    '사유': reasonText ? String(reasonText).slice(0, 500) : null,
    '처리시각': formatKoreanTimestamp(),
  }, auth.idToken);
}

// GET/DELETE with 인증 — 라이선스발급 하위 기기활성화는 구매자 이메일 등 개인정보가 섞여
// 있어 /blocked처럼 공개 읽기로 열어두지 않고 관리자 idToken이 있어야만
// 읽고/지울 수 있게 한다(파이어베이스 보안 규칙에서 별도 적용 필요).
function firebaseGetAuthed(pathSeg, idToken) {
  return new Promise((resolve) => {
    try {
      const url = new URL(`${FIREBASE_DB_URL}/${pathSeg}.json?auth=${idToken}`);
      https.get(url, (res) => {
        let respBody = '';
        res.on('data', (chunk) => { respBody += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return resolve({ success: false, error: respBody.slice(0, 200) });
          }
          try {
            resolve({ success: true, data: JSON.parse(respBody) });
          } catch {
            resolve({ success: false, error: '응답 파싱 실패' });
          }
        });
      }).on('error', (err) => resolve({ success: false, error: err.message }));
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

function firebaseDeleteAuthed(pathSeg, idToken) {
  return new Promise((resolve) => {
    try {
      const url = new URL(`${FIREBASE_DB_URL}/${pathSeg}.json?auth=${idToken}`);
      const req = https.request(url, { method: 'DELETE' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ success: res.statusCode >= 200 && res.statusCode < 300 }));
      });
      req.on('error', (err) => resolve({ success: false, error: err.message }));
      req.end();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// 라이선스 1건에 등록된 기기(hwid) 목록 조회 — main.js의 getLicenseStatus()가
// 최초활성화/신규기기등록 시 라이선스발급/{licenseId}/기기활성화/{hwid}에 기록해두는
// 데이터를 그대로 읽는다(코드 자체는 건드리지 않음, 읽기 전용 조회).
async function getLicenseDevices(licenseId) {
  const auth = await getAdminIdToken('구매자 기기 조회');
  if (!auth.success) return auth;
  const res = await firebaseGetAuthed(`라이선스발급/${sanitizeFirebaseKey(licenseId)}/기기활성화`, auth.idToken);
  if (!res.success) return res;
  const raw = res.data || {};
  const list = Object.keys(raw).map(hwidKey => ({ hwidKey, ...raw[hwidKey] }));
  return { success: true, list };
}

// 기기 등록 해제 — 고객이 PC를 교체했는데 maxDevices 자리가 꽉 찬 경우,
// 예전 기기의 원격 기록만 지운다. 실제 자리 회수는 고객이 새 PC에서
// 재활성화할 때 로컬 store(settings._licenseActivation)가 비어있어
// 자동으로 새 자리로 등록되는 기존 로직을 그대로 타는 것이며, 이 삭제
// 자체는 관리자용 기록 정리 목적이다.
async function releaseDevice(licenseId, hwidKey) {
  const auth = await getAdminIdToken('구매자 기기 해제');
  if (!auth.success) return auth;
  return firebaseDeleteAuthed(`라이선스발급/${sanitizeFirebaseKey(licenseId)}/기기활성화/${hwidKey}`, auth.idToken);
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

function readLedger() {
  try {
    if (!fs.existsSync(LEDGER_PATH)) return [];
    const raw = fs.readFileSync(LEDGER_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function appendLedger(record) {
  const list = readLedger();
  list.unshift(record); // 최신이 위로
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// 2026-07-14 신규 — 발급 이력 전체 초기화(테스트로 발급한 라이선스 등
// 불필요한 기록을 지우기 위함). 파일 자체를 지우지 않고 빈 배열로
// 덮어써서, 파일이 아예 없어져 이후 읽기 로직에 영향 주는 일이 없게 함.
function clearLedger() {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify([], null, 2), 'utf8');
}

// 2026-07-14 신규 — 로컬 발급 이력에서 항목 1개만 삭제. 파이어베이스 /licenses
// 기록과 서명된 라이선스 키 자체(구매자가 이미 받은 키)는 건드리지 않음 —
// 키를 실제로 무효화하려면 "차단" 버튼을 별도로 눌러야 함(사용자 확정 사항,
// 2026-07-14). licenseId가 우연히 중복돼 있으면(자유 텍스트 입력이라 가능)
// 전부 지움 — 로컬 이력 정리용이라 문제 없음.
function deleteLedgerEntry(licenseId) {
  const list = readLedger();
  const filtered = list.filter(rec => rec.licenseId !== licenseId);
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(filtered, null, 2), 'utf8');
  return { removed: list.length - filtered.length };
}

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // 1MB 넘으면 방어적으로 끊음
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function handleGenerate(body) {
  if (!fs.existsSync(PRIV_PATH)) {
    return { success: false, error: 'keys/private.pem 을 찾을 수 없습니다. 먼저 node tools/gen-keypair.js 를 실행해 키페어를 생성하세요.' };
  }
  const tier = body.tier === 'premium' ? 'premium' : 'standard';
  const maxDevices = Math.max(1, parseInt(body.devices, 10) || 1);
  const issuedAt = todayStr();
  const userEmail = body.email ? String(body.email).trim() : null;
  const note = body.note ? String(body.note).trim() : null;
  // 2026-07-14 신규 — 메모 자유텍스트에서 분리한 구조화 필드(콘솔에서
  // 채널/주문번호로 필터링하기 쉽게).
  const channel = body.channel ? String(body.channel).trim() : null;
  const orderId = body.orderId ? String(body.orderId).trim() : null;

  let expiresAt = null;
  if (body.expiryMode === 'days' && body.days) {
    expiresAt = addDays(issuedAt, parseInt(body.days, 10) || 0);
  } else if (body.expiryMode === 'date' && body.expires) {
    expiresAt = body.expires;
  }
  // expiryMode === 'perpetual'이면 expiresAt은 null(무제한)로 유지

  const licenseId = (body.id && String(body.id).trim())
    || `LIC-${issuedAt.replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const privateKeyPem = fs.readFileSync(PRIV_PATH, 'utf8');
  const payload = { tier, maxDevices, expiresAt, issuedAt, licenseId, userEmail };
  const key = signPayload(payload, privateKeyPem);

  appendLedger({
    licenseId, tier, maxDevices, issuedAt, expiresAt, userEmail, note, channel, orderId,
    createdAt: new Date().toISOString(),
  });

  // 2026-07-14 신규 — 발급 즉시 파이어베이스에도 자동 전송(fire-and-forget).
  // 테스트로 만든 키도 그대로 전송되므로, 테스트 발급분은 콘솔에서 직접
  // 지워야 함(자동 구분 로직 없음 — 의도적으로 단순하게 유지).
  // 2026-07-20 — 자동생성 키(push) 대신 라이선스ID를 키로 써서 PUT으로
  // 저장(라이선스ID는 항상 고유하므로 충돌 없음). 이렇게 하면 main.js가
  // 기기 활성화 시 쓰는 `라이선스발급/{라이선스ID}/기기활성화/{기기ID}`가
  // 이 레코드 바로 하위에 자연스럽게 붙는다 — 어떤 라이선스에 누가
  // 활성화했는지 한 경로에서 바로 확인 가능.
  firebasePush(`라이선스발급/${sanitizeFirebaseKey(licenseId)}`, {
    '시각': formatKoreanTimestamp(),
    '라이선스ID': licenseId,
    '라이선스키': key,
    '등급': tier,
    '기기수': maxDevices,
    '발급일': issuedAt,
    '만료일': expiresAt || '무제한',
    '이메일': userEmail,
    '판매채널': channel,
    '주문번호': orderId,
    '메모': note,
  }, 'PUT');

  return { success: true, key, payload };
}

function handleVerify(body) {
  const key = String(body.key || '').trim();
  if (!key) return { success: false, error: '키를 입력하세요.' };
  const result = verifyLicenseKey(key);
  return { success: true, result };
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execFile(cmd, [url], { shell: platform === 'win32' }, () => {});
  } catch (e) {
    // 자동으로 못 열어도 콘솔에 URL이 남아있으니 무시하고 계속 진행
  }
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>라이선스 키 생성기</title>
<style>
  :root {
    --bg-base: #0f1117; --bg-surface: #1a1d27; --bg-elevated: #22263a;
    --border: #2e3348; --text-primary: #f0f2ff; --text-secondary: #9ba3c2;
    --text-muted: #5a6180; --accent: #5b6ef5; --success: #34d399;
    --danger: #f87171; --warning: #fbbf24;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px; background: var(--bg-base); color: var(--text-primary);
    font-family: -apple-system, 'Apple SD Gothic Neo', BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .page-wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: var(--text-secondary); font-size: 12px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1100px; }
  .card {
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px;
  }
  .card h2 { font-size: 14px; margin: 0 0 16px; }
  label { display: block; font-size: 12px; color: var(--text-secondary); margin: 12px 0 6px; }
  label:first-of-type { margin-top: 0; }
  input, select, textarea {
    width: 100%; background: var(--bg-elevated); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text-primary); padding: 9px 10px; font-size: 13px;
    font-family: inherit;
  }
  /* label:first-of-type은 부모 요소마다 각각 적용되는 선택자라, .row 안의
     div들처럼 label이 1개뿐인 컨테이너에서는 그 label의 margin-top이 전부
     0으로 리셋되어버림 — 이게 바로 "등급"/"기간" select 바로 아래 필드가
     너무 붙어 보이던 원인. label 여백을 건드리는 대신 컨테이너 자체에
     여백을 줘서 이 리셋과 충돌하지 않게 함. */
  .row { display: flex; gap: 10px; margin-top: 16px; }
  .row > div { flex: 1; }
  #f-days-row, #f-date-row { margin-top: 16px; }
  button {
    margin-top: 18px; width: 100%; background: var(--accent); border: none;
    border-radius: 8px; color: white; padding: 11px; font-size: 13px; font-weight: 600;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
  button.secondary { background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-primary); }
  .result {
    margin-top: 16px; padding: 12px; background: var(--bg-elevated); border-radius: 8px;
    font-size: 12px; word-break: break-all; display: none; line-height: 1.6;
  }
  .result.show { display: block; }
  .result .key-value { color: var(--success); font-family: monospace; margin-top: 6px; }
  .result.error .key-value { color: var(--danger); }
  .copy-btn { margin-top: 8px; width: auto; padding: 6px 12px; font-size: 11px; }
  .delete-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); margin-left: 4px; }
  .delete-btn:hover { border-color: var(--danger); color: var(--danger); background: transparent; opacity: 1; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--border); }
  th { color: var(--text-muted); font-weight: 500; }
  .badge { padding: 2px 7px; border-radius: 20px; font-size: 11px; }
  .badge-premium { background: rgba(91,110,245,0.15); color: var(--accent); }
  .badge-standard { background: var(--bg-elevated); color: var(--text-secondary); }
  .empty { color: var(--text-muted); font-size: 12px; padding: 12px 0; }
  .history-card { max-width: 1100px; margin-top: 20px; }
  .warn-banner {
    max-width: 1100px; background: rgba(251,191,36,0.1); border: 1px solid var(--warning);
    color: var(--warning); border-radius: 8px; padding: 10px 14px; font-size: 12px;
    margin-bottom: 20px; display: none;
  }
  .warn-banner.show { display: block; }
  .reset-row { display: flex; justify-content: flex-end; margin-top: 24px; }
  .reset-btn {
    width: auto; margin-top: 0; padding: 6px 12px; font-size: 11px;
    background: transparent; border: 1px solid var(--border); color: var(--text-muted);
    font-weight: 500;
  }
  .reset-btn:hover { border-color: var(--danger); color: var(--danger); background: transparent; opacity: 1; }
  .link-btn {
    background: none; border: none; color: var(--accent); font-size: 12px;
    padding: 0; width: auto; margin: 10px 0 0; text-decoration: underline; cursor: pointer;
  }
  .link-btn:hover { opacity: 0.8; }
  .modal-backdrop {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    align-items: center; justify-content: center; z-index: 50;
  }
  .modal-backdrop.show { display: flex; }
  .modal-box {
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px; width: 480px; max-height: 70vh; overflow-y: auto;
  }
  .modal-box h3 { font-size: 14px; margin: 0 0 4px; }
  .modal-box .sub { margin-bottom: 14px; }
  .device-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12px;
  }
  .device-row:last-child { border-bottom: none; }
  .device-row .meta { color: var(--text-secondary); line-height: 1.6; }
  .device-row .meta b { color: var(--text-primary); }
  .modal-close-row { display: flex; justify-content: flex-end; margin-top: 14px; }
  .modal-close-row button { width: auto; margin-top: 0; padding: 7px 14px; }
  #adminLogBox { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  #adminLogBox::-webkit-scrollbar { width: 8px; }
  #adminLogBox::-webkit-scrollbar-track { background: transparent; }
  #adminLogBox::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  #adminLogBox::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
</style>
</head>
<body>
  <div class="page-wrap">
  <h1>🔑 라이선스 키 생성기</h1>
  <p class="sub">네이버 블로그 자동화 — 로컬 전용 오프라인 발급 도구 (외부 전송 없음)</p>
  <div id="privKeyWarn" class="warn-banner">keys/private.pem 을 찾을 수 없습니다. 먼저 <code>node tools/gen-keypair.js</code> 를 실행해 키페어를 생성하세요.</div>

  <div class="grid">
    <div class="card">
      <h2>새 라이선스 발급</h2>
      <label>등급</label>
      <select id="f-tier">
        <option value="standard">스탠다드</option>
        <option value="premium">프리미엄</option>
      </select>

      <div class="row">
        <div>
          <label>최대 기기 수</label>
          <input type="number" id="f-devices" value="1" min="1" />
        </div>
        <div>
          <label>라이선스 번호 (비워두면 자동생성)</label>
          <input type="text" id="f-id" placeholder="예: KM-0001" />
        </div>
      </div>

      <label>기간</label>
      <select id="f-expiryMode">
        <option value="days">오늘부터 N일 후 만료</option>
        <option value="date">날짜 직접 지정</option>
        <option value="perpetual">무제한(영구)</option>
      </select>
      <div id="f-days-row">
        <label>일수</label>
        <input type="number" id="f-days" value="30" min="1" />
      </div>
      <div id="f-date-row" style="display:none">
        <label>만료일</label>
        <input type="date" id="f-expires" />
      </div>

      <label>구매자 이메일 (선택)</label>
      <input type="email" id="f-email" placeholder="buyer@example.com" />

      <div class="row">
        <div>
          <label>판매채널 (선택)</label>
          <select id="f-channel">
            <option value="">(미지정)</option>
            <option value="크몽">크몽</option>
            <option value="직접판매">직접판매</option>
            <option value="기타">기타</option>
          </select>
        </div>
        <div>
          <label>주문번호 (선택)</label>
          <input type="text" id="f-orderId" placeholder="예: 12345" />
        </div>
      </div>

      <label>메모 (선택, 발급 이력에만 표시)</label>
      <input type="text" id="f-note" placeholder="추가로 남길 내용" />

      <button onclick="generate()">라이선스 키 생성</button>
      <div id="genResult" class="result"></div>
    </div>

    <div class="card">
      <h2>키 조회</h2>
      <label>확인할 라이선스 키</label>
      <textarea id="v-key" rows="4" placeholder="발급된 키를 붙여넣으세요"></textarea>
      <button class="secondary" onclick="verify()">조회</button>
      <div id="verifyResult" class="result"></div>

      <div class="reset-row">
        <button class="reset-btn" onclick="resetLedger()">발급 이력 초기화</button>
      </div>
    </div>
  </div>

  <div class="card history-card" id="adminCard">
    <h2>관리자 계정 (원격 차단용, 2026-07-14 신규)</h2>
    <div id="adminSetupBox">
      <p class="sub" style="margin-bottom:12px">특정 라이선스를 원격으로 차단(환불/부정사용 대응)하려면, 이 계정으로 파이어베이스에 로그인해서 처리합니다. 최초 1회만 설정하면 됩니다.</p>
      <div class="row">
        <div>
          <label>관리자 이메일</label>
          <input type="email" id="admin-email" placeholder="본인 이메일" />
        </div>
        <div>
          <label>비밀번호 (6자 이상)</label>
          <input type="password" id="admin-password" placeholder="새로 정할 비밀번호" />
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div><button class="secondary" style="width:100%" onclick="setupAdmin()">관리자 계정 만들기</button></div>
        <div><button class="secondary" style="width:100%" onclick="loginAdmin()">이미 만든 계정으로 로그인</button></div>
      </div>
      <p class="sub" style="margin:6px 0 0">다른 PC에서 이 도구를 새로 켰거나 keys/firebase-admin.json이 사라진 경우, 위에 기존 이메일/비밀번호를 입력하고 "로그인"을 누르면 다시 연결됩니다.</p>
      <div id="adminSetupResult" class="result"></div>
    </div>
    <div id="adminReadyBox" style="display:none">
      <div style="display:flex;gap:20px">
        <div style="flex:1">
          <p class="sub">관리자 계정: <b id="adminEmailLabel"></b><br/>아래 발급 이력에서 "차단"으로 라이선스를 막고, "기기 관리"로 등록된 기기를 확인/해제할 수 있습니다.</p>
          <div style="margin-top:14px">
            <label style="margin-bottom:6px">비밀번호 변경</label>
            <div style="display:flex;gap:8px">
              <input type="password" id="admin-newpw" placeholder="새 비밀번호" style="width:160px" />
              <button class="secondary" style="width:auto;margin-top:0;padding:9px 16px" onclick="changeAdminPasswordUI()">전체 로그아웃</button>
            </div>
            <div id="changePwResult" class="result"></div>
          </div>
        </div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="font-size:13px;margin:0">로그인 기록</h3>
            <button class="copy-btn" style="margin-top:0" onclick="loadAdminLogs()">새로고침</button>
          </div>
          <p class="sub" style="margin:4px 0 8px">인증마다 자동 기록됩니다. 모르는 기기가 보이면 비밀번호를 변경하세요.</p>
          <div id="adminLogBox" style="max-height:280px;overflow-y:auto"><div class="empty">불러오는 중…</div></div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="deviceModal">
    <div class="modal-box">
      <h3 id="deviceModalTitle">기기 관리</h3>
      <p class="sub">이 라이선스에서 등록된 기기 목록입니다. "해제"를 누르면 원격 기록만 지워지며, 고객이 새 PC에서 재활성화하면 그 자리에 새로 등록됩니다.</p>
      <div id="deviceModalBody"><div class="empty">불러오는 중…</div></div>
      <div class="modal-close-row"><button class="secondary" onclick="closeDeviceModal()">닫기</button></div>
    </div>
  </div>

  <div class="card history-card">
    <h2>발급 이력 (로컬 기록, keys/license-ledger.json)</h2>
    <div id="historyBox"><div class="empty">불러오는 중…</div></div>
  </div>

  <div class="card history-card">
    <h2>로컬 미보유</h2>
    <p class="sub" style="margin:-6px 0 10px">다른 기기에서 발급했거나 이 기기 로컬 기록에서 삭제된 항목 — 파이어베이스엔 있지만 위 로컬 표엔 없는 라이선스입니다.</p>
    <div id="remoteOnlyBox"><div class="empty">불러오는 중…</div></div>
  </div>
  </div>

<script>
  const expiryModeEl = document.getElementById('f-expiryMode');
  expiryModeEl.addEventListener('change', () => {
    const mode = expiryModeEl.value;
    document.getElementById('f-days-row').style.display = mode === 'days' ? 'block' : 'none';
    document.getElementById('f-date-row').style.display = mode === 'date' ? 'block' : 'none';
  });

  async function generate() {
    const body = {
      tier: document.getElementById('f-tier').value,
      devices: document.getElementById('f-devices').value,
      id: document.getElementById('f-id').value,
      expiryMode: document.getElementById('f-expiryMode').value,
      days: document.getElementById('f-days').value,
      expires: document.getElementById('f-expires').value,
      email: document.getElementById('f-email').value,
      channel: document.getElementById('f-channel').value,
      orderId: document.getElementById('f-orderId').value,
      note: document.getElementById('f-note').value,
    };
    const res = await fetch('/api/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await res.json();
    const box = document.getElementById('genResult');
    box.classList.add('show');
    if (data.success) {
      box.classList.remove('error');
      box.innerHTML = '등급: ' + (data.payload.tier === 'premium' ? '프리미엄' : '스탠다드') +
        ' · 최대 ' + data.payload.maxDevices + '대 · 만료: ' + (data.payload.expiresAt || '무제한') +
        ' · 번호: ' + data.payload.licenseId +
        '<div class="key-value">' + data.key + '</div>' +
        '<button class="copy-btn" onclick="copyKey(this, \\'' + data.key + '\\')">키 복사</button>';
      loadHistory();
    } else {
      box.classList.add('error');
      box.textContent = data.error || '생성에 실패했습니다.';
    }
  }

  function copyKey(btn, key) {
    navigator.clipboard.writeText(key).then(() => {
      btn.textContent = '복사됨!';
      setTimeout(() => { btn.textContent = '키 복사'; }, 1500);
    });
  }

  async function verify() {
    const key = document.getElementById('v-key').value;
    const res = await fetch('/api/verify', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key }) });
    const data = await res.json();
    const box = document.getElementById('verifyResult');
    box.classList.add('show');
    if (!data.success) {
      box.classList.add('error');
      box.textContent = data.error || '조회에 실패했습니다.';
      return;
    }
    const r = data.result;
    if (!r.valid && !r.expired) {
      box.classList.add('error');
      box.textContent = r.reason || '유효하지 않은 키입니다.';
      return;
    }
    box.classList.remove('error');
    box.innerHTML = [
      '등급: ' + (r.tier === 'premium' ? '프리미엄' : '스탠다드'),
      '최대 기기 수: ' + (r.maxDevices || 1) + '대',
      '발급일: ' + (r.issuedAt || '-'),
      '만료일: ' + (r.expiresAt || '무제한') + (r.expired ? ' (만료됨)' : ''),
      '라이선스 번호: ' + (r.licenseId || '-'),
      '구매자 이메일: ' + (r.userEmail || '(미기재)'),
      '<span style="color:var(--text-muted)">※ 이 조회는 키 안에 서명된 값만 보여줍니다. 실제 활성화된 기기 수/현황은 구매자 PC의 로컬 저장소에만 있어 여기서 확인할 수 없습니다.</span>',
    ].join('<br/>');
  }

  async function resetLedger() {
    // 2026-07-14: 오클릭으로 인한 실수 삭제를 막기 위해 반드시 confirm()
    // 경고 팝업을 먼저 띄우고, 사용자가 명시적으로 '확인'을 눌러야만
    // 실제 삭제 요청을 보낸다.
    const ok = confirm('발급 이력을 전부 삭제합니다. 테스트로 만든 라이선스 기록을 포함해 모두 지워지며, 되돌릴 수 없습니다. 계속하시겠습니까?');
    if (!ok) return;
    const res = await fetch('/api/history/clear', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      loadHistory();
    } else {
      alert(data.error || '초기화에 실패했습니다.');
    }
  }

  const FIREBASE_DB_URL_JS = 'https://naver-blog-automation-4d9d6-default-rtdb.asia-southeast1.firebasedatabase.app';

  function sanitizeFirebaseKeyJs(str) {
    return String(str || '').replace(/[.#$[\\]/]/g, '_');
  }

  // 로컬 표와 "로컬 미보유" 표가 같은 행 구조를 쓰도록 공통 함수로 분리
  // (2026-07-20). includeDelete가 false면 삭제 버튼 칸 자체를 만들지 않음
  // — "로컬 미보유" 쪽은 로컬 파일에 없는 항목이라 지울 대상이 없음.
  function buildHistoryRow(rec, blockedMap, includeDelete) {
    const key = sanitizeFirebaseKeyJs(rec.licenseId);
    const isBlocked = !!(blockedMap[key] && blockedMap[key]['차단']);
    let row = '<tr>' +
      '<td>' + rec.issuedAt + '</td>' +
      '<td><span class="badge badge-' + rec.tier + '">' + (rec.tier === 'premium' ? '프리미엄' : '스탠다드') + '</span></td>' +
      '<td>' + rec.maxDevices + '대</td>' +
      '<td>' + (rec.expiresAt || '무제한') + '</td>' +
      '<td>' + (rec.userEmail || '-') + '</td>' +
      '<td>' + rec.licenseId + '</td>' +
      '<td>' + (rec.channel || '-') + '</td>' +
      '<td>' + (rec.orderId || '-') + '</td>' +
      '<td>' + (rec.note || '-') + '</td>' +
      '<td>' + (isBlocked ? '<span class="badge" style="background:rgba(248,113,113,0.15);color:var(--danger)">차단됨</span>' : '<span class="badge" style="color:var(--text-muted)">정상</span>') + '</td>' +
      '<td><button class="copy-btn" style="margin-top:0" onclick="toggleBlock(\\'' + rec.licenseId.replace(/'/g, "\\'") + '\\', ' + (!isBlocked) + ')">' + (isBlocked ? '차단 해제' : '차단') + '</button></td>' +
      '<td><button class="copy-btn" style="margin-top:0" onclick="openDeviceModal(\\'' + rec.licenseId.replace(/'/g, "\\'") + '\\')">기기 관리</button></td>';
    if (includeDelete) {
      row += '<td style="text-align:right"><button class="copy-btn delete-btn" style="margin-top:0" onclick="deleteHistoryEntry(\\'' + rec.licenseId.replace(/'/g, "\\'") + '\\')">삭제</button></td>';
    }
    row += '</tr>';
    return row;
  }

  async function fetchBlockedMap() {
    try {
      const bres = await fetch(FIREBASE_DB_URL_JS + '/차단목록.json');
      const bdata = await bres.json();
      return bdata || {};
    } catch {
      return {};
    }
  }

  async function loadHistory() {
    const res = await fetch('/api/history');
    const data = await res.json();
    const box = document.getElementById('historyBox');
    if (!data.success || !data.list.length) {
      box.innerHTML = '<div class="empty">아직 발급 이력이 없습니다.</div>';
    } else {
      const blockedMap = await fetchBlockedMap();
      let html = '<table><thead><tr><th>발급일</th><th>등급</th><th>기기수</th><th>만료일</th><th>이메일</th><th>번호</th><th>판매채널</th><th>주문번호</th><th>메모</th><th>상태</th><th></th><th></th><th></th></tr></thead><tbody>';
      for (const rec of data.list) html += buildHistoryRow(rec, blockedMap, true);
      html += '</tbody></table>';
      box.innerHTML = html;
    }
    loadRemoteOnlyHistory(data.success ? data.list : []);
  }

  // "로컬 미보유"(2026-07-20 신규) — 파이어베이스 /licenses 전체를 읽어와
  // 로컬 목록에 없는 라이선스ID만 걸러서 보여준다. 다른 기기에서 발급한
  // 것과 이 기기에서 발급 후 로컬 표에서 "삭제"한 것이 구분 없이 섞여
  // 나오지만, "지금 로컬 표에 없다"는 기준으로는 정확하다.
  async function loadRemoteOnlyHistory(localList) {
    const box = document.getElementById('remoteOnlyBox');
    if (!box) return;
    box.innerHTML = '<div class="empty">불러오는 중…</div>';
    try {
      const res = await fetch('/api/licenses/remote', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        box.innerHTML = '<div class="empty">' + (data.error || '조회에 실패했습니다. 관리자 계정으로 로그인되어 있는지 확인하세요.') + '</div>';
        return;
      }
      const localIds = new Set((localList || []).map((r) => r.licenseId));
      const remoteOnly = data.list.filter((r) => !localIds.has(r.licenseId));
      if (!remoteOnly.length) {
        box.innerHTML = '<div class="empty">로컬 미보유 항목이 없습니다.</div>';
        return;
      }
      const blockedMap = await fetchBlockedMap();
      let html = '<table><thead><tr><th>발급일</th><th>등급</th><th>기기수</th><th>만료일</th><th>이메일</th><th>번호</th><th>판매채널</th><th>주문번호</th><th>메모</th><th>상태</th><th></th><th></th></tr></thead><tbody>';
      for (const rec of remoteOnly) html += buildHistoryRow(rec, blockedMap, false);
      html += '</tbody></table>';
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div class="empty">불러오는 중 오류: ' + e.message + '</div>';
    }
  }

  async function toggleBlock(licenseId, newBlockedValue) {
    let reason = null;
    if (newBlockedValue) {
      reason = prompt('차단 사유를 입력하세요 (선택, 그냥 확인만 눌러도 됩니다):', '');
      if (reason === null) return; // 취소
    } else {
      if (!confirm(licenseId + ' 라이선스의 차단을 해제할까요?')) return;
    }
    const res = await fetch('/api/block', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ licenseId, blocked: newBlockedValue, reason }),
    });
    const data = await res.json();
    if (data.success) {
      loadHistory();
    } else {
      alert(data.error || '처리에 실패했습니다. 관리자 계정이 설정되어 있는지, 파이어베이스 보안 규칙에 차단목록 쓰기 권한이 반영됐는지 확인하세요.');
    }
  }

  // 2026-07-14 신규 — 로컬 발급 이력 한 줄만 삭제(전체 초기화 resetLedger()와
  // 달리 개별 항목용). 파이어베이스 기록/키 자체는 그대로 남는다는 점을
  // confirm() 문구에 명시해 사용자가 "차단"과 혼동하지 않게 함.
  async function deleteHistoryEntry(licenseId) {
    const ok = confirm(licenseId + ' 항목을 로컬 발급 이력에서 삭제할까요?\\n(파이어베이스에 이미 전송된 기록과 라이선스 키 자체는 그대로 유지됩니다 — 키를 무효화하려면 "차단" 버튼을 사용하세요.)');
    if (!ok) return;
    const res = await fetch('/api/history/delete', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ licenseId }),
    });
    const data = await res.json();
    if (data.success) {
      loadHistory();
    } else {
      alert(data.error || '삭제에 실패했습니다.');
    }
  }

  async function checkPrivKey() {
    const res = await fetch('/api/status');
    const data = await res.json();
    document.getElementById('privKeyWarn').classList.toggle('show', !data.hasPrivateKey);
  }

  async function checkAdminStatus() {
    const res = await fetch('/api/admin/status');
    const data = await res.json();
    document.getElementById('adminSetupBox').style.display = data.hasAdmin ? 'none' : 'block';
    document.getElementById('adminReadyBox').style.display = data.hasAdmin ? 'block' : 'none';
    if (data.hasAdmin) {
      document.getElementById('adminEmailLabel').textContent = data.email;
      loadAdminLogs();
    }
  }

  // 저장은 process.platform 원본값(darwin/win32/linux)을 그대로 쓰되,
  // 화면에는 사람이 읽기 쉬운 이름으로 바꿔 보여준다(2026-07-20).
  function platformLabel(p) {
    if (p === 'darwin') return 'macOS';
    if (p === 'win32') return 'Windows';
    if (p === 'linux') return 'Linux';
    return p || '-';
  }

  async function loadAdminLogs() {
    const box = document.getElementById('adminLogBox');
    box.innerHTML = '<div class="empty">불러오는 중…</div>';
    try {
      const res = await fetch('/api/admin/logs', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        box.innerHTML = '<div class="empty">' + (data.error || '조회에 실패했습니다.') + '</div>';
        return;
      }
      if (!data.list.length) {
        box.innerHTML = '<div class="empty">아직 기록이 없습니다.</div>';
        return;
      }
      let html = '';
      for (const rec of data.list) {
        html += '<div class="device-row"><div class="meta">' +
          '<b>' + (rec['기기명'] || '-') + '</b> · ' + platformLabel(rec['플랫폼']) + ' · ' + (rec['작업'] || '-') + '<br/>' +
          (rec['시각'] || '-') +
          '</div></div>';
      }
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div class="empty">불러오는 중 오류: ' + e.message + '</div>';
    }
  }

  async function changeAdminPasswordUI() {
    const newPassword = document.getElementById('admin-newpw').value;
    const box = document.getElementById('changePwResult');
    box.classList.add('show');
    if (!newPassword || newPassword.length < 6) {
      box.classList.add('error');
      box.textContent = '새 비밀번호는 6자 이상이어야 합니다.';
      return;
    }
    if (!confirm('비밀번호를 변경하면 예전 비밀번호로는 어떤 기기에서도 더 이상 이 관리자 계정을 쓸 수 없게 됩니다. 이 기기(지금 이 창)는 자동으로 새 비밀번호로 갱신되어 계속 정상 동작합니다. 계속할까요?')) return;
    const res = await fetch('/api/admin/change-password', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      box.classList.remove('error');
      box.textContent = '비밀번호가 변경되었습니다. 다른 기기는 예전 비밀번호로 더 이상 인증되지 않습니다.';
      document.getElementById('admin-newpw').value = '';
      loadAdminLogs();
    } else {
      box.classList.add('error');
      box.textContent = data.error || '변경에 실패했습니다.';
    }
  }

  async function setupAdmin() {
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;
    const box = document.getElementById('adminSetupResult');
    box.classList.add('show');
    if (!email || !password) {
      box.classList.add('error');
      box.textContent = '이메일과 비밀번호를 입력하세요.';
      return;
    }
    const res = await fetch('/api/admin/setup', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.success) {
      box.classList.remove('error');
      box.innerHTML = '계정이 생성되었습니다. 아래 UID를 파이어베이스 콘솔 "규칙" 탭의 차단목록 쓰기 조건에 붙여넣으세요:' +
        '<div class="key-value">' + data.uid + '</div>' +
        '<button class="copy-btn" onclick="copyKey(this, \\'' + data.uid + '\\')">UID 복사</button>';
      checkAdminStatus();
    } else {
      box.classList.add('error');
      box.textContent = data.error || '계정 생성에 실패했습니다.';
    }
  }

  async function loginAdmin() {
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;
    const box = document.getElementById('adminSetupResult');
    box.classList.add('show');
    if (!email || !password) {
      box.classList.add('error');
      box.textContent = '이메일과 비밀번호를 입력하세요.';
      return;
    }
    const res = await fetch('/api/admin/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.success) {
      box.classList.remove('error');
      box.textContent = '로그인되었습니다.';
      checkAdminStatus();
    } else {
      box.classList.add('error');
      box.textContent = data.error || '로그인에 실패했습니다. 이메일/비밀번호를 확인하세요.';
    }
  }

  let currentDeviceLicenseId = null;

  async function openDeviceModal(licenseId) {
    currentDeviceLicenseId = licenseId;
    document.getElementById('deviceModalTitle').textContent = '기기 관리 — ' + licenseId;
    document.getElementById('deviceModalBody').innerHTML = '<div class="empty">불러오는 중…</div>';
    document.getElementById('deviceModal').classList.add('show');
    const body = document.getElementById('deviceModalBody');
    try {
      const res = await fetch('/api/devices', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ licenseId }),
      });
      const data = await res.json();
      if (!data.success) {
        body.innerHTML = '<div class="empty">' + (data.error || '조회에 실패했습니다. 관리자 계정으로 로그인되어 있는지 확인하세요.') + '</div>';
        return;
      }
      if (!data.list.length) {
        body.innerHTML = '<div class="empty">등록된 기기가 없습니다.</div>';
        return;
      }
      let html = '';
      for (const d of data.list) {
        html += '<div class="device-row"><div class="meta">' +
          '<b>' + platformLabel(d['플랫폼']) + '</b> · ' + (d['이벤트'] || '-') + '<br/>' +
          (d['시각'] || '-') + ' · v' + (d['앱버전'] || '-') + ' · ' + (d['이메일'] || '(미기재)') +
          '</div>' +
          '<button class="copy-btn delete-btn" style="margin-top:0" onclick="releaseDeviceUI(\\'' + d.hwidKey.replace(/'/g, "\\'") + '\\')">해제</button>' +
          '</div>';
      }
      body.innerHTML = html;
    } catch (e) {
      body.innerHTML = '<div class="empty">불러오는 중 오류가 발생했습니다: ' + e.message + '<br/>(라이선스 발급기를 완전히 종료 후 다시 실행해보세요 — 도구가 켜진 채로 코드가 업데이트되면 새 기능이 반영되지 않습니다.)</div>';
    }
  }

  function closeDeviceModal() {
    document.getElementById('deviceModal').classList.remove('show');
    currentDeviceLicenseId = null;
  }

  async function releaseDeviceUI(hwidKey) {
    if (!currentDeviceLicenseId) return;
    if (!confirm('이 기기 등록 기록을 해제할까요? 고객이 이 PC에서 다시 실행하면 재등록이 필요합니다.')) return;
    const res = await fetch('/api/devices/release', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ licenseId: currentDeviceLicenseId, hwidKey }),
    });
    const data = await res.json();
    if (data.success) {
      openDeviceModal(currentDeviceLicenseId);
    } else {
      alert(data.error || '해제에 실패했습니다.');
    }
  }

  checkPrivKey();
  checkAdminStatus();
  loadHistory();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  // 로컬 전용 — 외부 접근 자체를 이 서버가 127.0.0.1에만 바인딩해 차단(아래 listen 참고)
  try {
    if (req.method === 'GET' && req.url === '/') {
      const body = HTML_PAGE;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }
    if (req.method === 'GET' && req.url === '/api/status') {
      return sendJson(res, 200, { hasPrivateKey: fs.existsSync(PRIV_PATH) });
    }
    if (req.method === 'GET' && req.url === '/api/history') {
      return sendJson(res, 200, { success: true, list: readLedger() });
    }
    if (req.method === 'POST' && req.url === '/api/history/clear') {
      clearLedger();
      return sendJson(res, 200, { success: true });
    }
    if (req.method === 'POST' && req.url === '/api/history/delete') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.licenseId) return sendJson(res, 400, { success: false, error: '라이선스ID가 필요합니다.' });
      const result = deleteLedgerEntry(body.licenseId);
      return sendJson(res, 200, { success: true, removed: result.removed });
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      return sendJson(res, 200, handleGenerate(body));
    }
    if (req.method === 'POST' && req.url === '/api/verify') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      return sendJson(res, 200, handleVerify(body));
    }
    // ── 원격 차단 관련 (2026-07-14 신규) ──────────────────────────
    if (req.method === 'GET' && req.url === '/api/admin/status') {
      const cred = readAdminCred();
      return sendJson(res, 200, { hasAdmin: !!cred, email: cred ? cred.email : null });
    }
    if (req.method === 'POST' && req.url === '/api/admin/setup') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.email || !body.password) return sendJson(res, 400, { success: false, error: '이메일/비밀번호를 입력하세요.' });
      const result = await setupAdmin(body.email, body.password);
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/block') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.licenseId) return sendJson(res, 400, { success: false, error: '라이선스ID가 필요합니다.' });
      const result = await setLicenseBlocked(body.licenseId, body.blocked, body.reason);
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/admin/login') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.email || !body.password) return sendJson(res, 400, { success: false, error: '이메일/비밀번호를 입력하세요.' });
      const result = await loginAdmin(body.email, body.password);
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/devices') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.licenseId) return sendJson(res, 400, { success: false, error: '라이선스ID가 필요합니다.' });
      const result = await getLicenseDevices(body.licenseId);
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/devices/release') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.licenseId || !body.hwidKey) return sendJson(res, 400, { success: false, error: '라이선스ID/기기ID가 필요합니다.' });
      const result = await releaseDevice(body.licenseId, body.hwidKey);
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/admin/logs') {
      const result = await getAdminLoginLogs();
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/licenses/remote') {
      const result = await getRemoteLicenses();
      return sendJson(res, result.success ? 200 : 400, result);
    }
    if (req.method === 'POST' && req.url === '/api/admin/change-password') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      if (!body.newPassword || String(body.newPassword).length < 6) return sendJson(res, 400, { success: false, error: '새 비밀번호는 6자 이상이어야 합니다.' });
      const result = await changeAdminPassword(body.newPassword);
      return sendJson(res, result.success ? 200 : 400, result);
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    sendJson(res, 500, { success: false, error: e.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`이미 ${PORT} 포트에서 실행 중인 것 같습니다. 브라우저를 새로 엽니다: http://127.0.0.1:${PORT}`);
    openBrowser(`http://127.0.0.1:${PORT}`);
    process.exit(0);
  }
  console.error('[오류] 서버 시작 실패:', err.message);
  process.exit(1);
});

// 127.0.0.1에만 바인딩 — 로컬 PC 밖에서는 절대 접근 불가
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log('라이선스 키 생성기가 실행되었습니다:', url);
  console.log('종료하려면 이 터미널 창에서 Ctrl+C를 누르세요.');
  openBrowser(url);
});
