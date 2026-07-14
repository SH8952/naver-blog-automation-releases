const { app, BrowserWindow, shell, ipcMain, net, dialog, Notification, session: electronSession, clipboard, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── 통합 로그 기록 (2026-07-14 명칭 정리: 실제로는 INFO/WARN/ERROR 전부 기록됨) ──
// 로그 파일: userData/error_log.txt (파일명·IPC 채널명은 기존 그대로 유지,
// 사용자에게 보이는 UI 라벨만 "로그 기록"으로 정리함 — [[log-naming-cleanup]])
let LOG_FILE = null;

function getLogFile() {
  if (!LOG_FILE) {
    LOG_FILE = path.join(app.getPath('userData'), 'error_log.txt');
  }
  return LOG_FILE;
}

// ── 자동화 루프 전용 로그 (2026-07-05 신규) ──────────────────
// 오류 로그와는 별도 파일에 LOOP 컨텍스트만 함께 기록 — 시스템 탭에서
// "자동화 루프 로그"로 따로 열람할 수 있게 하기 위함(전체 로그에 섞이면
// 나중에 "왜 이렇게 발행했지" 추적이 번거로움).
let LOOP_LOG_FILE = null;

function getLoopLogFile() {
  if (!LOOP_LOG_FILE) {
    LOOP_LOG_FILE = path.join(app.getPath('userData'), 'automation_loop_log.txt');
  }
  return LOOP_LOG_FILE;
}

// ── 오류 전용 로그 (2026-07-14 신규) ──────────────────────────
// 기존 "오류 로그"라는 이름의 파일은 사실 INFO/WARN/ERROR가 전부 섞인
// 전체 로그였음(사용자 지적으로 확인). 이름은 "로그 기록"으로 정리하고,
// 진짜 ERROR 레벨만 모으는 파일을 이 아래에 새로 둔다 — LOOP 전용 로그와
// 동일한 "조건부 이중 기록" 패턴을 재사용.
let ERROR_ONLY_LOG_FILE = null;

function getErrorOnlyLogFile() {
  if (!ERROR_ONLY_LOG_FILE) {
    ERROR_ONLY_LOG_FILE = path.join(app.getPath('userData'), 'error_only_log.txt');
  }
  return ERROR_ONLY_LOG_FILE;
}

function writeLog(level, context, message, detail = '') {
  try {
    // 로컬 시간 (한국 시간대 자동 반영)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
               `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const detailStr = detail ? `\n    ${String(detail).split('\n').join('\n    ')}` : '';
    const line = `[${ts}] [${level.padEnd(5)}] [${context}] ${message}${detailStr}\n`;
    // 최신 로그가 상단에 오도록 파일 맨 앞에 기록
    const file = getLogFile();
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    fs.writeFileSync(file, line + existing, 'utf8');

    // LOOP 컨텍스트는 전용 로그 파일에도 동일하게 기록
    if (context === 'LOOP') {
      const loopFile = getLoopLogFile();
      const loopExisting = fs.existsSync(loopFile) ? fs.readFileSync(loopFile, 'utf8') : '';
      fs.writeFileSync(loopFile, line + loopExisting, 'utf8');
    }

    // ERROR 레벨은 오류 전용 로그 파일에도 동일하게 기록 (2026-07-14 신규)
    if (level === 'ERROR') {
      const errFile = getErrorOnlyLogFile();
      const errExisting = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
      fs.writeFileSync(errFile, line + errExisting, 'utf8');
    }
  } catch { /* 로그 쓰기 실패는 무시 */ }
}

// 전역 예외 캐치
process.on('uncaughtException',  (err) => writeLog('ERROR', 'PROCESS', 'UncaughtException', err.stack || err.message));
process.on('unhandledRejection', (reason) => writeLog('ERROR', 'PROCESS', 'UnhandledRejection', String(reason)));

// ── electron-store (설정 영속화) ─────────────────────────────
let _store = null;
function getStore() {
  if (_store) return _store;
  const { default: Store } = require('electron-store');
  _store = new Store();
  return _store;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── Firebase 원격 로그 (문의하기 + 라이선스 활성화 기록, 2026-07-14 신규) ──
// Realtime Database REST API에 직접 PUT/POST하는 방식 — firebase npm 패키지를
// 추가하지 않아 크로스 플랫폼 빌드에 영향 없음(기존 AI 호출과 동일하게
// Electron net 모듈만 재사용). apiKey는 클라이언트 공개 식별자일 뿐이라
// 비밀값이 아니며, 실제 접근 제어는 Realtime Database 보안 규칙에서 처리한다
// (쓰기 전용, 읽기는 콘솔 로그인 상태에서만 규칙과 무관하게 항상 가능).
const FIREBASE_DB_URL = 'https://naver-blog-automation-4d9d6-default-rtdb.asia-southeast1.firebasedatabase.app';

// 실패해도 앱 동작에 영향이 없어야 하므로 절대 throw하지 않고 항상
// { success, error? }를 resolve한다 — 호출부에서 await는 하되 실패를
// 신경 쓸 필요 없게(오프라인이어도 라이선스 검증/앱 실행 자체는 계속됨).
function firebasePush(path, data) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(data);
      const req = net.request({ method: 'POST', url: `${FIREBASE_DB_URL}/${path}.json` });
      req.setHeader('Content-Type', 'application/json');
      let respBody = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { respBody += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            writeLog('WARN', 'FIREBASE', `${path} 전송 실패 HTTP ${res.statusCode}`, respBody.slice(0, 200));
            resolve({ success: false, error: `HTTP ${res.statusCode}` });
          }
        });
      });
      req.on('error', (err) => {
        writeLog('WARN', 'FIREBASE', `${path} 전송 네트워크 오류`, err.message);
        resolve({ success: false, error: err.message });
      });
      req.write(body);
      req.end();
    } catch (err) {
      writeLog('WARN', 'FIREBASE', `${path} 전송 예외`, err.message);
      resolve({ success: false, error: err.message });
    }
  });
}

// 문의하기 — 사용자가 입력한 문의 내용 + 최근 오류 로그(최대 50줄)를 함께
// /inquiries에 전송. 오류 로그는 파일 전체가 아니라 최근 항목만 잘라 보내
// 전송량과 노출 범위를 최소화한다.
async function sendInquiry(message) {
  try {
    const errFile = getErrorOnlyLogFile();
    const errorLogTail = fs.existsSync(errFile)
      ? fs.readFileSync(errFile, 'utf8').split('\n').slice(0, 50).join('\n')
      : '';
    const license = await getLicenseStatus();
    const payload = {
      timestamp: Date.now(),
      message: String(message || '').slice(0, 5000),
      errorLog: errorLogTail.slice(0, 20000),
      licenseId: license.licenseId || null,
      userEmail: license.userEmail || null,
      tier: license.tier || 'standard',
      appVersion: app.getVersion(),
      platform: process.platform,
    };
    const result = await firebasePush('inquiries', payload);
    if (result.success) writeLog('INFO', 'INQUIRY', '문의 전송 완료');
    return result;
  } catch (err) {
    writeLog('WARN', 'INQUIRY', '문의 전송 처리 중 오류', err.message);
    return { success: false, error: err.message };
  }
}

// ── 라이선스 (오프라인 서명 키, 2026-07-04 신규 / 2026-07-13 HWID+시간방어 추가) ─
// license/licenseCore.js: 공개키 내장 검증 모듈 (개인키는 포함되어 있지 않음,
// 발급은 tools/generate-license.js로 개발자가 직접 수행)
const { verifyLicenseKey, getHardwareId } = require('./license/licenseCore');
const { checkTimeIntegrity } = require('./license/timeGuard');

// 2026-07-13: 키가 있는데 문제(서명무효/만료/기기불일치/시간조작)가 있을
// 때만 실행을 차단하기로 함(키가 아예 없으면 지금처럼 스탠다드로 계속
// 동작 — 이 분기는 그대로 유지). HWID는 "첫 실행 자동 등록" 방식 —
// 발급 시점에 미리 박아넣지 않고, 이 키가 이 기기에서 처음 적용되는
// 순간의 HWID를 electron-store에 저장해두고 이후 대조한다. isDev(개발
// 모드)에서는 실수로 개발자 본인이 막히는 것을 막기 위해 devBypass를
// 함께 반환해 렌더러가 차단 화면을 건너뛸 수 있게 한다.
async function getLicenseStatus() {
  const store = getStore();
  const key = store.get('settings.licenseKey', '');
  if (!key) {
    return {
      hasKey: false, valid: true, expired: false,
      tier: 'standard', maxDevices: 1,
      expiresAt: null, issuedAt: null, licenseId: null,
      userEmail: null, daysRemaining: null, reason: null,
      hwidMismatch: false, timeTampered: false, devBypass: isDev,
    };
  }

  const result = verifyLicenseKey(key);
  if (!result.valid) {
    // 서명 자체가 무효거나(위조/손상) 순수 날짜 비교로 이미 만료된 경우 —
    // HWID/시간조작 검사를 더 할 필요 없이 바로 반환.
    return {
      hasKey: true, ...result, tier: result.tier || 'standard',
      hwidMismatch: false, timeTampered: false, devBypass: isDev,
    };
  }

  // 서명은 유효 — HWID 대조(첫 등록 시 자동 저장, maxDevices까지 다중 기기
  // 허용 — 2026-07-13 수정: 원래 기기 1대만 저장하던 것을 배열로 바꿔
  // maxDevices 값만큼 여러 대에서 같은 키를 쓸 수 있게 함) + 시간조작
  // 검사를 추가로 수행.
  let hwidMismatch = false;
  try {
    const myHwid = getHardwareId();
    const activation = store.get('settings._licenseActivation', null);
    const maxDevices = Number.isFinite(result.maxDevices) ? result.maxDevices : 1;
    if (result.licenseId) {
      if (!activation || activation.licenseId !== result.licenseId) {
        // 이 licenseId를 이 기기에서 처음 보는 경우 — 첫 번째 자리로 자동 등록
        store.set('settings._licenseActivation', { licenseId: result.licenseId, hwids: [myHwid] });
        // 2026-07-14 신규: 활성화 이벤트를 파이어베이스에도 기록(실패해도 무시,
        // await 안 함 — 오프라인이어도 라이선스 검증 자체는 계속 진행돼야 함)
        firebasePush('activations', {
          timestamp: Date.now(), licenseId: result.licenseId, userEmail: result.userEmail || null,
          hwid: myHwid, tier: result.tier, appVersion: app.getVersion(), platform: process.platform,
          event: 'first_activation',
        });
      } else {
        const hwids = Array.isArray(activation.hwids) ? activation.hwids : (activation.hwid ? [activation.hwid] : []);
        if (!hwids.includes(myHwid)) {
          if (hwids.length < maxDevices) {
            // 아직 정원이 남아있으면 이 기기를 새 자리로 등록
            store.set('settings._licenseActivation', { licenseId: activation.licenseId, hwids: [...hwids, myHwid] });
            firebasePush('activations', {
              timestamp: Date.now(), licenseId: activation.licenseId, userEmail: result.userEmail || null,
              hwid: myHwid, tier: result.tier, appVersion: app.getVersion(), platform: process.platform,
              event: 'new_device_registered',
            });
          } else {
            // 이미 maxDevices만큼 다 등록된 상태에서 등록 안 된 새 기기 — 차단
            hwidMismatch = true;
          }
        }
        // hwids.includes(myHwid)면 이미 등록된 기기 — 통과
      }
    }
  } catch (e) {
    writeLog('WARN', 'LICENSE', 'HWID 대조 중 오류 — 이번 실행은 통과 처리', e.message);
  }

  let timeTampered = false;
  let finalExpired = result.expired;
  try {
    const timeCheck = await checkTimeIntegrity(store, result.expiresAt);
    timeTampered = timeCheck.tampered;
    finalExpired = result.expired || timeCheck.effectiveExpired;
  } catch (e) {
    writeLog('WARN', 'LICENSE', '시간조작 검사 중 오류 — 이번 실행은 통과 처리', e.message);
  }

  const valid = !finalExpired && !hwidMismatch && !timeTampered;
  let reason = null;
  if (hwidMismatch) reason = '등록 가능한 기기 대수를 초과했습니다';
  else if (timeTampered) reason = '시스템 시간 조작이 감지되었습니다';
  else if (finalExpired) reason = '라이선스 기간 만료';

  return {
    hasKey: true,
    valid,
    expired: finalExpired,
    tier: result.tier || 'standard',
    maxDevices: result.maxDevices,
    expiresAt: result.expiresAt,
    issuedAt: result.issuedAt,
    licenseId: result.licenseId,
    userEmail: result.userEmail || null,
    daysRemaining: result.daysRemaining,
    hwidMismatch,
    timeTampered,
    devBypass: isDev,
    reason,
  };
}

// ── 등급별 사용 제한 (Phase 2, 2026-07-14 신규) ────────────────
// getLicenseStatus()의 tier를 실제 기능 차단으로 연결하는 중앙 모듈.
// 스탠다드/프리미엄 등급별 제한값을 한 곳에서 정의해, main.js 곳곳의
// IPC 핸들러가 이 함수 하나만 호출하면 되도록 한다(값이 여러 곳에
// 흩어져 있으면 나중에 등급 정책이 바뀔 때 일부만 고쳐지는 사고가
// 나기 쉬움).
//
// 등급 판정 기준: 키가 없거나(hasKey:false) 유효하지 않으면(valid:false —
// 만료/기기초과/시간조작 등) 무조건 'standard'로 취급한다. 프리미엄
// 라이선스가 만료된 경우에도 프리미엄 기능이 계속 열려있으면 안 되기
// 때문 — hasKey 여부와 무관하게 valid && tier==='premium'일 때만 프리미엄.
//
// 캐시: getLicenseStatus()는 유효한 키가 있을 때 온라인 시간조작 검사
// (checkTimeIntegrity)를 포함해 최대 ~2초까지 걸릴 수 있다. 즉시발행처럼
// 사용자가 클릭할 때마다 이 함수를 호출하는 지점에서 매번 2초씩 걸리면
// 유료 사용자 경험이 나빠지므로, 짧은 TTL로 캐시해 반복 호출 비용을
// 줄인다. 라이선스 키를 새로 적용/해제하는 시점(license:set)에는
// invalidateTierLimitsCache()로 캐시를 즉시 무효화해 새 등급이 바로
// 반영되게 한다.
let _tierLimitsCache = { value: null, ts: 0 };
const TIER_LIMITS_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

function invalidateTierLimitsCache() {
  _tierLimitsCache = { value: null, ts: 0 };
}

// 하루 최대 발행 횟수 계산 — 스탠다드는 10회 고정(사용자 설정 무시).
// 프리미엄은 settings.maxDailyPosts에 저장된 숫자를 상한으로 쓰되, 값이
// 0이거나(기본값) 비어있으면 무제한으로 취급한다(2026-07-14: 별도
// "무제한" 체크박스를 없애고 값 자체로만 표현하도록 단순화 — 사용자 판단:
// 프리미엄은 원래 기본이 무제한이라 토글이 불필요했음).
function computeMaxDailyPosts(isPremium, store) {
  if (!isPremium) return 10;
  const n = Number(store.get('settings.maxDailyPosts', 0));
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

async function getTierLimits(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _tierLimitsCache.value && (now - _tierLimitsCache.ts) < TIER_LIMITS_CACHE_TTL_MS) {
    return _tierLimitsCache.value;
  }
  const store = getStore();

  // 2026-07-14 신규 — 개발자 전용 등급 강제 오버라이드. 실제 라이선스 키를
  // 매번 새로 발급/적용하지 않고도 스탠다드/프리미엄 화면을 즉시 오갈 수
  // 있게 하기 위한 개발 편의 기능(사이드바의 ST/PR/개발 토글에서 설정).
  // *** 배포판 유출 방지 이중 장치 ***
  //   ① 이 값을 설정하는 dev:setTierOverride IPC 자체가 맨 위에서 isDev를
  //      확인해 거부하므로, 패키징된 앱에서는 애초에 저장될 수 없다.
  //   ② 설사 store에 값이 남아있어도(예: 개발 중 저장된 electron-store를
  //      패키징 앱이 재사용하는 극단적 경우), 여기서 다시 한번 isDev를
  //      확인하지 않으면 절대 읽지 않는다 — isDev가 false인 실제 배포판
  //      에서는 이 줄 자체가 항상 null이 되어 아래 실제 라이선스 로직만 탄다.
  const devOverride = isDev ? store.get('settings._devTierOverride', null) : null;

  let isPremium;
  if (isDev) {
    // 2026-07-14 보강 — 사용자 명시적 요청: "개발" 모드(토글 미선택,
    // devOverride=null 기본값)에서는 실제 라이선스 유무와 무관하게 항상
    // 모든 기능이 열려 있어야 한다(테스트 키를 안 넣어도 자유롭게 개발
    // 가능해야 함). 처음 구현은 "개발"을 눌렀을 때 실제 라이선스 로직으로
    // 폴백시켰는데, 그러면 키가 없는 개발 PC에서는 여전히 스탠다드로
    // 잠기는 버그였음(사용자가 스크린샷으로 확인). 그래서 개발 환경에서는
    // "ST"를 명시적으로 선택했을 때만 스탠다드로 잠그고, 그 외(PR 선택 또는
    // 미선택="개발" 기본값)는 전부 잠금 해제로 바꿈.
    isPremium = devOverride !== 'standard';
  } else {
    const license = await getLicenseStatus();
    isPremium = !!(license.valid && license.tier === 'premium');
  }
  const limits = {
    tier: isPremium ? 'premium' : 'standard',
    isPremium,
    maxAccounts: isPremium ? Infinity : 1,
    automationLoop: isPremium,
    reservation: isPremium,
    thumbnail: isPremium,
    keywordResearch: isPremium,
    maxDailyPosts: computeMaxDailyPosts(isPremium, store),
    // 프론트(사이드바 토글)가 현재 어떤 버튼을 활성 표시할지 판단하는 용도.
    // isDev가 아니면 항상 null(배포판에는 이 개념 자체가 없음).
    devTierOverride: isDev ? devOverride : null,
  };
  _tierLimitsCache = { value: limits, ts: now };
  return limits;
}

// ── 암호화 유틸 ─────────────────────────────────────────────
// AES-256-CBC: 쿠키 암호화 / 복호화
const CIPHER_KEY = crypto.scryptSync('naver-blog-automation-v1', 'nblog-salt-2024', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', CIPHER_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decrypt(text) {
  try {
    const colonIdx = text.indexOf(':');
    const ivHex = text.slice(0, colonIdx);
    const enc = text.slice(colonIdx + 1);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', CIPHER_KEY, iv);
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return null;
  }
}

// ── 유효한 네이버 ID 검증 ────────────────────────────────────
function isValidNaverId(id) {
  return id && /^[a-z0-9][a-z0-9_.]{2,19}$/i.test(id) &&
    !['naver', 'search', 'blog', 'cafe', 'news', 'main', 'my', 'help', 'api'].includes(id.toLowerCase());
}

// ── 네이버 ID 추출: 전략 1 — 현재 페이지 JS 실행 ─────────────
async function extractIdFromPage(win) {
  try {
    const id = await win.webContents.executeJavaScript(`
      (function() {
        const candidates = [];

        // 1. GNB 로그인 영역 — 최신 선택자 포함
        const gnbSelectors = [
          '.gnb_id', '#gnb_my_m .gnb_id', '.MyView-module__gnb_id',
          '#account .gnb_id', '.gnb_my_area .gnb_id',
          '[class*="gnb_id"]', '[class*="user_id"]', '[class*="login_id"]',
          '[class*="userId"]', '[class*="loginId"]', '[class*="userName"]',
          '.NNB_idtext', '.NNB_id', '#NM_TOP_UTIL .user_id',
          '.btn_my .user_id', '.MyView-module__user_name',
        ];
        for (const sel of gnbSelectors) {
          try {
            document.querySelectorAll(sel).forEach(el => {
              const t = el.textContent.trim();
              if (t) candidates.push(t);
            });
          } catch {}
        }

        // 2. data 속성에서 추출
        document.querySelectorAll('[data-loginid],[data-userid],[data-nid],[data-user-id],[data-login-id]').forEach(el => {
          ['data-loginid','data-userid','data-nid','data-user-id','data-login-id'].forEach(attr => {
            const v = el.getAttribute(attr);
            if (v) candidates.push(v);
          });
        });

        // 3. window 전역 변수
        const winVars = ['__LOGIN_ID__','__USER_ID__','naver_user_id','NNB_ID','_nid_','naverLoginId'];
        for (const v of winVars) {
          try { if (window[v]) candidates.push(String(window[v])); } catch {}
        }
        try { if (window.naver?.com?.user) {
          const u = window.naver.com.user;
          candidates.push(u.id || u.loginId || u.userId || '');
        }} catch {}

        // 유효한 ID 반환 (스크립트 태그 스캔 제거 — false positive 원인)
        const BLOCKED_IDS = new Set([
          'naver','search','blog','cafe','news','main','my','help','api',
          'finish','start','close','open','click','back','next','home',
          'page','view','list','type','name','user','pass','data','info',
          'text','link','item','icon','dark','light','left','right','true',
          'false','null','none','more','less','error','login','logout',
        ]);
        for (const c of candidates) {
          const cleaned = (c || '').trim().toLowerCase();
          if (/^[a-z0-9][a-z0-9_.]{3,20}$/.test(cleaned) && !BLOCKED_IDS.has(cleaned)) {
            return cleaned;
          }
        }
        return null;
      })()
    `);
    return id || null;
  } catch (err) {
    writeLog('WARN', 'LOGIN', 'extractIdFromPage 실패', err.message);
    return null;
  }
}

// ── 네이버 ID 추출: 전략 2 — 숨겨진 창으로 블로그 리다이렉트 확인 ──
async function extractIdViaHiddenWindow(ses) {
  return new Promise((resolve) => {
    let hiddenWin;
    try {
      hiddenWin = new BrowserWindow({
        show: false,
        webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
      });
    } catch (err) {
      writeLog('WARN', 'LOGIN', 'hiddenWin 생성 실패', err.message);
      return resolve(null);
    }

    const timeout = setTimeout(() => {
      writeLog('WARN', 'LOGIN', 'hiddenWin ID 추출 타임아웃');
      if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
      resolve(null);
    }, 25000);

    const cleanup = (id) => {
      clearTimeout(timeout);
      try { if (!hiddenWin.isDestroyed()) hiddenWin.destroy(); } catch {}
      resolve(id);
    };

    const BLOCKED_PATHS = new Set([
      'my', 'prologue', 'postwrite', 'blogmain', 'section', 'postview', 'main',
      'naver', 'my.naver', 'search', 'api', 'blog', 'help', 'tag', 'category',
      'postlist.naver', 'write', 'admin', 'postlist', 'gonaver',
    ]);

    function extractIdFromUrl(url) {
      const m1 = url.match(/(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})\/?(?:\?|#|$|\/)/);
      if (m1 && !BLOCKED_PATHS.has(m1[1].toLowerCase()) && isValidNaverId(m1[1]) && !m1[1].includes('.')) return m1[1].toLowerCase();
      try {
        const u = new URL(url);
        const blogId = u.searchParams.get('blogId') || u.searchParams.get('targetId');
        if (blogId && isValidNaverId(blogId)) return blogId.toLowerCase();
      } catch {}
      return null;
    }

    const onNavigate = (_, url) => {
      writeLog('INFO', 'LOGIN', 'hiddenWin navigate', url);
      const id = extractIdFromUrl(url);
      if (id) { writeLog('INFO', 'LOGIN', 'hiddenWin에서 ID 추출 성공', id); cleanup(id); }
    };

    hiddenWin.webContents.on('did-navigate', onNavigate);
    hiddenWin.webContents.on('did-navigate-in-page', onNavigate);
    hiddenWin.webContents.on('did-redirect-navigation', (_, url) => {
      writeLog('INFO', 'LOGIN', 'hiddenWin redirect', url);
      const id = extractIdFromUrl(url);
      if (id) { writeLog('INFO', 'LOGIN', 'hiddenWin redirect에서 ID 추출', id); cleanup(id); }
    });

    // 로드 완료 후 현재 URL 재확인 + JS로 추가 시도
    hiddenWin.webContents.on('did-finish-load', async () => {
      const url = hiddenWin.webContents.getURL();
      writeLog('INFO', 'LOGIN', 'hiddenWin did-finish-load', url);
      const id = extractIdFromUrl(url);
      if (id) { cleanup(id); return; }
      // 5초 대기 (SPA 렌더링 완료 대기)
      await new Promise(r => setTimeout(r, 5000));
      if (hiddenWin.isDestroyed()) return;

      // ── 방법 A: 렌더링된 DOM HTML 전체에서 blogId 패턴 파싱 ──
      try {
        const htmlResult = await hiddenWin.webContents.executeJavaScript(`
          (function() {
            var BLOCKED = ['my','naver','my.naver','blog','search','api','help','main','section','start','tag','category','recommendation','write','undefined','null'];
            var ok = function(v) {
              return v && typeof v === 'string' && v.length >= 3 && v.length <= 20 &&
                /^[a-zA-Z0-9][a-zA-Z0-9_.]{2,19}$/.test(v.trim()) &&
                BLOCKED.indexOf(v.trim().toLowerCase()) === -1 &&
                !v.trim().toLowerCase().endsWith('.naver');
            };
            // 1. window 전역 변수 우선
            var candidates = [window.naver_id, window.blogId, window.ownerId, window.ownerBlogId, window.__BLOG_ID__, window.currentBlogId];
            try { var ps = window.__PRELOADED_STATE__; if (ps) candidates.push(ps.blogId, ps.ownerId, ps.blog && ps.blog.blogId); } catch(e) {}
            for (var i = 0; i < candidates.length; i++) {
              if (ok(candidates[i])) return {id: candidates[i].trim().toLowerCase(), src: 'window'};
            }
            // 2. 전체 HTML에서 패턴 검색
            var html = document.documentElement.outerHTML;
            var patterns = [
              /"blogId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
              /"ownerId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
              /"logName"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
              /data-blog-id="([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
              /data-blogid="([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
            ];
            for (var j = 0; j < patterns.length; j++) {
              var m = html.match(patterns[j]);
              if (m && ok(m[1])) return {id: m[1].toLowerCase(), src: 'html_pattern_' + j};
            }
            return {id: null, htmlLen: html.length, preview: html.substring(0, 300)};
          })()
        `);
        writeLog('INFO', 'LOGIN', 'hiddenWin DOM 파싱 결과', JSON.stringify({
          id: htmlResult.id, src: htmlResult.src, htmlLen: htmlResult.htmlLen
        }));
        if (htmlResult.preview) writeLog('INFO', 'LOGIN', 'hiddenWin HTML 미리보기', htmlResult.preview);
        if (htmlResult.id && isValidNaverId(htmlResult.id)) {
          writeLog('INFO', 'LOGIN', 'hiddenWin DOM에서 ID 추출', htmlResult.id);
          cleanup(htmlResult.id);
          return;
        }
      } catch (e) { writeLog('WARN', 'LOGIN', 'hiddenWin DOM 파싱 오류', e.message); }
    });

    hiddenWin.on('closed', () => { writeLog('WARN', 'LOGIN', 'hiddenWin 닫힘'); cleanup(null); });

    hiddenWin.loadURL('https://blog.naver.com/write').catch(err => {
      writeLog('WARN', 'LOGIN', 'hiddenWin URL 로드 실패', err.message);
      cleanup(null);
    });
  });
}

// ── 네이버 ID 추출: 전략 3 — 쿠키에서 직접 파싱 ───────────────
function extractIdFromCookies(cookies) {
  for (const cookie of cookies) {
    if (cookie.name === 'nid_inf') {
      try {
        const decoded = Buffer.from(cookie.value, 'base64').toString('utf8');
        const m = decoded.match(/"id"\s*:\s*"([a-z0-9_.]+)"/i);
        if (m && isValidNaverId(m[1])) return m[1];
      } catch {}
    }
  }
  return null;
}

// ── 네이버 ID 추출: 전략 4 — net.request로 리다이렉트 URL 추적 ──
async function extractIdViaNetRedirect(ses) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const BLOCKED = new Set(['my', 'naver', 'my.naver', 'blog', 'search', 'api', 'help', 'main', 'section', 'start', 'tag', 'category', 'recommendation', 'rank', 'popular', 'notice']);
  const isSystemPath = (id) => id.endsWith('.naver') || id.endsWith('.com');

  const checkId = (id) =>
    id && !BLOCKED.has(id.toLowerCase()) && !isSystemPath(id.toLowerCase()) && isValidNaverId(id);

  // body에서 blogId 추출 패턴
  const extractFromBody = (body) => {
    const patterns = [
      /"blogId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
      /blogId\s*=\s*['"]([ a-zA-Z0-9][a-zA-Z0-9_.]{2,19})['"]/,
      /window\.naver_id\s*=\s*['"]([ a-zA-Z0-9][a-zA-Z0-9_.]{2,19})['"]/,
      /data-blogid="([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
      /"ownerId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
      /"userId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
    ];
    for (const p of patterns) {
      const m = body.match(p);
      if (m && checkId(m[1].trim())) return m[1].trim().toLowerCase();
    }
    return null;
  };

  // 전략 A: blog.naver.com/my.naver 응답 body 파싱
  const idFromBody = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 10000);
    let done = false;
    const finish = (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };

    try {
      const req = net.request({ method: 'GET', url: 'https://blog.naver.com/my.naver', session: ses });
      req.setHeader('User-Agent', UA);
      req.setHeader('Accept', 'text/html,application/xhtml+xml');

      req.on('response', (res) => {
        writeLog('INFO', 'LOGIN', `net body 응답 (${res.statusCode})`, 'blog.naver.com/my.naver');
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
          // 일찍 ID 발견되면 수집 중단
          if (body.length > 500000) finish(extractFromBody(body));
        });
        res.on('end', () => finish(extractFromBody(body)));
        res.on('error', () => finish(null));
      });
      req.on('error', (e) => { writeLog('WARN', 'LOGIN', 'net body 오류', e.message); finish(null); });
      req.end();
    } catch (e) {
      writeLog('WARN', 'LOGIN', 'net body 생성 실패', e.message);
      finish(null);
    }
  });

  if (idFromBody) { writeLog('INFO', 'LOGIN', 'net body ID 추출 성공', idFromBody); return idFromBody; }

  // 전략 A-2: my.naver.com 리다이렉트 → 사용자 ID 직접 획득
  const idFromMyNaver = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 6000);
    let done = false;
    const finish = (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };

    try {
      const req = net.request({ method: 'GET', url: 'https://my.naver.com/', session: ses, redirect: 'manual' });
      req.setHeader('User-Agent', UA);
      req.setHeader('Accept', 'text/html,application/xhtml+xml');

      req.on('redirect', (statusCode, method, redirectUrl) => {
        writeLog('INFO', 'LOGIN', `my.naver redirect (${statusCode})`, redirectUrl);
        // my.naver.com/{userId} 패턴
        const m = redirectUrl.match(/my\.naver\.com\/([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})\/?(?:\?|#|$)/);
        if (m && checkId(m[1])) { finish(m[1].toLowerCase()); }
        else { try { req.followRedirect(); } catch {} }
      });
      req.on('response', (res) => {
        writeLog('INFO', 'LOGIN', `my.naver 응답 (${res.statusCode})`);
        finish(null);
      });
      req.on('error', (e) => { writeLog('WARN', 'LOGIN', 'my.naver 오류', e.message); finish(null); });
      req.end();
    } catch (e) { finish(null); }
  });

  if (idFromMyNaver) { writeLog('INFO', 'LOGIN', 'my.naver에서 ID 추출 성공', idFromMyNaver); return idFromMyNaver; }

  // 전략 A-2b: my.naver.com body에서 blogId/loginId 파싱
  const idFromMyNaverBody = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    let done = false;
    const finish = (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };

    try {
      const req = net.request({ method: 'GET', url: 'https://my.naver.com/', session: ses });
      req.setHeader('User-Agent', UA);
      req.setHeader('Accept', 'text/html,application/xhtml+xml');

      req.on('response', (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          writeLog('INFO', 'LOGIN', `my.naver body 길이`, body.length.toString());
          // JSON 패턴 우선 (내 계정 정보)
          const jsonPatterns = [
            /"loginId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
            /"userId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
            /"blogId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
            /data-nid="([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
          ];
          for (const p of jsonPatterns) {
            const m = body.match(p);
            if (m && checkId(m[1])) { return finish(m[1].toLowerCase()); }
          }
          // blog.naver.com/{id} 링크 — 가장 많이 등장하는 ID 선택
          const blogLinkRe = /["'(]https?:\/\/blog\.naver\.com\/([a-zA-Z0-9][a-zA-Z0-9_]{2,19})\/?["')\/]/g;
          const counts = {};
          let mm;
          while ((mm = blogLinkRe.exec(body)) !== null) {
            const c = mm[1].toLowerCase();
            if (checkId(c)) counts[c] = (counts[c] || 0) + 1;
          }
          const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          writeLog('INFO', 'LOGIN', 'my.naver blog 링크 후보', JSON.stringify(sorted.slice(0, 5)));
          finish(sorted.length ? sorted[0][0] : null);
        });
        res.on('error', () => finish(null));
      });
      req.on('error', (e) => { finish(null); });
      req.end();
    } catch (e) { finish(null); }
  });

  if (idFromMyNaverBody) { writeLog('INFO', 'LOGIN', 'my.naver body에서 ID 추출 성공', idFromMyNaverBody); return idFromMyNaverBody; }

  // 전략 A-3: www.naver.com HTML에서 loginId JSON 패턴 검색
  const idFromNaver = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    let done = false;
    const finish = (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };

    try {
      const req = net.request({ method: 'GET', url: 'https://www.naver.com', session: ses });
      req.setHeader('User-Agent', UA);
      req.setHeader('Accept', 'text/html,application/xhtml+xml');

      req.on('response', (res) => {
        writeLog('INFO', 'LOGIN', `naver.com body 응답 (${res.statusCode})`);
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          // 1순위: loginId / userId JSON 패턴 (내 계정)
          const JSON_PATTERNS = [
            /"loginId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
            /"userId"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
            /"id"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})".*?"type"\s*:\s*"user"/,
            /data-nid="([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})"/,
          ];
          for (const p of JSON_PATTERNS) {
            const m = body.match(p);
            if (m && checkId(m[1])) {
              writeLog('INFO', 'LOGIN', 'naver.com loginId 패턴 발견', m[1]);
              return finish(m[1].toLowerCase());
            }
          }
          finish(null);
        });
        res.on('error', () => finish(null));
      });
      req.on('error', (e) => { writeLog('WARN', 'LOGIN', 'naver.com body 오류', e.message); finish(null); });
      req.end();
    } catch (e) { finish(null); }
  });

  if (idFromNaver) { writeLog('INFO', 'LOGIN', 'naver.com에서 ID 추출 성공', idFromNaver); return idFromNaver; }

  // 전략 B: 302 리다이렉트로 blogId 추출 (Gemini 제안 URL 포함)
  const REDIRECT_URLS = [
    'https://blog.naver.com/PostList.naver?from=blog_menu',  // ← Gemini 권장 (가장 확실)
    'https://admin.blog.naver.com/',                          // ← 관리자 페이지 리다이렉트
    'https://blog.naver.com/write',
    'https://blog.naver.com/BlogMain.naver',
  ];
  for (const startUrl of REDIRECT_URLS) {
    const id = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      let done = false;
      const finish = (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } };

      try {
        const req = net.request({ method: 'GET', url: startUrl, session: ses, redirect: 'manual' });
        req.setHeader('User-Agent', UA);
        req.setHeader('Accept', 'text/html,application/xhtml+xml');

        req.on('redirect', (statusCode, method, redirectUrl) => {
          writeLog('INFO', 'LOGIN', `net redirect (${statusCode}) [${new URL(startUrl).pathname}]`, redirectUrl);
          // blog.naver.com/{userId} 패턴
          const m = redirectUrl.match(/(?:(?:admin|m)\.)?blog\.naver\.com\/([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})\/?(?:\?|#|$)/);
          if (m && checkId(m[1])) { finish(m[1].toLowerCase()); return; }
          // blogId= 쿼리 파라미터
          try {
            const u = new URL(redirectUrl);
            const bid = u.searchParams.get('blogId') || u.searchParams.get('targetId') || u.searchParams.get('blogid');
            if (bid && checkId(bid)) { finish(bid.toLowerCase()); return; }
          } catch {}
          try { req.followRedirect(); } catch {}
        });

        req.on('response', (res) => {
          writeLog('INFO', 'LOGIN', `net response (${res.statusCode}) [${new URL(startUrl).pathname}]`);
          finish(null);
        });
        req.on('error', (e) => { writeLog('WARN', 'LOGIN', 'net redirect 오류', e.message); finish(null); });
        req.end();
      } catch (e) { finish(null); }
    });

    if (id) { writeLog('INFO', 'LOGIN', 'net redirect ID 추출 성공', id); return id; }
  }

  return null;
}

// ── 네이버 로그인 창 ──────────────────────────────────────────
async function openNaverLogin() {
  return new Promise((resolve) => {
    const partition = `persist:naver-${Date.now()}`;

    const loginWin = new BrowserWindow({
      width: 500,
      height: 800,
      title: '네이버 로그인',
      resizable: true,
      webPreferences: {
        partition,
        preload: path.join(__dirname, 'login-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    loginWin.setMenuBarVisibility(false);

    // ★ 창 생성 후 세션 획득 (가장 확실한 방법)
    const ses = loginWin.webContents.session;

    const LOGIN_URL = 'https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com';
    loginWin.loadURL(LOGIN_URL).catch(err => {
      writeLog('ERROR', 'LOGIN', '로그인 URL 로드 실패', err.message);
    });

    let resolved = false;
    let processingLogin = false;
    let cookieTimer = null;
    let pollInterval = null;
    let capturedLoginId = null; // 로그인 과정 중 URL에서 캡처한 실제 네이버 ID (2026-07-04 신규)

    // 로그인 과정 중 nid.naver.com URL(기기 확인/finalize 등)에 실제 로그인 ID가
    // 평문 쿼리 파라미터(id=...)로 노출되는 경우가 있어, 이를 최우선으로 캡처한다.
    // (매 로그인마다 새 partition을 쓰므로 네이버가 항상 "새 기기"로 판단해
    // 이 확인 단계가 거의 매번 발생함 — 기존 4가지 전략보다 신뢰도가 높음)
    function extractIdFromLoginNavUrl(url) {
      try {
        if (!url.includes('nid.naver.com')) return null;
        // 1) 최상위 쿼리 파라미터로 바로 존재하는 경우 (예: deviceConfirm)
        try {
          const u = new URL(url);
          const id = u.searchParams.get('id');
          if (id && isValidNaverId(id)) return id.toLowerCase();
        } catch {}
        // 2) 다른 파라미터(url=...) 안에 인코딩되어 중첩된 경우 (예: finalize) —
        //    원문 문자열에서 id=/id%3D 패턴(이중 인코딩된 %26id%3D 포함)을 직접 탐색
        const m = url.match(/(?:[?&]id(?:=|%3D)|%26id%3D)([a-zA-Z0-9][a-zA-Z0-9_.]{2,19})(?=[&%]|$)/i);
        if (m && isValidNaverId(m[1])) return m[1].toLowerCase();
      } catch {}
      return null;
    }

    // 전체 쿠키 조회 후 naver.com 포함으로 필터
    const getNaverCookies = async () => {
      const all = await ses.cookies.get({});
      const naverNames = all.filter(c => (c.domain || '').includes('naver')).map(c => c.name).join(',');
      writeLog('INFO', 'LOGIN', `전체 쿠키 ${all.length}개, naver: [${naverNames}]`);
      return all.filter(c => (c.domain || '').includes('naver.com'));
    };

    const completeLogin = async (trigger) => {
      if (resolved || processingLogin) return;
      processingLogin = true;
      writeLog('INFO', 'LOGIN', `로그인 처리 시작 (trigger: ${trigger})`);

      try {
        // ★ 도메인 필터 없이 전체 조회 후 naver.com 포함으로 걸러냄
        const naverCookies = await getNaverCookies();
        const hasAuth = naverCookies.some(c => c.name === 'NID_AUT');
        const hasSes  = naverCookies.some(c => c.name === 'NID_SES');

        if (!hasAuth || !hasSes) {
          writeLog('INFO', 'LOGIN', `쿠키 미완성 (NID_AUT=${hasAuth}, NID_SES=${hasSes}), 대기`);
          processingLogin = false;
          return;
        }

        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
        resolved = true;
        const allCookies = naverCookies;
        writeLog('INFO', 'LOGIN', `인증 쿠키 확인 완료 (naver 쿠키 ${allCookies.length}개)`);

        writeLog('INFO', 'LOGIN', '현재 URL', loginWin.isDestroyed() ? '(destroyed)' : loginWin.webContents.getURL());

        // ID 추출 — 전략0(로그인 URL 캡처) + 기존 4단계 전략 (창 이동 없이 ses.fetch 우선)
        let naverId = null;

        // 전략0: 로그인 과정 중 URL에서 미리 캡처된 실제 ID가 있으면 최우선 사용
        // (네이버 기기 확인 절차의 URL에 로그인 ID가 평문으로 노출되는 것을 활용 —
        // 2026-07-04: 기존 4가지 전략이 모두 null이 되는 사례 확인 후 추가)
        if (capturedLoginId && isValidNaverId(capturedLoginId)) {
          naverId = capturedLoginId;
          writeLog('INFO', 'LOGIN', '전략0(로그인URL캡처)', naverId);
        }

        // 전략1: net.request 리다이렉트 추적 (가장 확실)
        if (!naverId) {
          naverId = await extractIdViaNetRedirect(ses);
          writeLog('INFO', 'LOGIN', '전략1(netRedirect)', naverId || 'null');
        }

        if (!naverId) {
          // 전략2: 현재 페이지 JS 추출
          naverId = await extractIdFromPage(loginWin);
          writeLog('INFO', 'LOGIN', '전략2(JS)', naverId || 'null');
        }

        if (!naverId) {
          naverId = await extractIdViaHiddenWindow(ses);
          writeLog('INFO', 'LOGIN', '전략3(hiddenWin)', naverId || 'null');
        }

        if (!naverId) {
          naverId = extractIdFromCookies(allCookies);
          writeLog('INFO', 'LOGIN', '전략4(쿠키)', naverId || 'null');
        }

        // 전략0 재확인 (2026-07-04): 위 1~4번이 진행되는 수 초~수십 초 동안
        // 네비게이션에서 뒤늦게 ID가 캡처됐을 수 있음 — 맨 위의 전략0 체크는
        // completeLogin 시작 시점에 딱 한 번만 확인하므로, 그 순간 아직
        // capturedLoginId가 비어 있었다면(로그인 URL 리다이렉트가 조금 늦게
        // 도착하는 경우) 놓칠 수 있었음. 임시 ID로 넘어가기 직전에 한 번 더
        // 확인해 이 타이밍 문제를 보완한다.
        if (!naverId && capturedLoginId && isValidNaverId(capturedLoginId)) {
          naverId = capturedLoginId;
          writeLog('INFO', 'LOGIN', '전략0-재확인(로그인URL캡처, 지연)', naverId);
        }

        if (!naverId) {
          naverId = `naver_${Date.now()}`;
          writeLog('WARN', 'LOGIN', 'ID 추출 실패 → 임시 ID', naverId);
        } else {
          writeLog('INFO', 'LOGIN', '최종 ID', naverId);
        }

        if (!loginWin.isDestroyed()) loginWin.close();
        resolve({ success: true, naverId, cookies: allCookies, partition });

      } catch (err) {
        writeLog('ERROR', 'LOGIN', '처리 오류', err.stack || err.message);
        processingLogin = false;
        resolved = true;
        if (!loginWin.isDestroyed()) loginWin.close();
        resolve({ success: false, error: err.message });
      }
    };

    // ★ 방법 1: NID_AUT 쿠키 저장 이벤트 감지
    ses.cookies.on('changed', (event, cookie, cause, removed) => {
      if (removed) return;
      writeLog('INFO', 'LOGIN', `쿠키 변경: ${cookie.name} @ ${cookie.domain}`);
      if (cookie.name === 'NID_AUT') {
        writeLog('INFO', 'LOGIN', 'NID_AUT 감지 → 1.5초 후 처리');
        if (cookieTimer) clearTimeout(cookieTimer);
        cookieTimer = setTimeout(() => completeLogin('cookie-event'), 1500);
      }
    });

    // ★ 방법 2: 2초 간격 폴링 (가장 확실한 백업)
    pollInterval = setInterval(async () => {
      if (resolved) { clearInterval(pollInterval); pollInterval = null; return; }
      try {
        const cookies = await ses.cookies.get({});
        const hasAuth = cookies.some(c => c.name === 'NID_AUT');
        const hasSes  = cookies.some(c => c.name === 'NID_SES');
        if (hasAuth && hasSes) {
          writeLog('INFO', 'LOGIN', `폴링 감지: NID_AUT+NID_SES 확인 (전체쿠키 ${cookies.length}개)`);
          clearInterval(pollInterval); pollInterval = null;
          completeLogin('polling');
        }
      } catch (e) {
        writeLog('WARN', 'LOGIN', '폴링 오류', e.message);
      }
    }, 2000);

    // 방법 3: 내비게이션 이벤트
    const handleNav = (_, url) => {
      writeLog('INFO', 'LOGIN', 'navigate', url);

      if (!capturedLoginId) {
        const idFromUrl = extractIdFromLoginNavUrl(url);
        if (idFromUrl) {
          capturedLoginId = idFromUrl;
          writeLog('INFO', 'LOGIN', '로그인 URL에서 실제 ID 캡처', capturedLoginId);
        }
      }

      const isPostLogin =
        url.startsWith('https://www.naver.com') ||
        url.startsWith('https://m.naver.com') ||
        url.startsWith('https://blog.naver.com') ||
        url.startsWith('https://m.blog.naver.com') ||
        (url.includes('.naver.com') &&
         !url.includes('nid.naver.com') &&
         !url.includes('static.naver') &&
         !url.includes('nidlogin'));
      if (isPostLogin) completeLogin(`navigate:${url}`);
    };

    loginWin.webContents.on('did-navigate', handleNav);
    loginWin.webContents.on('did-navigate-in-page', handleNav);

    // 방법 4: 페이지 로드 완료 + 버튼 주입
    loginWin.webContents.on('did-finish-load', async () => {
      const url = loginWin.webContents.getURL();
      writeLog('INFO', 'LOGIN', 'did-finish-load', url);

      // 모든 페이지에 "로그인 완료 확인" 버튼 주입
      try {
        await loginWin.webContents.executeJavaScript(`
          (function() {
            if (document.getElementById('__nba_done_btn__')) return;
            var btn = document.createElement('button');
            btn.id = '__nba_done_btn__';
            btn.textContent = '✅ 로그인 완료 확인';
            btn.style.cssText = [
              'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
              'padding:11px 18px', 'background:#03c75a', 'color:#fff',
              'border:none', 'border-radius:8px', 'font-size:14px',
              'font-weight:700', 'cursor:pointer',
              'box-shadow:0 2px 12px rgba(0,0,0,0.35)',
              'font-family:-apple-system,sans-serif'
            ].join(';');
            btn.onclick = function() {
              if (window.__NBA && window.__NBA.loginDone) {
                btn.textContent = '처리 중…';
                btn.disabled = true;
                window.__NBA.loginDone();
              }
            };
            document.body && document.body.appendChild(btn);
          })();
        `);
      } catch(e) {
        writeLog('WARN', 'LOGIN', '버튼 주입 실패', e.message);
      }

      const isPostLogin =
        url.startsWith('https://www.naver.com') ||
        url.startsWith('https://m.naver.com') ||
        (url.includes('.naver.com') &&
         !url.includes('nid.naver.com') &&
         !url.includes('static.naver') &&
         !url.includes('nidlogin'));
      if (isPostLogin) setTimeout(() => completeLogin(`finish-load:${url}`), 1200);
    });

    // ★ 방법 5: 버튼 클릭 시 수동 완료 (가장 확실한 폴백)
    ipcMain.once('naver:login-done', () => {
      writeLog('INFO', 'LOGIN', '사용자가 로그인 완료 버튼 클릭');
      completeLogin('manual-button');
    });

    loginWin.on('closed', () => {
      if (cookieTimer) clearTimeout(cookieTimer);
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      ipcMain.removeAllListeners('naver:login-done');
      if (!resolved) {
        resolved = true;
        writeLog('INFO', 'LOGIN', '사용자가 로그인 창 닫음');
        resolve({ success: false, cancelled: true });
      }
    });
  });
}

// ── 메인 윈도우 ─────────────────────────────────────────────
function createWindow() {
  // 마지막 창 위치/크기 복원
  const store = getStore();
  const savedBounds = store.get('windowBoundsV3', {});
  const { x, y, width = 960, height = 860 } = savedBounds;

  // 저장된 좌표가 현재 디스플레이 안에 있는지 검증
  const { screen } = require('electron');
  const allDisplays = screen.getAllDisplays();
  const isOnScreen = (typeof x === 'number' && typeof y === 'number') &&
    allDisplays.some(d =>
      x >= d.bounds.x - 100 &&
      y >= d.bounds.y - 100 &&
      x < d.bounds.x + d.bounds.width &&
      y < d.bounds.y + d.bounds.height
    );

  const mainWindow = new BrowserWindow({
    width,
    height,
    ...(isOnScreen ? { x, y } : {}),
    minWidth: 860,
    minHeight: 720,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 11 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // 2026-07-13: Windows에서 간헐적으로 창은 보이지만 키보드 포커스를
  // 못 받아 입력이 전혀 안 되는 증상 발견(재현 조건 불명, 발행과 무관하게
  // 발생). Alt+Tab으로 전환했다 돌아오면 해결되는 것으로 보아 OS 포커스
  // 전달 누락으로 추정 — 창이 화면에 표시될 준비가 됐을 때 포커스를
  // 명시적으로 한 번 더 요청해 방어. 부작용 없는 조치(이미 포커스가
  // 있으면 아무 효과 없음).
  mainWindow.once('ready-to-show', () => mainWindow.focus());

  // 창 이동/크기 변경 시 저장 (debounce 500ms)
  let boundsTimer = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
        store.set('windowBoundsV3', mainWindow.getBounds());
      }
    }, 500);
  };
  mainWindow.on('move', saveBounds);
  mainWindow.on('resize', saveBounds);

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'build', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── 자동 업데이트 (2026-07-04) ────────────────────────────────
// electron-updater가 package.json build.publish(GitHub Releases)에 설정된
// 배포 전용 공개 저장소(SH8952/naver-blog-automation-releases)를 확인해
// 새 버전이 있으면 자동으로 다운로드하고, 앱 종료 시 자동 설치한다.
// 소스코드는 별도의 비공개 저장소에 두고, 이 저장소에는 빌드된 설치 파일만
// 올라가므로 Public이어도 안전하고, 사용자가 별도 토큰을 입력할 필요가 없다.
// electron-updater가 아직 설치되지 않은 상태(npm install electron-updater 필요)
// 에서도 앱이 죽지 않도록 require를 try/catch로 감싸 실패 시 조용히 건너뛴다.
function checkForAppUpdates() {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    writeLog('INFO', 'UPDATE', 'electron-updater 미설치 — 업데이트 확인 건너뜀 (npm install electron-updater 필요)');
    return;
  }

  autoUpdater.autoDownload = true;          // 새 버전 발견 시 자동 다운로드
  autoUpdater.autoInstallOnAppQuit = true;  // 앱을 종료할 때 자동 설치(작업 중 강제 재시작 없음)

  autoUpdater.on('update-available', (info) => {
    writeLog('INFO', 'UPDATE', '새 버전 발견 — 자동 다운로드 시작', info?.version || '');
    dialog.showMessageBox({
      type: 'info',
      title: '업데이트 확인',
      message: `새 버전(${info?.version || ''})을 다운로드합니다.`,
      detail: '다운로드가 완료되면 다시 알려드립니다. 앱은 계속 사용하셔도 됩니다.',
      buttons: ['확인'],
    }).catch(() => {});
  });

  autoUpdater.on('update-not-available', () => {
    writeLog('INFO', 'UPDATE', '최신 버전 사용 중 — 업데이트 없음');
  });

  autoUpdater.on('error', (err) => {
    writeLog('WARN', 'UPDATE', '업데이트 확인/다운로드 실패', err?.message || String(err));
  });

  autoUpdater.on('update-downloaded', (info) => {
    writeLog('INFO', 'UPDATE', '업데이트 다운로드 완료', info?.version || '');
    dialog.showMessageBox({
      type: 'info',
      title: '업데이트 준비 완료',
      message: `새 버전(${info?.version || ''})이 다운로드되었습니다.`,
      detail: '지금 재시작해서 설치하거나, 나중에 앱을 종료할 때 자동으로 설치할 수 있습니다.',
      buttons: ['나중에', '지금 재시작'],
      defaultId: 1,
      cancelId: 0,
    }).then((result) => {
      if (result.response === 1) autoUpdater.quitAndInstall();
    }).catch(() => {});
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    writeLog('WARN', 'UPDATE', '업데이트 확인 중 오류', err?.message || String(err));
  });
}

app.whenReady().then(() => {
  // 앱 시작 구분선 — writeLog를 통해 기록 (파일 경로 초기화 포함)
  writeLog('INFO', 'SYSTEM', '━━━━━━━━━━━━━━━━━━ 앱 시작 ━━━━━━━━━━━━━━━━━━');
  // 2026-07-13(Windows 전용): Windows는 OS 전역 메뉴바가 없어 Electron 기본
  // 메뉴(File/Edit/View/Window/Help)가 창 안에 그대로 렌더링되어 불필요한
  // 세로 공간을 차지함. macOS는 이 메뉴가 화면 상단 OS 메뉴바에 표시되고
  // 창 내부 공간을 전혀 차지하지 않으므로 그대로 유지(영향 없음).
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null);
  }
  createWindow();
  startScheduler();
  // 앱 시작 화면이 먼저 뜨도록 약간 지연 후 업데이트 확인
  setTimeout(checkForAppUpdates, 3000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// ── IPC: 로그 파일 관련 ──────────────────────────────────────
// (2026-07-03) app:getLogPath 제거 — 렌더러에서 호출하는 곳이 없었음.
// 로그 경로는 app:readLog 응답의 path 필드로 이미 함께 반환되고 있음.
ipcMain.handle('app:openLog', async () => {
  const file = getLogFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
  await shell.openPath(file);
  return { success: true };
});

ipcMain.handle('app:clearLog', () => {
  try {
    fs.writeFileSync(getLogFile(), '', 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:readLog', () => {
  try {
    const file = getLogFile();
    if (!fs.existsSync(file)) return { success: true, content: '' };
    // 최신이 상단 — 앞에서 200줄만 반환
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return { success: true, content: lines.slice(0, 200).join('\n'), path: file };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 자동화 루프 전용 로그 (2026-07-05 신규) ────────────
ipcMain.handle('app:openLoopLog', async () => {
  const file = getLoopLogFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
  await shell.openPath(file);
  return { success: true };
});

ipcMain.handle('app:clearLoopLog', () => {
  try {
    fs.writeFileSync(getLoopLogFile(), '', 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:readLoopLog', () => {
  try {
    const file = getLoopLogFile();
    if (!fs.existsSync(file)) return { success: true, content: '' };
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return { success: true, content: lines.slice(0, 200).join('\n'), path: file };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 오류 전용 로그 (2026-07-14 신규) ────────────────────
ipcMain.handle('app:openErrorLog', async () => {
  const file = getErrorOnlyLogFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
  await shell.openPath(file);
  return { success: true };
});

ipcMain.handle('app:clearErrorLog', () => {
  try {
    fs.writeFileSync(getErrorOnlyLogFile(), '', 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:readErrorLog', () => {
  try {
    const file = getErrorOnlyLogFile();
    if (!fs.existsSync(file)) return { success: true, content: '' };
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return { success: true, content: lines.slice(0, 200).join('\n'), path: file };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 문의하기 (2026-07-14 신규) ───────────────────────────
ipcMain.handle('app:sendInquiry', (event, message) => sendInquiry(message));

// ── IPC: 공통 ────────────────────────────────────────────────
ipcMain.handle('get-app-version', () => app.getVersion());

// ── IPC: 계정 조회 ───────────────────────────────────────────
ipcMain.handle('account:getAll', () => {
  try {
    const { getDB } = require('./src/db');
    const accounts = getDB()
      .prepare(
        'SELECT id, naver_id, nickname, memo, last_login, status, loop_enabled, loop_category, naver_category FROM accounts ORDER BY id DESC'
      )
      .all();
    // 진단용 로그 (2026-07-05 추가) — 계정 목록 조회 결과(개수) + 실제 DB 파일 위치 추적용
    writeLog('INFO', 'ACCOUNT', `account:getAll 조회 성공 — ${accounts.length}개`, `userData: ${app.getPath('userData')}`);
    return { success: true, accounts };
  } catch (err) {
    // 진단용 로그 (2026-07-05 추가) — 계정 목록 조회 실패 원인 추적용
    writeLog('ERROR', 'ACCOUNT', 'account:getAll 조회 실패', err.stack || err.message);
    return { success: false, error: err.message };
  }
});

// ── IPC: 계정 추가 (로그인 창 열기) ─────────────────────────
ipcMain.handle('account:add', async () => {
  writeLog('INFO', 'ACCOUNT', '계정 추가 시작');
  try {
    const result = await openNaverLogin();

    if (!result.success) {
      if (result.cancelled) {
        writeLog('INFO', 'ACCOUNT', '사용자가 로그인 취소');
      } else {
        writeLog('ERROR', 'ACCOUNT', '로그인 실패', result.error);
      }
      return { success: false, cancelled: result.cancelled, error: result.error };
    }

    const { naverId, cookies } = result;
    writeLog('INFO', 'ACCOUNT', `로그인 성공: ${naverId}, 쿠키 ${cookies.length}개`);

    const cookiesEncrypted = encrypt(JSON.stringify(cookies));
    const lastLogin = new Date().toISOString();

    const { getDB } = require('./src/db');
    const db = getDB();

    const existing = db.prepare('SELECT id FROM accounts WHERE naver_id = ?').get(naverId);

    if (existing) {
      db.prepare(
        "UPDATE accounts SET cookies_encrypted = ?, last_login = ?, status = 'active' WHERE naver_id = ?"
      ).run(cookiesEncrypted, lastLogin, naverId);
      writeLog('INFO', 'ACCOUNT', `기존 계정 업데이트: ${naverId}`);
    } else {
      // 2026-07-14: 등급별 계정 수 제한 — 이미 등록된 계정(existing)의
      // 재로그인은 여기 도달하지 않고 위 UPDATE 분기로 빠지므로 영향 없음.
      // 여기 도달하는 건 "새로운" naver_id일 때뿐이라, 정말 계정을 추가로
      // 등록하려는 시도에만 제한이 걸린다. 로그인 자체는 이미 끝난 뒤라
      // 아깝지만, 최종 등록 직전(가장 확실한 시점)에 막는다.
      const tierLimits = await getTierLimits();
      const currentCount = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
      if (currentCount >= tierLimits.maxAccounts) {
        writeLog('WARN', 'ACCOUNT', '계정 등록 차단 — 등급별 최대 계정 수 초과', `${currentCount}/${tierLimits.maxAccounts}, tier=${tierLimits.tier}`);
        return {
          success: false,
          error: `스탠다드 등급은 계정 ${tierLimits.maxAccounts}개까지 등록할 수 있습니다. 여러 계정을 등록하려면 프리미엄으로 업그레이드하세요.`,
        };
      }
      db.prepare(
        'INSERT INTO accounts (naver_id, nickname, memo, cookies_encrypted, last_login, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(naverId, naverId, '', cookiesEncrypted, lastLogin, 'active');
      writeLog('INFO', 'ACCOUNT', `신규 계정 등록: ${naverId}`);
    }

    const account = db
      .prepare('SELECT id, naver_id, nickname, memo, last_login, status FROM accounts WHERE naver_id = ?')
      .get(naverId);

    return { success: true, account };
  } catch (err) {
    writeLog('ERROR', 'ACCOUNT', '계정 추가 오류', err.stack || err.message);
    return { success: false, error: err.message };
  }
});

// ── 카테고리 캐시 (accountId → string[]) ─────────────────────
const categoryCache = new Map();

// ── IPC: 계정 삭제 ───────────────────────────────────────────
ipcMain.handle('account:delete', (event, id) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('DELETE FROM accounts WHERE id = ?').run(id);
    categoryCache.delete(id); // 캐시도 함께 삭제
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 닉네임·메모 수정 ────────────────────────────────────
ipcMain.handle('account:update', (event, { id, nickname, memo, naver_id }) => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    if (naver_id !== undefined) {
      db.prepare('UPDATE accounts SET nickname = ?, memo = ?, naver_id = ? WHERE id = ?')
        .run(nickname ?? '', memo ?? '', naver_id, id);
    } else {
      db.prepare('UPDATE accounts SET nickname = ?, memo = ? WHERE id = ?')
        .run(nickname ?? '', memo ?? '', id);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 계정별 자동화 루프 포함/제외 토글 (2026-07-05 신규) ──
ipcMain.handle('account:setLoopEnabled', (event, { id, enabled }) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE accounts SET loop_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 계정별 자동화 루프 카테고리 배정 (2026-07-05 신규) ──
ipcMain.handle('account:setLoopCategory', (event, { id, category }) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE accounts SET loop_category = ? WHERE id = ?').run((category || '').trim(), id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 계정별 네이버 블로그 발행 카테고리 지정 (2026-07-06 신규) ──
// loop_category(글감 필터)와 별개 — 이 값은 자동화 루프 완전자동 발행 시
// publishToNaver에 그대로 전달되어 실제 네이버 블로그 카테고리 선택
// 자동화(3266행 근처 if(category) 블록)를 동작시키는 데 쓰인다.
ipcMain.handle('account:setNaverCategory', (event, { id, category }) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE accounts SET naver_category = ? WHERE id = ?').run((category || '').trim(), id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 계정별 추가 배정/네이버 카테고리 쌍 (2026-07-06 신규, 파일럿:
// skysmoga 계정만 UI 노출) — accounts.loop_category/naver_category(1번째
// 쌍)과 별개로, 계정당 최대 4개까지 추가 쌍을 저장/조회/수정/삭제한다.
const MAX_EXTRA_CATEGORY_PAIRS = 4; // 기본 1쌍 + 추가 4쌍 = 최대 5쌍

ipcMain.handle('account:getCategoryPairs', (event, accountId) => {
  try {
    const { getDB } = require('./src/db');
    const rows = getDB().prepare(
      'SELECT id, account_id, sort_order, loop_category, naver_category FROM account_category_pairs WHERE account_id = ? ORDER BY sort_order ASC, id ASC'
    ).all(accountId);
    return { success: true, pairs: rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('account:addCategoryPair', (event, accountId) => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const existing = db.prepare('SELECT COUNT(*) as cnt, COALESCE(MAX(sort_order), 0) as maxOrder FROM account_category_pairs WHERE account_id = ?').get(accountId);
    if ((existing?.cnt || 0) >= MAX_EXTRA_CATEGORY_PAIRS) {
      return { success: false, error: `최대 ${MAX_EXTRA_CATEGORY_PAIRS + 1}개(기본 1 + 추가 ${MAX_EXTRA_CATEGORY_PAIRS})까지만 추가할 수 있습니다.` };
    }
    const info = db.prepare(
      'INSERT INTO account_category_pairs (account_id, sort_order, loop_category, naver_category) VALUES (?, ?, ?, ?)'
    ).run(accountId, (existing?.maxOrder || 0) + 1, '', '');
    return { success: true, id: info.lastInsertRowid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('account:removeCategoryPair', (event, pairId) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('DELETE FROM account_category_pairs WHERE id = ?').run(pairId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('account:setCategoryPairCategory', (event, { pairId, category }) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE account_category_pairs SET loop_category = ? WHERE id = ?').run((category || '').trim(), pairId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('account:setCategoryPairNaverCategory', (event, { pairId, category }) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE account_category_pairs SET naver_category = ? WHERE id = ?').run((category || '').trim(), pairId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 설정 조회 ───────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  geminiKey: '', groqKey: '', unsplashKey: '',
  aiProvider: 'gemini',
  geminiModel: 'gemini-2.0-flash-lite',
  groqModel: 'llama-3.3-70b-versatile',
  sentenceStyle: 'auto', writingStyle: 'auto', personalExp: 'auto', tone: 'info',
  // 2026-07-14: 프리미엄 등급의 하루 최대 발행 기본값 0 = 무제한
  // (computeMaxDailyPosts 참고). 스탠다드는 등급 자체가 10회 고정이라
  // 이 값을 아예 보지 않는다. 별도 "무제한" 체크박스는 없고 값 자체로만
  // 표현한다(사용자 판단: 프리미엄은 원래 기본이 무제한이라 불필요).
  maxDailyPosts: 0, intervalMin: 30, intervalMax: 120, similarityThreshold: 70,
};

ipcMain.handle('settings:get', () => {
  try {
    const store = getStore();
    return { success: true, settings: { ...SETTINGS_DEFAULTS, ...store.get('settings', {}) } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 설정 저장 ───────────────────────────────────────────
ipcMain.handle('settings:set', (event, settings) => {
  try {
    const store = getStore();
    store.set('settings', settings);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 라이선스 조회/적용 (2026-07-04 신규 / 2026-07-13 비동기화) ──
// settings 객체 안의 licenseKey 필드로 저장하되, dot-path set을 써서
// settings:set(전체 저장)이 별도로 호출돼도 서로 값을 지우지 않게 한다.
// getLicenseStatus()가 시간조작 검사(온라인 시각 조회 포함)를 위해
// 2026-07-13부터 async가 되어, 두 핸들러 모두 await로 바꿨다.
ipcMain.handle('license:get', async () => {
  try {
    return { success: true, status: await getLicenseStatus() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('license:set', async (event, keyString) => {
  try {
    const trimmed = String(keyString || '').trim();
    const store = getStore();
    if (!trimmed) {
      store.set('settings.licenseKey', '');
      invalidateTierLimitsCache();
      return { success: true, status: await getLicenseStatus() };
    }
    const result = verifyLicenseKey(trimmed);
    if (!result.valid && !result.expired) {
      // 서명 자체가 무효/손상된 키는 저장하지 않고 오류만 반환
      return { success: false, error: result.reason || '유효하지 않은 라이선스 키입니다.' };
    }
    store.set('settings.licenseKey', trimmed);
    invalidateTierLimitsCache();
    writeLog('INFO', 'LICENSE',
      `라이선스 키 적용 — 등급:${result.tier}, 최대기기:${result.maxDevices}대, 만료:${result.expiresAt || '없음'}${result.expired ? ' (이미 만료됨)' : ''}`);
    return { success: true, status: await getLicenseStatus() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2026-07-13 신규 — 사용자가 문의할 때 알려줄 "내 기기 식별값" 조회용.
// 이 값 자체로는 아무 것도 바뀌지 않는 읽기 전용 IPC.
ipcMain.handle('license:getHwid', () => {
  try {
    return { success: true, hwid: getHardwareId() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2026-07-14 신규 — 등급별 사용 제한값 조회(렌더러가 버튼 비활성화 여부를
// 판단하는 데 사용). 실제 차단은 각 IPC 핸들러 내부에서도 별도로 수행하므로
// (백엔드가 최종 보안 경계), 이 IPC는 어디까지나 프론트 UI 표시용이다.
ipcMain.handle('license:getLimits', async () => {
  try {
    return { success: true, limits: await getTierLimits() };
  } catch (err) {
    // 조회 실패 시에도 UI가 깨지지 않도록 가장 보수적인(스탠다드) 기본값 반환
    return {
      success: false, error: err.message,
      limits: {
        tier: 'standard', isPremium: false, maxAccounts: 1,
        automationLoop: false, reservation: false, thumbnail: false,
        keywordResearch: false, maxDailyPosts: 10,
      },
    };
  }
});

// ── 개발자 전용 등급 강제 전환 (2026-07-14 신규) ────────────────
// 사이드바의 ST/PR/개발 토글에서 사용. main.js가 패키징된 배포판으로
// 실행될 때는 isDev가 항상 false이므로, 아래 두 핸들러는 무조건
// success:false로 즉시 거부한다 — 배포판에서는 이 기능 자체가 존재하지
// 않는 것과 동일하게 동작(프론트 UI도 process.env.NODE_ENV==='development'
// 가드로 빌드 자체에서 빠지므로 애초에 이 IPC를 호출할 코드가 없음 —
// 이건 그 위에 얹는 2차 방어선).
ipcMain.handle('dev:getTierOverride', () => {
  if (!isDev) return { success: false, error: '개발 모드 전용 기능입니다.' };
  try {
    return { success: true, override: getStore().get('settings._devTierOverride', null) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dev:setTierOverride', (event, value) => {
  if (!isDev) return { success: false, error: '개발 모드 전용 기능입니다.' };
  try {
    const allowed = ['standard', 'premium', null];
    const v = allowed.includes(value) ? value : null;
    getStore().set('settings._devTierOverride', v);
    invalidateTierLimitsCache();
    writeLog('INFO', 'DEV', `등급 강제 오버라이드 변경: ${v === null ? '개발(실제 라이선스 로직)' : v}`);
    return { success: true, override: v };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── 자동화 루프 설정 (2026-07-05 신규) ────────────────────────
// settings:set(전체 저장)이 별도로 호출돼도 서로 값을 지우지 않도록,
// licenseKey와 마찬가지로 dot-path 전용 IPC로 분리 저장/조회한다.
const DEFAULT_LOOP_SETTINGS = {
  accountMode: 'single',        // 'single' | 'multi'
  singleAccountId: null,        // accountMode='single'일 때 사용할 계정 id
  cycleMode: 'count',           // 'count' | 'duration'
  cycleCount: 3,                 // cycleMode='count'일 때 총 실행 사이클 수
  cycleDurationHours: 4,          // cycleMode='duration'일 때 총 실행 시간(시간)
  keywordExhaustion: 'refill',    // 'refill'(트렌드 자동 보충) | 'notify'(중단+알림)
  pcShutdownOnExhaustion: false,  // 완전자동에서 키워드 소진 시 PC 종료 여부
};
const LOOP_SHUTDOWN_COUNTDOWN_SEC = 60; // 사용자 확인(2026-07-05): 60초 고정

ipcMain.handle('automationLoop:getSettings', () => {
  try {
    const store = getStore();
    return { success: true, settings: { ...DEFAULT_LOOP_SETTINGS, ...store.get('settings.automationLoop', {}) } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('automationLoop:setSettings', (event, settings) => {
  try {
    const store = getStore();
    const merged = { ...DEFAULT_LOOP_SETTINGS, ...store.get('settings.automationLoop', {}), ...settings };
    store.set('settings.automationLoop', merged);
    return { success: true, settings: merged };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: Gemini API 테스트 ────────────────────────────────────
ipcMain.handle('settings:testGemini', async (event, apiKey) => {
  if (!apiKey) return { ok: false, error: 'API 키 없음' };
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: Unsplash API 테스트 ──────────────────────────────────
ipcMain.handle('settings:testUnsplash', async (event, apiKey) => {
  if (!apiKey) return { ok: false, error: 'API 키 없음' };
  try {
    const res = await fetch('https://api.unsplash.com/photos/random?count=1', {
      headers: { Authorization: `Client-ID ${apiKey}` },
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── 글 생성 프롬프트 공통 조각 (2026-07-07: 중복 프롬프트 정리) ───────
// 여러 생성/재생성 분기에 토씨 하나 안 틀리고 반복되던 문구를 상수로 분리.
// 규칙이 여러 곳에 중복될수록 서로 미세하게 어긋난 버전이 늘어나 AI가 헷갈릴
// 여지가 커진다는 판단 하에, 페르소나 문장과 제목 작성 규칙만 공통화함.
const AI_PERSONA = '당신은 한국어로만 글을 쓰는 네이버 블로그 SEO 전문 작가입니다. 반드시 한글만 사용하세요.';
const TITLE_RULE_BLOCK = `- [제목 작성 규칙 - SEO 최적화]
  · 제목 구성 공식: [핵심 키워드] + [타겟층·상황] + [매력적인 후킹 포인트] 조합으로 작성
  · 핵심 키워드는 반드시 제목 앞부분에 배치할 것
  · 길이는 30~50자
  · 예: "[핵심 키워드] 완벽 정리, 초보자도 쉽게 따라 하는 방법"`;

// 2026-07-08 신규: 제목/도입부/본문/마무리/썸네일 문구 전체에 공통으로
// 적용되는 "AI스러운 표현 금지" 규칙. 사용자가 실제 생성 결과에서 "모든
// 것" 같은 상투적 표현이 반복된다고 지적 — 기존에는 "~해드릴게요",
// "물론입니다" 정도만 예시로 들었는데 너무 짧아 효과가 약했던 것으로
// 판단, 구체적인 금지어 목록을 늘리고 모든 프롬프트 분기(전체 생성,
// 제목 재생성, 썸네일 문구 재생성, intro/body/conclusion 재생성)에서
// 공유하도록 모듈 레벨 상수로 승격.
const AI_CLICHE_BAN = `- [AI스러운 상투적 표현 금지 - 절대 준수] 아래와 같은 AI 특유의 뻔하고 과장된
  표현은 사용하지 말 것 — 실제 경험자가 구체적으로 설명하듯 자연스럽게 작성
  · 금지 표현(예시): "모든 것", "여러분", "이 글을 통해", "다시 한 번 강조하지만",
    "정리해보면", "결론적으로", "무엇보다도", "~해드릴게요", "물론입니다",
    "다양한 방법이 있습니다", "다양하게 활용할 수 있습니다"
  · 위 표현을 쓰고 싶어질 때는 대신 구체적인 대상・숫자・사례・방법을 직접 언급할 것`;

// 본문(body)의 3단계 구조 개수 고정 규칙 — 전체 생성 / 본문 단독 재생성에만
// 사용. intro·conclusion 재생성 시에는 "## 소제목 1개 + 문단"만 허용되므로
// 이 규칙까지 같이 보내면 서로 맞지 않는 지시가 섞여 혼란을 줄 수 있어
// commonInstructions에서 분리함(2026-07-07, 중복/불필요 프롬프트 정리).
// 2026-07-07 추가: generatePostContent()의 구조 보정 재시도 프롬프트에서도
// 재사용하기 위해 buildPrompt() 밖 모듈 레벨 상수로 승격.
const structureCountRule = `
  · [필수 - 구조 개수 고정, 반드시 지킬 것 — 2026-07-07 개수 재조정]
    - 본문은 대분류(##)를 정확히 2개로 구성
    - 각 대분류(##) 바로 아래에는 중분류(###)를 정확히 2개
    - 각 중분류(###) 바로 아래에는 소분류(####)를 정확히 1개
    - [필수] 대분류(##) 제목 바로 다음 줄에는 중분류(###)로 넘어가기 전에
      반드시 최소 1문장 이상의 짧은 도입 문단(마크다운 기호 없는 순수
      텍스트)을 먼저 작성할 것 — 대분류 제목 바로 아래에서 곧바로
      중분류가 시작되는 구조는 금지
    - 각 소분류(####) 바로 아래에는 반드시 최소 2문장 이상의 본문 문단
      (마크다운 기호 없는 순수 텍스트, 필요시 불릿 ▪ 병행 가능)이 뒤따라야 함
    - [SEO] 대분류/중분류 제목에는 가능한 한 관련 키워드(연관 검색어)를
      자연스럽게 포함시킬 것 (예: "○○란 무엇인가요?", "○○ 활용하는 핵심
      방법" 형태 — 단순 주제어 나열이 아니라 키워드가 포함된 문장형으로 작성)
  · [중요] 대분류(##)/중분류(###)/소분류(####) 제목은 절대로 내용 없이
    다음 제목으로 바로 넘어가지 말 것 — 제목만 덩그러니 있고 그 아래
    아무 내용 없이 다음 제목이 시작되는 구조는 금지`;

// ── Gemini 프롬프트 빌더 ─────────────────────────────────────
function buildPrompt({ topic, keywords, tone, writingStyle, personalExp, sentenceStyle, targetMin, targetMax, section, currentResult }) {
  const toneMap    = { info: '정보형(객관적 사실 중심)', daily: '일상형(친근하고 편안한 말투)', review: '리뷰형(장단점 분석)', emotional: '감성형(감정 표현 풍부)' };
  const styleMap   = { auto: '구어체와 문어체를 자연스럽게 혼합', colloquial: '구어체 위주(~했어요, ~인데요)', formal: '문어체 위주(~합니다, ~됩니다)' };
  const expMap     = { auto: '자연스럽게 적당히 삽입', many: '많이 삽입(리뷰 느낌)', few: '최소한으로 삽입', none: '경험담 없이 순수 정보 중심' };
  const sentMap    = { auto: '짧은 문장과 긴 문장을 랜덤하게 혼합', short: '짧은 문장 위주로 템포감 있게', long: '긴 문장 위주로 상세하게' };
  const kwStr      = keywords && keywords.length ? keywords.join(', ') : '없음';

  const commonInstructions = `
- [언어 규칙 - 절대 최우선 준수, 위반 시 전체 거부]
  · 반드시 순수 한국어(한글)로만 작성할 것 — 예외 없음
  · 영어 단어·표현·약어 완전 금지 (예: "OK", "tip", "point", "style" 등 모두 금지)
  · 베트남어·일본어·중국어·기타 외국어 완전 금지 (예: rát, được, の, 的 등)
  · 한자(漢字) 완전 금지 — 음독·훈독 모두 금지
  · 외래어는 반드시 한글 표기 (이미 한국어화 된 단어만 허용: 예 커피, 택시)
  · 알파벳·악센트 문자(à á â ã ä å 등) 완전 금지
- [구조 형식 - 3단계 제목 체계, 반드시 줄 시작에 작성]
  · 대분류: ## 제목명   (색상 박스로 표시됨)
  · 중분류: ### 제목명  (회색 박스로 표시됨)
  · 소분류: #### 제목명 (밑줄 텍스트로 표시됨)
  · 불릿: ▪ 내용       (줄 시작에 ▪ 한 칸 띄고 내용)
  · 일반 문단: 마크다운 기호 없이 순수 한글 텍스트
  · **, \`, —, *, _ 기호 절대 사용 금지 (## ### #### ▪ 만 허용)
  · 제목 마커(## ### ####)는 반드시 줄의 맨 앞에 단독으로 작성할 것
- 글 톤: ${toneMap[tone] || toneMap.info}
- 문체: ${styleMap[writingStyle] || styleMap.auto}
- 개인 경험담: ${expMap[personalExp] || expMap.auto}
- 문장 길이: ${sentMap[sentenceStyle] || sentMap.auto}
- 주요 키워드: ${kwStr}
- [키워드 삽입 규칙 - 필수] 위 키워드 각각을 글 전체에 최소 3~5회 이상 자연스럽게
  삽입하며, 전체 분량 대비 키워드 밀도는 3~5% 내외를 유지할 것
  · 도입부(intro)는 첫 100자 이내에 핵심 키워드를 최소 1회 자연스럽게 포함할 것
  · 제목, 도입부, 본문 소제목, 본문 내용, 마무리에 골고루 분산
  · 키워드 그대로 또는 조사 결합 등 자연스럽게 활용
- [마무리 작성 규칙 - SEO] 마무리(conclusion) 문단에는 핵심 키워드를 다시 한 번
  자연스럽게 언급하고, 마지막 문장은 독자의 댓글・공감을 유도하는 질문형
  문장으로 마무리할 것
${AI_CLICHE_BAN}
- JSON 형식으로만 응답할 것`;

  // 본문(body)의 3단계 구조 개수 고정 규칙은 모듈 레벨 structureCountRule
  // 상수를 사용(2026-07-07: generatePostContent()의 구조 보정 재시도에서도
  // 재사용하기 위해 이 함수 밖으로 승격 — 값은 그대로, 정의 위치만 이동).

  if (!section) {
    // 전체 생성
    return `${AI_PERSONA}
주제 "${topic}"에 대한 블로그 글을 작성해 주세요.

요구사항:
${commonInstructions}${structureCountRule}
- [글자수 규칙 - 절대 준수] 전체 글자수(공백 제외): ${targetMin}~${targetMax}자
  · intro(도입부): 최소 ${Math.round(targetMin * 0.15)}자 이상
  · body(본문): 최소 ${Math.round(targetMin * 0.6)}자 이상 — 핵심 내용이므로 충분히 상세하게
  · conclusion(마무리): 최소 ${Math.round(targetMin * 0.1)}자 이상
  · 각 섹션을 유익한 내용으로 충분히 채울 것 (같은 말 반복 금지)
${TITLE_RULE_BLOCK}
- 해시태그: 주제/키워드 관련 20~30개 생성 (한글 해시태그)

다음 JSON 형식으로만 응답하세요 (모든 값은 반드시 순수 한국어):
{
  "title": "SEO 최적화된 제목 (30~50자, 한글만)",
  "thumbText": "썸네일 이미지에 들어갈 별도 문구 — 공백 제외 글자 수를 반드시 세어서 정확히 18~20자 범위로 작성(17자 이하·21자 이상 금지), 핵심 키워드 최소 1개 포함, 제목과 똑같은 문장이 아니라 더 짧고 임팩트 있게 축약, 마크다운 기호 없는 한 줄 평문, 한글만",
  "intro": "도입부 — ## 대분류 소제목과 문단으로 구성 (한글만, 외국어·한자 금지)",
  "body": "본문 — ## 대분류, ### 중분류, #### 소분류, ▪ 불릿으로 3단계 구조화 (한글만)",
  "conclusion": "마무리 — ## 대분류 소제목과 문단으로 구성 (한글만, 외국어·한자 금지)",
  "hashtags": ["#한글해시태그1", "#한글해시태그2", ...],
  "links": [
    {"name": "사이트이름1", "url": "https://..."},
    {"name": "사이트이름2", "url": "https://..."},
    {"name": "사이트이름3", "url": "https://..."}
  ]
}
links는 주제와 직접 관련된 공식 사이트·정부기관·뉴스·가이드 사이트를 3~5개 포함하세요. 실제로 존재하는 URL만 사용하세요.`;
  } else if (section === 'title') {
    // 제목 재생성 — 도입부/본문/마무리와 달리 제목은 구조(##/###/▪) 없이
    // 줄바꿈 없는 한 줄 평문이어야 함(2026-07-03: commonInstructions의
    // 구조 지시를 그대로 물려받아 AI가 제목에도 소제목·불릿을 넣어버리는
    // 버그 확인 후 전용 분기 분리).
    const ctx = currentResult ? `현재 글 제목: "${currentResult.title}"` : '';
    return `${AI_PERSONA}
주제 "${topic}"에 대한 블로그 글의 "제목"만 새로 작성해 주세요.
${ctx}

요구사항:
- [언어 규칙 - 절대 최우선 준수] 반드시 순수 한국어(한글)로만 작성 — 영어·한자·기타 외국어 완전 금지
- [형식 규칙 - 절대 준수] 마크다운 기호(## ### #### ▪ ** \` — * _ 등) 절대 사용 금지 —
  결과는 줄바꿈 없는 한 줄의 평문 제목이어야 함
${TITLE_RULE_BLOCK}
- 주요 키워드: ${kwStr} — 최소 1개 이상 자연스럽게 포함
${AI_CLICHE_BAN}
- JSON 형식으로만 응답

다음 JSON 형식으로만 응답하세요:
{ "text": "새로 작성한 제목 (한글만, 마크다운 기호 없는 한 줄 평문)" }`;
  } else if (section === 'thumbText') {
    // 2026-07-08 신규: 썸네일 이미지에 들어가는 문구를 제목과 별도로
    // 재생성. 제목과 마찬가지로 마크다운 없는 한 줄 평문이어야 하지만,
    // 길이 제약(18~20자)과 "제목의 축약이 아니라 더 짧고 임팩트 있게"라는
    // 지시가 추가로 필요해 title과 분리된 전용 분기로 둠.
    const ctx = currentResult ? `현재 글 제목: "${currentResult.title}"${currentResult.thumbText ? `\n현재 썸네일 문구: "${currentResult.thumbText}"` : ''}` : '';
    return `${AI_PERSONA}
주제 "${topic}"에 대한 블로그 글의 "썸네일 이미지에 들어갈 문구"만 새로 작성해 주세요.
${ctx}

요구사항:
- [언어 규칙 - 절대 최우선 준수] 반드시 순수 한국어(한글)로만 작성 — 영어·한자·기타 외국어 완전 금지
- [형식 규칙 - 절대 준수] 마크다운 기호(## ### #### ▪ ** \` — * _ 등) 절대 사용 금지 —
  결과는 줄바꿈 없는 한 줄의 평문이어야 함
- [길이 규칙 - 이 요청에서 가장 중요한 규칙, 반드시 지킬 것] 공백을 제외한
  글자 수가 정확히 18~20자여야 합니다. 문구를 작성한 뒤 공백을 뺀 글자 수를
  스스로 세어 18~20자 범위인지 반드시 확인하고, 범위를 벗어나면 범위 안에
  들 때까지 고쳐 쓴 다음 최종 문구만 응답하세요. 17자 이하이거나 21자 이상인
  응답은 전부 잘못된 답변입니다.
- 제목을 그대로 줄이거나 복사하지 말고, 더 짧고 임팩트 있는 별도 문구로 작성할 것
- 주요 키워드: ${kwStr} — 최소 1개 이상 반드시 포함
${AI_CLICHE_BAN}
- JSON 형식으로만 응답

다음 JSON 형식으로만 응답하세요:
{ "text": "새로 작성한 썸네일 문구 (한글만, 공백 포함 18~20자, 마크다운 기호 없는 한 줄 평문)" }`;
  } else {
    // 섹션별 재생성 (intro/body/conclusion)
    const sectionMap = { intro: '도입부', body: '본문', conclusion: '마무리' };
    const ctx = currentResult ? `현재 글 제목: "${currentResult.title}"` : '';
    // 전체 생성 시에는 도입부/마무리 = "## 소제목 + 문단"만, 본문 = "##/###/####/▪ 3단계
    // 구조"로 섹션마다 다르게 지시하지만, commonInstructions는 4단계 구조를 전부 "허용된
    // 형식"으로만 안내할 뿐 섹션별 제한이 없다. 그래서 도입부만 재생성하면 AI가 본문
    // 스타일(### 소제목·▪ 불릿)을 섞어 넣는 문제가 있었음(2026-07-03 확인) — 섹션별로
    // 전체 생성 때와 동일한 구조 제한을 재생성 프롬프트에도 명시해 방지.
    const structureNote = (section === 'intro' || section === 'conclusion')
      ? `\n- [이 섹션 전용 형식 제한 - 절대 준수] "${sectionMap[section]}"는 ## 대분류 소제목 1개와 문단들로만 구성할 것 — ### #### 소제목이나 ▪ 불릿은 본문(body)에서만 쓰는 형식이므로 이 섹션에는 사용하지 말 것`
      : '';
    const responseHint = section === 'body'
      ? '## 대분류·### 중분류·#### 소분류·▪ 불릿 3단계 구조 포함'
      : '## 대분류 소제목과 문단으로만 구성 (### #### ▪ 사용 금지)';
    // body 재생성만 구조 개수 고정 규칙 포함 — intro/conclusion은 애초에
    // 소제목 1개+문단 구조라 이 규칙이 적용될 여지가 없고, 같이 보내면
    // 서로 안 맞는 지시가 섞여 혼란만 준다.
    const countRule = section === 'body' ? structureCountRule : '';
    return `${AI_PERSONA}
주제 "${topic}"의 블로그 글에서 "${sectionMap[section]}" 부분만 새로 작성해 주세요.
${ctx}

요구사항:
${commonInstructions}${countRule}${structureNote}

다음 JSON 형식으로만 응답하세요 (값은 반드시 한국어):
{ "text": "새로 작성한 ${sectionMap[section]} 내용 (한글만, ${responseHint})" }`;
  }
}

// ── Gemini API 호출 ──────────────────────────────────────────
// JSON 문자열 내부의 제어문자를 이스케이프 (Llama 모델 출력 수리용)
function repairJsonControlChars(str) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
      if (code < 32)  { continue; } // 나머지 제어문자 제거
    }
    result += ch;
  }
  return result;
}

function tryParse(str) {
  try { return JSON.parse(str); } catch {}
  try { return JSON.parse(repairJsonControlChars(str)); } catch {}
  return null;
}

function parseAIText(raw) {
  writeLog('INFO', 'AI', `응답 파싱 시작 (${raw.length}자): ${raw.slice(0, 120).replace(/\n/g, ' ')}`);

  // 1) <think>...</think> 제거 (Llama 계열 Chain-of-Thought)
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2) ```json ... ``` 코드 블록
  let m = text.match(/```json\s*([\s\S]*?)```/);
  if (m) { const r = tryParse(m[1].trim()); if (r) return r; }

  // 3) ``` ... ``` (언어 없는 코드 블록)
  m = text.match(/```\s*([\s\S]*?)```/);
  if (m) { const r = tryParse(m[1].trim()); if (r) return r; }

  // 4) { ... } 전체
  m = text.match(/(\{[\s\S]*\})/);
  if (m) { const r = tryParse(m[1]); if (r) return r; }

  // 5) 원문 전체
  const r = tryParse(text);
  if (r) return r;

  writeLog('ERROR', 'AI', `JSON 파싱 실패`, text.slice(0, 300));
  throw new Error(`AI 응답을 JSON으로 파싱할 수 없습니다.\n오류: Bad control character in JSON`);
}

function callGemini(apiKey, prompt, model, maxOutputTokens = 8192) {
  return new Promise((resolve, reject) => {
    try {
      const payload = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens },
      });

      const req = net.request({
        method: 'POST',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      });
      req.setHeader('Content-Type', 'application/json');

      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode !== 200) {
              const msg = data.error?.message || `HTTP ${res.statusCode}`;
              if (res.statusCode === 401 || res.statusCode === 403) return reject(new Error(`Gemini 인증 오류: ${msg}\n환경설정에서 API 키를 확인해 주세요.`));
              return reject(new Error(`Gemini 오류 [${model}]: ${msg}\n할당량 초과 시 환경설정에서 다른 모델이나 Groq로 전환하세요.`));
            }
            resolve(parseAIText(data.candidates?.[0]?.content?.parts?.[0]?.text || ''));
          } catch (e) {
            reject(new Error(`Gemini 응답 파싱 오류: ${e.message}`));
          }
        });
      });
      req.on('error', (err) => reject(new Error(`Gemini 네트워크 오류: ${err.message}`)));
      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Groq API 호출 (OpenAI 호환) ──────────────────────────────
const GROQ_MODELS = {
  'llama-3.3-70b-versatile': { rpm: 30,  rpd: 1000,  tpd: 100000, label: 'Llama 3.3 70B (고품질)' },
  'llama-3.1-8b-instant':    { rpm: 30,  rpd: 14400, tpd: 500000, label: 'Llama 3.1 8B (빠름, 폴백1)' },
  'gemma2-9b-it':            { rpm: 30,  rpd: 14400, tpd: 500000, label: 'Gemma2 9B (폴백2)' },
};

function callGroq(apiKey, prompt, model = 'llama-3.3-70b-versatile', maxOutputTokens = 8192) {
  return new Promise((resolve, reject) => {
    try {
      const payload = JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: maxOutputTokens,
      });

      const req = net.request({ method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions' });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Authorization', `Bearer ${apiKey}`);

      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode !== 200) {
              const msg = data.error?.message || `HTTP ${res.statusCode}`;
              if (res.statusCode === 401) return reject(new Error(`Groq 인증 오류: ${msg}\n환경설정에서 Groq API 키를 확인해 주세요.`));
              return reject(new Error(`Groq 오류: ${msg}`));
            }
            resolve(parseAIText(data.choices?.[0]?.message?.content || ''));
          } catch (e) {
            reject(new Error(`Groq 응답 파싱 오류: ${e.message}`));
          }
        });
      });
      req.on('error', (err) => reject(new Error(`Groq 네트워크 오류: ${err.message}`)));
      req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── OpenAI API 호출 ──────────────────────────────────────────
function callOpenAI(apiKey, prompt, model = 'gpt-4o', maxOutputTokens = 8192) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxOutputTokens,
      temperature: 0.7,
    });
    const req = net.request({
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
    });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('Authorization', `Bearer ${apiKey}`);
    let raw = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { raw += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) { reject(new Error(json.error.message || 'OpenAI 오류')); return; }
          resolve(parseAIText(json.choices?.[0]?.message?.content || ''));
        } catch (e) { reject(new Error('OpenAI 응답 파싱 실패: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Claude API 호출 ──────────────────────────────────────────
function callClaude(apiKey, prompt, model = 'claude-sonnet-4-6', maxOutputTokens = 8192) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = net.request({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
    });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('x-api-key', apiKey);
    req.setHeader('anthropic-version', '2023-06-01');
    let raw = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { raw += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) { reject(new Error(json.error.message || 'Claude 오류')); return; }
          resolve(parseAIText(json.content?.[0]?.text || ''));
        } catch (e) { reject(new Error('Claude 응답 파싱 실패: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 통합 AI 호출 라우터 ───────────────────────────────────────
async function callAI(prompt, maxOutputTokens = 8192) {
  const store    = getStore();
  const provider = store.get('settings.aiProvider', 'gemini');

  if (provider === 'openai') {
    const apiKey = (store.get('settings.openaiKey', '') || '').trim();
    const model  = store.get('settings.openaiModel', 'gpt-4o');
    if (!apiKey) throw new Error('OpenAI API 키가 설정되지 않았습니다.\n환경설정에서 키를 입력해 주세요.');
    return callOpenAI(apiKey, prompt, model, maxOutputTokens);
  }

  if (provider === 'claude') {
    const apiKey = (store.get('settings.claudeKey', '') || '').trim();
    const model  = store.get('settings.claudeModel', 'claude-sonnet-4-6');
    if (!apiKey) throw new Error('Claude API 키가 설정되지 않았습니다.\n환경설정에서 키를 입력해 주세요.');
    return callClaude(apiKey, prompt, model, maxOutputTokens);
  }

  if (provider === 'groq') {
    const apiKey = (store.get('settings.groqKey', '') || '').trim();
    const primaryModel = store.get('settings.groqModel', 'llama-3.3-70b-versatile');
    if (!apiKey) throw new Error('Groq API 키가 설정되지 않았습니다.\n환경설정에서 키를 입력해 주세요.');

    // 모델 폴백 순서: 설정 모델 → llama-3.1-8b-instant → gemma2-9b-it
    const fallbackChain = [primaryModel];
    if (primaryModel !== 'llama-3.1-8b-instant') fallbackChain.push('llama-3.1-8b-instant');
    if (!fallbackChain.includes('gemma2-9b-it'))  fallbackChain.push('gemma2-9b-it');

    let lastErr = null;
    for (const model of fallbackChain) {
      const effectiveMax = model === 'llama-3.1-8b-instant'
        ? Math.min(maxOutputTokens, 4000)
        : maxOutputTokens;
      try {
        const result = await callGroq(apiKey, prompt, model, effectiveMax);
        if (model !== primaryModel) writeLog('WARN', 'AI', `폴백 모델 사용: ${model}`);
        return result;
      } catch (e) {
        const isRateLimit = /rate.limit|429|quota|limit reached/i.test(e.message);
        writeLog('WARN', 'AI', `Groq [${model}] 오류`, e.message.slice(0, 120));
        lastErr = e;
        if (!isRateLimit) throw e;  // rate limit이 아닌 오류는 즉시 전파
        // rate limit이면 다음 모델로
      }
    }
    // 모든 모델 실패
    throw new Error(`Groq 일일 한도 초과 (모든 모델 시도 완료)\n잠시 후 다시 시도하거나 Gemini로 전환하세요.\n\n원인: ${lastErr?.message?.slice(0, 100) || ''}`);
  }

  // 기본: Gemini
  const apiKey = (store.get('settings.geminiKey', '') || '').trim();
  const model  = store.get('settings.geminiModel', 'gemini-2.0-flash-lite');
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.\n환경설정에서 키를 입력해 주세요.');
  return callGemini(apiKey, prompt, model, maxOutputTokens);
}

// ── IPC: Groq API 테스트 ─────────────────────────────────────
ipcMain.handle('settings:testGroq', (event, apiKey) => {
  if (!apiKey) return { ok: false, error: 'API 키 없음' };
  const key = apiKey.trim();
  writeLog('INFO', 'GROQ', `테스트 시작 — 키 길이: ${key.length}, 접두사: ${key.slice(0, 8)}`);
  return new Promise((resolve) => {
    try {
      const req = net.request({ method: 'GET', url: 'https://api.groq.com/openai/v1/models' });
      req.setHeader('Authorization', `Bearer ${key}`);
      req.setHeader('Accept', 'application/json');

      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true });
          } else {
            let msg = `HTTP ${res.statusCode}`;
            try { msg = JSON.parse(body)?.error?.message || msg; } catch {}
            writeLog('WARN', 'GROQ', `테스트 실패 ${res.statusCode}`, msg);
            resolve({ ok: false, error: msg });
          }
        });
      });
      req.on('error', (err) => {
        writeLog('ERROR', 'GROQ', '테스트 네트워크 오류', err.message);
        resolve({ ok: false, error: err.message });
      });
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
});

// ── IPC: OpenAI API 테스트 ───────────────────────────────────
ipcMain.handle('settings:testOpenai', (event, apiKey) => {
  if (!apiKey) return { ok: false, error: 'API 키 없음' };
  const key = apiKey.trim();
  return new Promise((resolve) => {
    try {
      const req = net.request({ method: 'GET', url: 'https://api.openai.com/v1/models' });
      req.setHeader('Authorization', `Bearer ${key}`);
      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) { resolve({ ok: true }); }
          else {
            let msg = `HTTP ${res.statusCode}`;
            try { msg = JSON.parse(body)?.error?.message || msg; } catch {}
            resolve({ ok: false, error: msg });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.end();
    } catch (err) { resolve({ ok: false, error: err.message }); }
  });
});

// ── IPC: Claude API 테스트 ───────────────────────────────────
ipcMain.handle('settings:testClaude', (event, apiKey) => {
  if (!apiKey) return { ok: false, error: 'API 키 없음' };
  const key = apiKey.trim();
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
      const req = net.request({ method: 'POST', url: 'https://api.anthropic.com/v1/messages' });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('x-api-key', key);
      req.setHeader('anthropic-version', '2023-06-01');
      let raw = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { raw += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) { resolve({ ok: true }); }
          else {
            let msg = `HTTP ${res.statusCode}`;
            try { msg = JSON.parse(raw)?.error?.message || msg; } catch {}
            resolve({ ok: false, error: msg });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(body);
      req.end();
    } catch (err) { resolve({ ok: false, error: err.message }); }
  });
});

// ── IPC: 네이버 Open API 테스트 ─────────────────────────────
ipcMain.handle('settings:testNaverApi', (event, clientId, clientSecret) => {
  if (!clientId || !clientSecret) return { ok: false, error: 'ID 또는 Secret 없음' };
  return new Promise((resolve) => {
    try {
      const req = net.request({ method: 'GET', url: 'https://openapi.naver.com/v1/search/blog.json?query=test&display=1' });
      req.setHeader('X-Naver-Client-Id', clientId.trim());
      req.setHeader('X-Naver-Client-Secret', clientSecret.trim());
      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) { resolve({ ok: true }); }
          else {
            let msg = `HTTP ${res.statusCode}`;
            try { msg = JSON.parse(body)?.errorMessage || msg; } catch {}
            resolve({ ok: false, error: msg });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.end();
    } catch (err) { resolve({ ok: false, error: err.message }); }
  });
});

// ── IPC: 네이버 검색광고 API 테스트 ──────────────────────────
ipcMain.handle('settings:testSearchAd', (event, customerId, apiKey, secretKey) => {
  if (!customerId || !apiKey || !secretKey) return { ok: false, error: '필드 누락' };
  return new Promise((resolve) => {
    try {
      const crypto = require('crypto');
      const timestamp = Date.now().toString();
      const method = 'GET';
      const path = '/keywordstool';
      const message = `${timestamp}.${method}.${path}`;
      const signature = crypto.createHmac('sha256', secretKey.trim()).update(message).digest('base64');
      const url = 'https://api.searchad.naver.com/keywordstool?hintKeywords=테스트&showDetail=1';
      const req = net.request({ method, url });
      req.setHeader('X-Timestamp', timestamp);
      req.setHeader('X-API-KEY', apiKey.trim());
      req.setHeader('X-Customer', customerId.trim());
      req.setHeader('X-Signature', signature);
      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) { resolve({ ok: true }); }
          else {
            let msg = `HTTP ${res.statusCode}`;
            try { msg = JSON.parse(body)?.message || msg; } catch {}
            resolve({ ok: false, error: msg });
          }
        });
      });
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.end();
    } catch (err) { resolve({ ok: false, error: err.message }); }
  });
});

// ── IPC: 키워드 자동 생성 (항상 Groq llama-3.1-8b-instant 사용 — 14.4K RPD) ──
ipcMain.handle('post:suggestKeywords', async (event, { topic }) => {
  try {
    const store   = getStore();
    const groqKey = (store.get('settings.groqKey', '') || '').trim();
    const prompt  = `당신은 네이버 블로그 SEO 전문가입니다.
주제 "${topic}"에 대해 네이버 검색에 최적화된 키워드 10~15개를 추천해주세요.

조건:
- 실제 사람들이 네이버에서 검색할 법한 구체적인 키워드
- 핵심 키워드(짧고 검색량 높은 것) + 롱테일 키워드(구체적인 것) 혼합
- 한 키워드는 1~5단어 이내
- AI 설명 문구 없이 키워드 배열만 응답

다음 JSON 형식으로만 응답하세요:
{ "keywords": ["키워드1", "키워드2", "키워드3", ...] }`;

    // Groq 8B 우선 (빠르고 RPD 여유) → 키 없으면 현재 provider 폴백
    const result = groqKey
      ? await callGroq(groqKey, prompt, 'llama-3.1-8b-instant', 512)
      : await callAI(prompt, 512);

    const keywords = (result?.keywords || [])
      .map(k => String(k).trim())
      .filter(k => k.length > 0 && k.length < 40);

    return { success: true, keywords: keywords.slice(0, 15) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── 마크다운 헤더(###) 제거 헬퍼 (더 이상 글 생성에 사용 안 함 — 참조용 보존) ──
const stripMarkdownHeadings = (text) =>
  (text || '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');

// ── 한자/외국어 후처리 (AI가 한자를 출력했을 때 자동 치환/제거) ──
const CJK_MAP = {
  '直播':'생중계','放送':'방송','旅游':'여행','計劃':'계획','京都':'교토',
  '日本':'일본','東京':'도쿄','大阪':'오사카','中国':'중국','北京':'베이징',
  '上海':'상하이','觀光':'관광','飮食':'음식','文化':'문화','歷史':'역사',
  '交通':'교통','宿泊':'숙박','購物':'쇼핑','美食':'미식','景色':'경치',
  '情報':'정보','準備':'준비','方法':'방법','確認':'확인','注意':'주의',
  '紹介':'소개','特徵':'특징','代表':'대표','最新':'최신','人氣':'인기',
  '韓國':'한국','地域':'지역','施設':'시설','觀覧':'관람','案内':'안내',
};

function stripCJK(text) {
  if (!text) return text;
  let result = text;
  // 1단계: 알려진 한자 → 한국어 치환
  for (const [from, to] of Object.entries(CJK_MAP)) {
    result = result.split(from).join(to);
  }
  // 2단계: 남은 CJK 통합 한자 블록(U+4E00~U+9FFF) 제거
  result = result.replace(/[一-鿿㐀-䶿]+/g, '');
  // 3단계: 일본어 히라가나/가타카나 제거
  result = result.replace(/[぀-ヿ]+/g, '');
  // 4단계: 연속 공백 정리
  result = result.replace(/  +/g, ' ').trim();
  return result;
}

// ── 외국어 오염 문자 제거 (rát 같은 악센트 Latin이 한국어 문장 안에 삽입되는 현상) ──
function stripForeignChars(text) {
  if (!text) return text;
  // 한국어·숫자·공백·허용 기호 외의 악센트 Latin 문자가 단어 단위로 섞인 경우 제거
  // 패턴: 2자 이상의 악센트 포함 Latin 문자 시퀀스 (한글 문맥 안)
  return text
    .replace(/[a-zA-ZÀ-ɏ]{2,}/g, (match) => {
      // 악센트 문자가 하나라도 포함되면 제거, 순수 ASCII 영문은 유지
      if (/[À-ɏ]/.test(match)) return '';
      return match;
    })
    .replace(/  +/g, ' ')
    .trim();
}

// 2026-07-08 신규: 썸네일 문구(thumbText) 글자수 강제에 쓰이는 헬퍼.
// countChars()는 generatePostContent() 내부 지역함수라 여기서 재사용할 수
// 없어 별도로 모듈 레벨에 둠(post:regenerateSection 핸들러에서도 공용).
function countCharsNoSpace(s) {
  return (s || '').replace(/\s/g, '').length;
}
// 공백 제외 글자수가 maxNoSpace(기본 20)를 넘으면 단어 경계 기준으로 잘라
// 절대 상한을 보장한다. 길이 미달은 억지로 늘리면 더 어색해지므로 다루지
// 않음 — 실사용에서 확인된 실패 사례는 초과 쪽이었음.
function trimThumbTextToMax(text, maxNoSpace = 20) {
  if (!text || countCharsNoSpace(text) <= maxNoSpace) return text;
  let cut = '';
  let noSpaceCount = 0;
  for (const ch of text) {
    if (!/\s/.test(ch)) noSpaceCount++;
    if (noSpaceCount > maxNoSpace) break;
    cut += ch;
  }
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0 && countCharsNoSpace(cut.slice(0, lastSpace)) >= 14) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.trim();
}

// ── 본문 헤딩 레벨 검증/자동 보정 (2026-07-07, 코드 단 구조 강제) ─────
// 배경: 대분류(##)/중분류(###)/소분류(####) 개수·형식 규칙을 프롬프트
// 문구로 아무리 명시해도 AI가 마커 단계를 안 지키는 사례가 반복됨 —
// 대분류만 연달아 생성, 대분류 바로 다음 헤딩(도입 문장 없음), 중분류가
// 되어야 할 줄까지 전부 ##로 생성되는 경우 등. 프롬프트만으로는 한계가
// 있다고 판단해(사용자 확인 후) AI 응답을 받은 뒤 코드로 구조를 검증하고
// 자동 보정한다.
// 동작:
//   1) 헤딩 줄(## ### ####)이 사이에 실질 내용(non-blank 텍스트) 없이
//      연달아 나오는 "군집"을 찾는다.
//   2) 군집의 첫 줄 레벨은 그대로 두고, 이후 줄들은 한 단계씩 강등한다
//      (##→###→####, ####는 더 못 내려가므로 유지). 예: "## ## ##" →
//      "## ### ###", 원래 올바른 "### ####"(중분류→소분류)는 결과적으로
//      값이 그대로라 영향 없음.
//   3) 그래도 대분류(##) 바로 다음 실질 줄이 여전히 헤딩이면(=도입 문장
//      없음) 짧은 연결 문장을 자동으로 삽입해 "덩그러니" 상태를 방지한다.
function normalizeBodyHeadingLevels(text) {
  if (!text) return text;
  const preprocessed = text
    .replace(/([^\n#])(#{2,4}\s)/g, '$1\n$2')
    .replace(/([^\n])(▪\s)/g, '$1\n$2');
  const lines = preprocessed.split(/\r?\n/);

  const levelOf = (line) => {
    const tok = line.trim();
    if (/^####\s+/.test(tok)) return 4;
    if (/^###\s+/.test(tok))  return 3;
    if (/^##\s+/.test(tok))   return 2;
    if (/^#\s+/.test(tok))    return 2;
    return 0;
  };
  const textOf = (line) => line.trim().replace(/^#{1,4}\s+/, '');
  const isBlank = (line) => !line.trim();

  const headingIdx = [];
  for (let i = 0; i < lines.length; i++) {
    if (levelOf(lines[i]) > 0) headingIdx.push(i);
  }

  // 헤딩 줄 사이에 실질 내용이 없으면 같은 군집으로 묶는다
  const runs = [];
  let current = [];
  for (const idx of headingIdx) {
    if (!current.length) { current.push(idx); continue; }
    const prevIdx = current[current.length - 1];
    let onlyBlankBetween = true;
    for (let j = prevIdx + 1; j < idx; j++) {
      if (!isBlank(lines[j])) { onlyBlankBetween = false; break; }
    }
    if (onlyBlankBetween) current.push(idx);
    else { runs.push(current); current = [idx]; }
  }
  if (current.length) runs.push(current);

  // 군집 내 2번째 줄부터 한 단계씩 강등
  for (const run of runs) {
    if (run.length < 2) continue;
    let lvl = levelOf(lines[run[0]]);
    for (let k = 1; k < run.length; k++) {
      lvl = Math.min(4, lvl + 1);
      lines[run[k]] = `${'#'.repeat(lvl)} ${textOf(lines[run[k]])}`;
    }
  }

  // 대분류(##) 바로 다음 실질 줄이 여전히 헤딩이면 짧은 연결 문장 삽입
  const connectors = [
    '아래 내용을 통해 자세히 살펴보겠습니다.',
    '지금부터 하나씩 알아보겠습니다.',
    '관련된 내용을 차근차근 설명해 드리겠습니다.',
  ];
  let connectorIdx = 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (levelOf(lines[i]) === 2) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && levelOf(lines[j]) > 0) {
        out.push(connectors[connectorIdx % connectors.length]);
        connectorIdx++;
      }
    }
  }

  return out.join('\n');
}

// 2026-07-07: 본문 안의 대분류(##) 개수를 센다. splitBodyForImages가
// "대분류 정확히 2개"를 전제로 이미지 삽입 지점을 나누므로, 생성 직후 이
// 개수를 확인해 부족하면 구조 보정 재시도를 트리거하는 데 사용한다.
// 헤딩 마커 전처리는 다른 함수들과 동일하게 [^\n#] 기준(정규식 버그 수정
// 반영, [[heading-marker-regex-bug-fix]])을 사용해야 한다.
function countTopHeadings(text) {
  const normalized = (text || '').replace(/([^\n#])(#{2,4}\s)/g, '$1\n$2');
  return normalized.split(/\r?\n/).filter(l => /^##\s+/.test(l.trim())).length;
}

// ── 해시태그 정규화 (중복 제거 + # 통일 + 한글만) ───────────
function normalizeHashtags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map(t => {
      let s = String(t).trim();
      if (!s.startsWith('#')) s = '#' + s;
      // 공백 제거, 특수문자 제거 (# 제외)
      s = '#' + s.slice(1).replace(/\s+/g, '').replace(/[^가-힣ᄀ-ᇿ㄰-㆏a-zA-Z0-9]/g, '');
      return s;
    })
    .filter(s => {
      if (s.length < 2) return false; // '#' 만 있는 경우 제외
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ── 글 전체 생성 (2026-07-05: 자동화 루프에서도 재사용할 수 있도록
//    ipcMain.handle 본체를 일반 함수로 분리) ──────────────────────
async function generatePostContent(params) {
  try {
    writeLog('INFO', 'AI', `글 생성 시작 — 주제: ${params.topic}`);

    // 공백 제외 글자수 측정 헬퍼
    const countChars = (r) => {
      if (!r) return 0;
      const text = [(r.intro||''), (r.body||''), (r.conclusion||'')].join('');
      return text.replace(/\s/g, '').length;
    };

    const prompt = buildPrompt(params);
    let result = await callAI(prompt);

    // 후처리
    const applyPostProcess = (r) => {
      if (!r) return r;
      r.intro      = stripForeignChars(stripCJK(r.intro));
      // 2026-07-07: stripCJK/stripForeignChars 이후 헤딩 레벨 검증/자동
      // 보정을 마지막에 적용 — 대/중/소분류 구조 강제(코드 단)
      r.body       = normalizeBodyHeadingLevels(stripForeignChars(stripCJK(r.body)));
      r.conclusion = stripForeignChars(stripCJK(r.conclusion));
      r.title      = stripForeignChars(stripCJK(r.title));
      // 2026-07-08 신규: 썸네일 전용 문구 — title과 동일하게 정제.
      // AI가 필드를 누락하면 빈 문자열로 두고, 실제 사용 시점(generateThumbnail
      // 호출부)에서 title로 폴백하므로 여기서 강제로 채우지 않음.
      r.thumbText  = stripForeignChars(stripCJK(r.thumbText || ''));
      r.hashtags   = normalizeHashtags(r.hashtags);
      if (!Array.isArray(r.links)) r.links = [];
      return r;
    };

    result = applyPostProcess(result);
    const targetMin = params.targetMin || 2000;
    let chars = countChars(result);
    writeLog('INFO', 'AI', `1차 생성 완료 — ${chars}자`);

    // 2026-07-08 신규: 썸네일 문구(thumbText) 글자수 강제 — AI가 프롬프트의
    // 18~20자 지시를 안 지키는 사례가 실사용에서 확인되어(공백 제외
    // 33자/27자) 코드 단에서 한 번 더 검증한다. 범위를 벗어나면 최대 1회
    // 재시도하고, 그래도 벗어나면 trimThumbTextToMax로 강제 절삭해 절대
    // 상한(20자)을 보장한다(본문 최소글자수 보장과 동일한 "AI best-effort
    // + 코드 폴백" 철학).
    let thumbLen = countCharsNoSpace(result.thumbText);
    if (result.thumbText && (thumbLen < 16 || thumbLen > 22)) {
      writeLog('WARN', 'AI', `썸네일 문구 길이 범위 이탈 — 재시도 (현재 ${thumbLen}자: "${result.thumbText}")`);
      const thumbFixPrompt = `${AI_PERSONA}
아래는 "${params.topic}"에 대한 블로그 글의 썸네일 문구입니다. 현재 공백 제외
${thumbLen}자인데, 반드시 18~20자로 다시 작성해야 합니다.

[현재 문구]
${result.thumbText}

- 공백을 제외한 글자 수를 스스로 세어 정확히 18~20자로 맞출 것
- 핵심 키워드는 유지
- 마크다운 기호 없는 한 줄 평문
- 순수 한국어(한글)만 사용
${AI_CLICHE_BAN}
- JSON 형식으로만 응답: {"thumbText": "18~20자로 다시 작성한 문구"}`;
      try {
        const fixed = await callAI(thumbFixPrompt);
        if (fixed && fixed.thumbText) {
          result.thumbText = stripForeignChars(stripCJK(fixed.thumbText));
          thumbLen = countCharsNoSpace(result.thumbText);
          writeLog('INFO', 'AI', `썸네일 문구 재시도 완료 — ${thumbLen}자`);
        }
      } catch (e) {
        writeLog('WARN', 'AI', '썸네일 문구 재시도 실패', e.message);
      }
    }
    if (countCharsNoSpace(result.thumbText) > 20) {
      const before = countCharsNoSpace(result.thumbText);
      result.thumbText = trimThumbTextToMax(result.thumbText);
      writeLog('WARN', 'AI', `썸네일 문구 최종 강제 절삭 — ${before}자 → ${countCharsNoSpace(result.thumbText)}자`);
    }

    // 2026-07-07: 대분류(##) 구조 부족 시 보정 재시도 (최대 1회) — 이미지
    // 5장을 대분류 2개 지점에 맞춰 배치하는데, AI가 "대분류 정확히 2개"
    // 규칙을 안 지키면(사용자 스크린샷으로 확인된 사진 몰림 문제의 원인)
    // 이 재시도로 구조를 맞출 확률을 높인다. 그래도 실패하면
    // splitBodyForImages의 글자수 기준 폴백 분할이 안전망 역할을 한다.
    // ※ 2026-07-07 재배치: 이 구조 보정 재시도가 AI에게 "본문을 정리"하도록
    // 요청하는 과정에서 글자수가 목표(targetMin) 밑으로 줄어들 수 있는데,
    // 예전 순서(글자수 보완 → 구조 보정)에서는 이 재시도가 마지막에 실행돼
    // 최소 글자수가 절대 보장되지 않는 회귀가 있었다(사용자 보고). 구조
    // 보정을 먼저 하고 글자수 보완을 항상 마지막에 실행해, 어떤 경우에도
    // 최종 결과가 targetMin 이상이 되도록 순서를 바꿨다.
    let topHeadingCount = countTopHeadings(result.body);
    if (topHeadingCount < 2) {
      writeLog('WARN', 'AI', `대분류(##) 개수 부족 — 구조 보정 재시도 (현재 ${topHeadingCount}개)`);
      const structurePrompt = `${AI_PERSONA}
아래는 "${params.topic}"에 대해 작성된 블로그 글의 본문(body)입니다.
현재 대분류(##) 제목이 ${topHeadingCount}개뿐이라 구조 규칙을 지키지 못했습니다.

[현재 본문]
${result.body}

위 본문의 기존 내용을 최대한 유지하면서, 아래 구조 규칙에 맞게 다시 정리하세요.
${structureCountRule}
- 순수 한국어(한글)만 사용
- JSON 형식으로만 응답: {"body": "구조를 맞춘 전체 본문"}`;

      try {
        const restructured = await callAI(structurePrompt);
        if (restructured && restructured.body && countTopHeadings(restructured.body) >= 2) {
          result.body = normalizeBodyHeadingLevels(stripCJK(restructured.body));
          chars = countChars(result);
          topHeadingCount = countTopHeadings(result.body);
          writeLog('INFO', 'AI', `구조 보정 재시도 완료 — 대분류 ${topHeadingCount}개, ${chars}자`);
        } else {
          writeLog('WARN', 'AI', '구조 보정 재시도 결과도 기준 미달 — 원본 유지(이미지 배치는 글자수 기준 폴백 분할로 처리됨)');
        }
      } catch (e) {
        writeLog('WARN', 'AI', '구조 보정 재시도 실패', e.message);
      }
    }

    // 글자수 미달 시 body 보완 재시도 (최대 2회) — 2026-07-07: 항상 맨
    // 마지막에 실행되어야 최소 글자수(targetMin)가 절대 기준으로 보장됨.
    // 위 구조 보정 재시도가 글자수를 줄였더라도 여기서 다시 채워진다.
    for (let attempt = 1; attempt <= 2 && chars < targetMin; attempt++) {
      const shortage = targetMin - chars;
      writeLog('INFO', 'AI', `보완 #${attempt} 시도 (${shortage}자 부족)`);
      const supplementPrompt = `${AI_PERSONA}
아래는 "${params.topic}"에 대해 작성된 블로그 글의 본문(body)입니다.
현재 전체 글자수가 목표(${targetMin}자)보다 ${shortage}자 부족합니다.

[현재 본문]
${result.body}

위 본문을 바탕으로 내용을 ${shortage + 200}자 이상 추가 확장하세요.
- ## 소제목, ### 하위소제목, ▪ 불릿 형식 유지
- 새로운 정보·사례·팁을 추가 (기존 내용 단순 반복 금지)
- 순수 한국어(한글)만 사용
- JSON 형식으로만 응답: {"body": "확장된 전체 본문"}`;

      try {
        const supplement = await callAI(supplementPrompt);
        if (supplement && supplement.body && supplement.body.length > (result.body || '').length) {
          // 2026-07-07: 보완 확장 후에도 헤딩 레벨 검증/자동 보정 재적용
          result.body = normalizeBodyHeadingLevels(stripCJK(supplement.body));
          chars = countChars(result);
          writeLog('INFO', 'AI', `보완 #${attempt} 완료 — ${chars}자`);
        } else {
          writeLog('WARN', 'AI', `보완 #${attempt} 결과 미사용 (본문 축소)`);
          break;
        }
      } catch (e) {
        writeLog('WARN', 'AI', `보완 #${attempt} 실패`, e.message);
        break;
      }
    }

    if (chars < targetMin) {
      writeLog('WARN', 'AI', `최소 글자수 미달 상태로 종료 — ${chars}자 (목표 ${targetMin}자, 보완 재시도 소진)`);
    }

    writeLog('INFO', 'AI', `글 생성 완료 — 최종 ${chars}자`);
    return { success: true, result };
  } catch (err) {
    writeLog('ERROR', 'AI', '글 생성 실패', err.message);
    return { success: false, error: err.message };
  }
}

// ── IPC: 글 전체 생성 ────────────────────────────────────────
ipcMain.handle('post:generate', async (event, params) => generatePostContent(params));

// ── IPC: 섹션별 재생성 ───────────────────────────────────────
ipcMain.handle('post:regenerateSection', async (event, params) => {
  try {
    const prompt = buildPrompt({ ...params, section: params.section });
    const result = await callAI(prompt);
    // ## 헤더 유지 (toNaverHtml 박스 변환용) + 한자 후처리
    let text = stripCJK(result.text || '');
    // 2026-07-07: 본문(body) 재생성일 때만 헤딩 레벨 검증/자동 보정 적용
    // (intro/conclusion/title은 단일 ## 소제목 구조라 대상 아님)
    if (params.section === 'body') {
      text = normalizeBodyHeadingLevels(text);

      // 2026-07-07: 본문만 재생성할 때도 대분류(##) 구조가 부족하면 이미지
      // 삽입 지점이 어긋나 사진이 몰리는 문제가 생길 수 있어, 전체 생성과
      // 동일하게 구조 보정 재시도를 1회 수행한다(실패해도 splitBodyForImages의
      // 글자수 기준 폴백 분할이 안전망 역할을 하므로 발행 자체는 문제없음).
      let topHeadingCount = countTopHeadings(text);
      if (topHeadingCount < 2) {
        writeLog('WARN', 'AI', `본문 재생성 — 대분류(##) 개수 부족, 구조 보정 재시도 (현재 ${topHeadingCount}개)`);
        const structurePrompt = `${AI_PERSONA}
아래는 "${params.topic}"에 대해 작성된 블로그 글의 본문(body)입니다.
현재 대분류(##) 제목이 ${topHeadingCount}개뿐이라 구조 규칙을 지키지 못했습니다.

[현재 본문]
${text}

위 본문의 기존 내용을 최대한 유지하면서, 아래 구조 규칙에 맞게 다시 정리하세요.
${structureCountRule}
- 순수 한국어(한글)만 사용
- JSON 형식으로만 응답: {"body": "구조를 맞춘 전체 본문"}`;
        try {
          const restructured = await callAI(structurePrompt);
          if (restructured && restructured.body && countTopHeadings(restructured.body) >= 2) {
            text = normalizeBodyHeadingLevels(stripCJK(restructured.body));
            writeLog('INFO', 'AI', `본문 재생성 — 구조 보정 재시도 완료 (대분류 ${countTopHeadings(text)}개)`);
          } else {
            writeLog('WARN', 'AI', '본문 재생성 — 구조 보정 재시도 결과도 기준 미달, 원본 유지');
          }
        } catch (e) {
          writeLog('WARN', 'AI', '본문 재생성 — 구조 보정 재시도 실패', e.message);
        }
      }
    }
    // 2026-07-08 신규: 썸네일 문구 재생성 시에도 20자 초과 시 강제 절삭
    // (전체 생성 때와 동일한 안전장치 — 재생성 버튼은 빠르게 반응해야
    // 하므로 여기서는 추가 AI 재시도 없이 절삭만 적용).
    if (params.section === 'thumbText' && countCharsNoSpace(text) > 20) {
      const before = countCharsNoSpace(text);
      text = trimThumbTextToMax(text);
      writeLog('WARN', 'AI', `썸네일 문구 재생성 — 강제 절삭 ${before}자 → ${countCharsNoSpace(text)}자`);
    }
    return { success: true, text };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── 발행 전 미리보기 HTML 조립 (2026-07-07 신규, 같은 날 이미지 5장
// 확대에 맞춰 재작성) ──────────────────────────────────────────
// 실제 발행(publishToNaver)과 완전히 동일한 조립 순서(도입부 → 이미지1 →
// 본문 4조각(대분류1 도입/중분류1/중분류2/대분류2) 사이사이에 이미지
// 2~4 → 이미지5 → 마무리 → 관련 사이트)를 그대로 재사용해, 브라우저
// 자동화 없이 텍스트 섹션 HTML만 만들어 돌려준다. 이미지 자체는 렌더러가
// 이미 갖고 있는 이미지 URL로 <img> 태그를 직접 배치하므로, 여기서는
// 섹션 HTML과 각 조각의 존재 여부만 알려주면 충분하다.
function composePreviewSections({ intro, body, conclusion, links, editorFont, stylePreset }) {
  const iconCycler = makeIconCycler(stylePreset.h2.icons);
  const introHtml = buildIntroHtml(intro, editorFont, iconCycler, stylePreset);

  // 본문을 이미지 삽입 지점 기준 4조각으로 분할 (splitBodyForImages 참고 —
  // publishToNaver의 실제 발행 로직과 동일한 함수를 공유해 미리보기와
  // 실제 발행 결과가 어긋나지 않도록 함)
  const { part1, part2, part3, part4 } = splitBodyForImages(body);
  const bodyPart1Html = part1 ? buildBodyHtml(part1, editorFont, iconCycler, stylePreset) : null;
  const bodyPart2Html = part2 ? buildBodyHtml(part2, editorFont, iconCycler, stylePreset) : null;
  const bodyPart3Html = part3 ? buildBodyHtml(part3, editorFont, iconCycler, stylePreset) : null;
  const bodyPart4Html = buildBodyHtml(part4, editorFont, iconCycler, stylePreset);

  const conclusionHtml = buildConclusionHtml(conclusion, editorFont, iconCycler, stylePreset);
  const linksHtml = buildLinksHtml(links, editorFont);
  return {
    introHtml, bodyPart1Html, bodyPart2Html, bodyPart3Html, bodyPart4Html,
    conclusionHtml, linksHtml,
    hasPart1: !!part1, hasPart2: !!part2, hasPart3: !!part3,
  };
}

// ── IPC: 발행 전 미리보기 (2026-07-07 신규) ───────────────────
// 수동/반자동 전용(완전자동 processLoopStep에는 적용하지 않음 — 사람이
// 지켜보지 않는 무인 실행이 전제라 발행 직전에 멈춰 승인을 기다리는 것
// 자체가 완전자동의 목적과 상충되기 때문. 2026-07-07 사용자 확인:
// "완전자동 모드는 제외"). "미리보기" 체크박스가 켜진 상태로 즉시발행/
// 예약발행을 누르면, 실제 브라우저 자동화 전에 먼저 이 IPC로 미리보기용
// 썸네일·본문 HTML을 만들어 화면에 보여준다.
// 여기서 만든 썸네일(thumbTempPath)과 확정한 색상 프리셋 인덱스
// (resolvedStyleIndex)는, 사용자가 미리보기를 확인하고 실제 발행을
// 진행할 때 publish:now/schedule → publishToNaver로 그대로 전달되어
// 재사용된다 — 그래야 미리본 색상/썸네일과 실제 발행 결과가 달라지는
// 문제(랜덤 프리셋이 두 번 다르게 뽑히는 경우)를 막을 수 있다.
ipcMain.handle('post:renderPreview', async (event, { title, thumbText, intro, body, conclusion, links, hashtags, autoThumbnail, thumbBgUrl }) => {
  try {
    const editorFont = (getStore().get('settings.editorFont', '') || '').trim();
    const styleSetting = getStore().get('settings.postStyle', -1);
    const resolvedStyleIndex = (styleSetting >= 0 && styleSetting < POST_STYLE_PRESETS.length)
      ? styleSetting
      : Math.floor(Math.random() * POST_STYLE_PRESETS.length);
    const stylePreset = POST_STYLE_PRESETS[resolvedStyleIndex];

    let thumbDataUrl = null;
    let thumbTempPath = null;
    if (autoThumbnail && title) {
      // 2026-07-07: 사용자가 이미지 카드를 클릭해 썸네일 배경을 직접 선택한
      // 경우 thumbBgUrl로 전달됨 — 없으면 기존 자동 검색 그대로 사용.
      // 2026-07-08: 썸네일 전용 문구(thumbText)가 있으면 제목 대신 사용 —
      // 없으면(구버전 초안 등) 기존처럼 title로 폴백.
      thumbTempPath = await generateThumbnail((thumbText || '').trim() || title, hashtags || [], thumbBgUrl || null);
      if (thumbTempPath) {
        try {
          const buf = fs.readFileSync(thumbTempPath);
          thumbDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        } catch (e) {
          writeLog('WARN', 'PREVIEW', '썸네일 미리보기 인코딩 실패', e.message);
        }
      }
    }

    const sections = composePreviewSections({ intro, body, conclusion, links, editorFont, stylePreset });

    return { success: true, ...sections, thumbDataUrl, thumbTempPath, resolvedStyleIndex };
  } catch (err) {
    writeLog('ERROR', 'PREVIEW', '미리보기 생성 실패', err.message);
    return { success: false, error: err.message };
  }
});

// ── IPC: 쿠키 유효성 확인 ────────────────────────────────────
ipcMain.handle('account:checkStatus', async (event, id) => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const row = db.prepare('SELECT cookies_encrypted FROM accounts WHERE id = ?').get(id);

    if (!row?.cookies_encrypted) {
      db.prepare("UPDATE accounts SET status = 'expired' WHERE id = ?").run(id);
      return { success: true, status: 'expired' };
    }

    const cookiesJson = decrypt(row.cookies_encrypted);
    if (!cookiesJson) {
      db.prepare("UPDATE accounts SET status = 'expired' WHERE id = ?").run(id);
      return { success: true, status: 'expired' };
    }

    const cookies = JSON.parse(cookiesJson);
    const nowSec = Math.floor(Date.now() / 1000);

    // NID_AUT 쿠키 만료 여부 체크
    const authCookie = cookies.find(c => c.name === 'NID_AUT');
    if (!authCookie) {
      db.prepare("UPDATE accounts SET status = 'expired' WHERE id = ?").run(id);
      return { success: true, status: 'expired' };
    }

    if (authCookie.expirationDate && authCookie.expirationDate < nowSec) {
      db.prepare("UPDATE accounts SET status = 'expired' WHERE id = ?").run(id);
      return { success: true, status: 'expired' };
    }

    db.prepare("UPDATE accounts SET status = 'active' WHERE id = ?").run(id);
    return { success: true, status: 'active' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Unsplash 이미지 검색 공통 함수 ───────────────────────────
async function searchUnsplash(apiKey, query, perPage = 30, page = 1) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
  const res  = await fetch(url, { headers: { Authorization: `Client-ID ${apiKey}` } });
  if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(p => ({
    id:           p.id,
    url:          p.urls.regular,
    thumb:        p.urls.thumb,
    alt:          p.alt_description || query,
    photographer: p.user?.name || '',
    profileUrl:   p.user?.links?.html || '',
  }));
}

// ── IPC: 이미지 일괄 검색 (글 생성 후 3장 자동 추천) ─────────
ipcMain.handle('image:search', async (event, { keywords, excludeIds = [] }) => {
  try {
    const store  = getStore();
    const apiKey = store.get('settings.unsplashKey', '');
    if (!apiKey) return { success: false, error: 'Unsplash API 키가 설정되지 않았습니다.\n환경설정에서 키를 입력해 주세요.' };

    const query   = keywords.slice(0, 3).join(' ');
    // 2026-07-07: 한글 키워드 검색 결과 0건 시 단순화 → AI 영어 번역까지
    // 시도하는 공용 헬퍼로 교체(기존엔 재시도 없이 바로 빈 결과 반환).
    const pool    = await searchUnsplashWithFallback(apiKey, query, 30, 'IMAGE');
    const filtered = pool.filter(p => !excludeIds.includes(p.id));

    // 2026-07-07: 3장 → 5장으로 확대 (이미지 삽입 위치 5곳으로 변경)
    const picked = pickImagesFromPool(filtered, 5);

    return { success: true, images: picked };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2026-07-06 신규: 자동화 루프 백엔드(main 프로세스)에서 언스플래시 이미지를
// 자동으로 골라주기 위한 공통 함수 — 위 image:search IPC 핸들러(수동 "글 생성"
// 화면에서 렌더러가 호출)와 동일한 검색/선택 로직을 그대로 재사용한다.
// 자동화 루프는 렌더러를 거치지 않고 main 프로세스 안에서 바로 발행까지
// 진행하므로, image:search를 호출할 수 없어 별도 함수로 분리함.
// 키 미설정/검색 실패 시에도 예외를 던지지 않고 빈 배열을 반환 — 이미지가
// 없다고 해서 발행 자체가 막히지 않도록(수동 흐름과 동일한 완화 처리).
// 2026-07-06 추가: 검색 결과가 0건이면(한국어 복합어가 언스플래시와 궁합이
// 안 좋아 자주 발생 — 예: "강아지 운동장") 키워드를 단순화해 재검색을
// 시도하고, 성공/실패 각 단계를 자동화 루프 로그에 남겨 원인을 바로 알 수
// 있게 한다(이전에는 0건일 때 아무 로그도 남지 않아 진단이 불가능했음).
// 2026-07-07: 이미지 3장 → 5장으로 확대(이미지 삽입 위치가 5곳으로
// 늘어남에 따라 count 매개변수화). pool 안에서 균등 간격으로 count개
// 선택(중복 방지), 부족하면 앞에서부터 순환해 채움.
function pickImagesFromPool(pool, count = 5) {
  const picked = [];
  const step   = Math.floor(pool.length / count) || 1;
  for (let i = 0; i < count && i * step < pool.length; i++) {
    picked.push(pool[i * step]);
  }
  while (picked.length < count && pool.length > 0) {
    picked.push(pool[picked.length % pool.length]);
  }
  return picked;
}

async function autoPickUnsplashImages(keywords) {
  const query = (Array.isArray(keywords) ? keywords : [keywords]).slice(0, 3).join(' ');
  try {
    const apiKey = getStore().get('settings.unsplashKey', '');
    if (!apiKey) return { images: [], error: 'Unsplash API 키가 설정되지 않았습니다.' };

    // 2026-07-07: 단순화 재검색까지도 0건이면 AI 영어 번역 재검색까지
    // 시도하는 공용 헬퍼로 교체(기존 단순화 재검색 로직은 그대로 유지됨).
    const pool = await searchUnsplashWithFallback(apiKey, query, 30, 'LOOP');

    if (!pool.length) {
      return { images: [], error: null };
    }

    return { images: pickImagesFromPool(pool, 5), error: null };
  } catch (err) {
    return { images: [], error: err.message };
  }
}

// ── IPC: 이미지 1장 교체 ─────────────────────────────────────
ipcMain.handle('image:swapOne', async (event, { keywords, excludeIds = [] }) => {
  try {
    const store  = getStore();
    const apiKey = store.get('settings.unsplashKey', '');
    if (!apiKey) return { success: false, error: 'Unsplash API 키 없음' };

    const query    = keywords.slice(0, 3).join(' ');
    const page     = Math.floor(Math.random() * 3) + 1; // 1~3 페이지 랜덤
    // 2026-07-07: 한글 키워드 검색 결과 0건 시 단순화 → AI 영어 번역까지 시도
    const pool     = await searchUnsplashWithFallback(apiKey, query, 30, 'IMAGE', page);
    const filtered = pool.filter(p => !excludeIds.includes(p.id));

    if (!filtered.length) return { success: false, error: '교체할 이미지가 없습니다.' };
    const image = filtered[Math.floor(Math.random() * filtered.length)];
    return { success: true, image };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 로컬 이미지 업로드 ──────────────────────────────────
ipcMain.handle('image:upload', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '이미지 선택',
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, cancelled: true };

    const filePath = result.filePaths[0];
    const ext      = filePath.split('.').pop().toLowerCase();
    const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    const mime     = mimeMap[ext] || 'image/jpeg';
    const base64   = fs.readFileSync(filePath).toString('base64');
    const dataUrl  = `data:${mime};base64,${base64}`;

    return { success: true, image: { id: `local_${Date.now()}`, url: dataUrl, thumb: dataUrl, alt: '', photographer: '로컬 이미지' } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── macOS 알림 ───────────────────────────────────────────────
function sendNotification(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch { /* ignore */ }
}

// ── 이미지 삽입: 사진 툴바 버튼 → URL 입력 방식 ─────────────
// ── 이미지 URL → Buffer 다운로드 (리다이렉트 자동 추적) ────────
async function downloadImageBuffer(imageUrl) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url: imageUrl });
    const chunks = [];
    req.on('response', (res) => {
      res.on('data',  (chunk) => chunks.push(chunk));
      res.on('end',   () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('redirect', () => { req.followRedirect(); });
    req.on('error', reject);
    req.end();
  });
}

// ── 이미지 클립보드 붙여넣기 방식 삽입 ────────────────────────
// 사진 버튼/다이얼로그 없이: 다운로드 → nativeImage → clipboard.writeImage → paste()
async function insertImageViaClipboard(publishWin, imageUrl) {
  if (!imageUrl || imageUrl.startsWith('data:') || publishWin.isDestroyed()) return false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const { nativeImage } = require('electron');

  try {
    writeLog('INFO', 'PUBLISH', '이미지 다운로드 시작', imageUrl.slice(0, 80));
    const buf = await downloadImageBuffer(imageUrl);
    writeLog('INFO', 'PUBLISH', '이미지 다운로드 완료', `${buf.length} bytes`);

    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) {
      writeLog('WARN', 'PUBLISH', '이미지 변환 실패 (isEmpty)', `buf=${buf.length}`);
      return false;
    }

    clipboard.writeImage(img);
    await sleep(200);
    publishWin.webContents.paste();
    const sz = img.getSize();
    writeLog('INFO', 'PUBLISH', '이미지 클립보드 붙여넣기 완료', `${sz.width}x${sz.height}`);
    await sleep(1200);

    return true;
  } catch (e) {
    writeLog('ERROR', 'PUBLISH', 'insertImageViaClipboard 오류', e.message);
    return false;
  }
}

// ── HTML 빌더 (SE3 붙여넣기용 — 표(table) 기반 색상 박스 + 폰트) ──────
// ※ 실제 발행 성공 글(blog.naver.com/skysmoga/224333233715) 구조 분석 결과:
//   네이버 SE3 에디터는 붙여넣기 시 <div style="background/border..."> 형태의
//   임의 박스는 컴포넌트로 인식하지 못해 서식이 깨지거나 텍스트가 안 보이는
//   문제가 있음. 색상 박스는 반드시 1칸 <table>이어야 SE3가 표 컴포넌트로
//   인식해 테두리·배경·텍스트가 그대로 보존됨. 색상 값도 실제 성공 글 기준.

const H2_ICONS = ['✅', '🔥', '💡'];

// 2026-07-07 신규: 본문 서식 스타일 5종 — 계정/글마다 항상 같은 초록/회색
// 배색만 나오던 문제(사용자 리포트: "여러 계정이 전부 같은 서식으로 보임")를
// 해결하기 위해 대분류(h2)/중분류(h3)/소분류(h4) 색상·아이콘을 프리셋으로
// 분리. 각 프리셋 내에서 h2/h3/h4는 서로 다른 색상을 쓰도록 설계(요청:
// "대분류·중분류·소분류마다 색상이 중복되지 않게"). 환경설정 > 글 설정 >
// "본문 서식 스타일"에서 특정 스타일 고정 또는 "랜덤"(매 발행마다 무작위)
// 선택 가능 — settings.postStyle: -1(랜덤) | 0~4(고정 인덱스).
const POST_STYLE_PRESETS = [
  { // 0: 그린 (기존 스타일 그대로 유지 — 하위 호환)
    id: 'green', label: '그린',
    h2: { border: 'rgb(3,199,90)',   bg: 'rgb(240,255,244)', text: 'rgb(26,122,60)',  icons: ['✅', '🔥', '💡'] },
    h3: { border: 'rgb(136,136,136)',bg: 'rgb(238,238,238)', text: 'rgb(34,34,34)',   symbol: '◼' },
    h4: { text: 'rgb(68,68,68)', symbol: '▪' },
  },
  { // 1: 블루
    id: 'blue', label: '블루',
    h2: { border: 'rgb(37,99,235)',  bg: 'rgb(239,246,255)', text: 'rgb(29,78,216)',  icons: ['📘', '🔷', '💧'] },
    h3: { border: 'rgb(100,116,139)',bg: 'rgb(238,238,238)', text: 'rgb(51,65,85)',   symbol: '◆' },
    h4: { text: 'rgb(71,85,105)', symbol: '▸' },
  },
  { // 2: 오렌지
    id: 'orange', label: '오렌지',
    h2: { border: 'rgb(234,88,12)',  bg: 'rgb(255,247,237)', text: 'rgb(154,52,18)',  icons: ['🔥', '🧡', '📍'] },
    h3: { border: 'rgb(161,98,7)',   bg: 'rgb(238,238,238)', text: 'rgb(120,53,15)',  symbol: '◈' },
    h4: { text: 'rgb(146,64,14)', symbol: '➤' },
  },
  { // 3: 퍼플
    id: 'purple', label: '퍼플',
    h2: { border: 'rgb(124,58,237)', bg: 'rgb(245,243,255)', text: 'rgb(91,33,182)',  icons: ['💜', '🔮', '✨'] },
    h3: { border: 'rgb(107,114,128)',bg: 'rgb(238,238,238)', text: 'rgb(55,65,81)',   symbol: '◇' },
    h4: { text: 'rgb(75,85,99)', symbol: '▹' },
  },
  { // 4: 민트
    id: 'teal', label: '민트',
    h2: { border: 'rgb(13,148,136)', bg: 'rgb(240,253,250)', text: 'rgb(15,118,110)', icons: ['🌿', '💠', '✅'] },
    h3: { border: 'rgb(71,85,105)',  bg: 'rgb(238,238,238)', text: 'rgb(51,65,85)',   symbol: '◼' },
    h4: { text: 'rgb(51,65,85)', symbol: '▪' },
  },
];

// settings.postStyle 값(-1 또는 0~4)을 실제 프리셋 객체로 변환. -1이면
// 매 호출마다 무작위 프리셋 하나를 고른다(발행 1건당 1번 호출해 그 글
// 전체에 일관되게 적용).
function resolvePostStyle(postStyleSetting) {
  const idx = (postStyleSetting === -1 || postStyleSetting == null)
    ? Math.floor(Math.random() * POST_STYLE_PRESETS.length)
    : postStyleSetting;
  return POST_STYLE_PRESETS[idx] || POST_STYLE_PRESETS[0];
}

// 대주제(H2) 아이콘 순환자 — 도입부→본문→마무리 전체에서 공유. icons 배열은
// 선택된 스타일 프리셋의 h2.icons를 사용(프리셋마다 다른 아이콘 조합).
function makeIconCycler(icons) {
  const list = icons && icons.length ? icons : H2_ICONS;
  let idx = 0;
  return () => list[(idx++) % list.length];
}

// 1칸 표 박스 (SE3 붙여넣기 호환)
function tableBox(innerHtml, borderCss, bg) {
  return `<table style="width:100%;border-collapse:collapse;">`
       + `<tbody><tr><td style="padding:9px 16px;${borderCss}background-color:${bg};">`
       + innerHtml
       + `</td></tr></tbody></table>`;
}

// (2026-07-02) 가독성 개선: 줄바꿈 없이 이어진 긴 문단을 문장 단위로 쪼개
// 짧은 문단 여러 개로 렌더링. AI가 도입부/마무리를 줄바꿈 없는 하나의
// 덩어리 텍스트로 생성하는 경우가 많아, PC에서도 벽돌처럼 뭉쳐 보이고
// 모바일에서는 더 빽빽해 보이는 문제를 구조적으로 해결(반응형 CSS는
// 네이버 붙여넣기 시 상당 부분 걸러지므로 문단 구조 자체를 짧게 만드는
// 방식 채택). 마침표/물음표/느낌표 기준 문장 분리 후 2문장씩 묶음.
function splitIntoSentences(text) {
  const matches = (text || '').match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (matches || [text]).map(s => s.trim()).filter(Boolean);
}
function groupSentences(sentences, perParagraph) {
  const groups = [];
  for (let i = 0; i < sentences.length; i += perParagraph) {
    groups.push(sentences.slice(i, i + perParagraph).join(' '));
  }
  return groups;
}

// boxHeadings=false 이면 ##/### 제목을 표(table) 박스로 만들지 않고
// 색상 볼드 텍스트로만 렌더링한다. (도입부/마무리처럼 이미 바깥이 표 박스인
// 경우, 안쪽에 또 표를 중첩하면 SE3가 붙여넣기 시 표를 강제 병합하면서
// 바깥 박스의 좌우 테두리가 사라지는 문제가 있어 중첩을 피하기 위함)
// style: POST_STYLE_PRESETS의 프리셋 객체(2026-07-07 신규) — 미지정 시
// 기존과 동일한 그린 프리셋(POST_STYLE_PRESETS[0])으로 폴백.
function toNaverHtml(text, fontName, iconCycler, boxHeadings, style) {
  const font = fontName ? `font-family:'${fontName}',sans-serif;` : '';
  const st = style || POST_STYLE_PRESETS[0];
  const nextH2Icon = iconCycler || makeIconCycler(st.h2.icons);
  const useBox = boxHeadings !== false;

  // ── 전처리: 인라인 마커 자동 줄 분리 ────────────────────────
  // AI가 ## / ### / #### / ▪ 를 줄 중간에 붙인 경우 → 앞에 줄바꿈 삽입
  // [2026-07-07 버그 수정] group1을 [^\n]으로 두면 "### 제목" 같은 온전한
  // 헤딩 줄의 첫 번째 #을 "앞선 일반 문자"로 오인해 "#\n## 제목"으로
  // 스스로를 망가뜨리는 문제가 있었음(중분류/소분류가 실제로는 한 단계씩
  // 격하되어 렌더링되고 있었던 근본 원인). group1에서 '#'도 제외해
  // 마커 시퀀스 내부를 잘못 쪼개지 않도록 수정.
  const preprocessed = (text || '')
    .replace(/([^\n#])(#{2,4}\s)/g, '$1\n$2')  // 줄 중간 ## ### #### → 줄바꿈
    .replace(/([^\n])(▪\s)/g,     '$1\n$2');  // 줄 중간 ▪ → 줄바꿈

  const lines = preprocessed.split(/\r?\n/);
  let html = '';
  let isFirstLine = true;
  let justInsertedHr = false;

  const esc    = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>');

  for (const line of lines) {
    const raw = line.trimEnd();
    const tok = raw.trimStart();

    // 단독 # (구분선 마커, 뒤에 내용 없음) → <hr>로 처리 (문자 그대로 노출 방지)
    if (/^#+$/.test(tok)) {
      if (!justInsertedHr) html += `<hr>`;
      justInsertedHr = true;
      isFirstLine = false;
      continue;
    }

    // #### → 소제목 (스타일 프리셋 심볼 접두, 볼드, 박스 없음, 뒤에 구분선)
    // [2026-07-07] 실제 <h4> 태그로 변경했으나, 실사용 발행 테스트 2회에서
    // SE3가 붙여넣기 시 heading 태그를 자체 컴포넌트 스키마로 정규화하며
    // 태그를 제거하는 것으로 확인되어(SEO META in 1 CLICK 확장에서 계속
    // H1~H6 전부 0으로 검출) <p><span><b> 방식으로 되돌림. 태그만 바꾸는
    // 방식으로는 이 문제를 해결할 수 없음 — 자세한 내용은 memory
    // naver-heading-tags-seo-fix.md 참고.
    if (/^####\s+/.test(tok)) {
      const t = tok.replace(/^####\s+/, '');
      html += `<p style="${font}margin:14px 0 4px 0;"><span style="color:${st.h4.text};font-size:14px;"><b>${st.h4.symbol} ${esc(t)}</b></span></p>`;
      html += `<hr>`;
      justInsertedHr = true;
      isFirstLine = false;
      continue;
    }

    // ### → 중주제 (스타일 프리셋 박스/심볼, useBox=false면 볼드 텍스트만)
    if (/^###\s+/.test(tok)) {
      const t = tok.replace(/^###\s+/, '');
      if (useBox) {
        const inner = `<p style="${font}margin:0;"><span style="color:${st.h3.text};font-size:17px;"><b>${st.h3.symbol} ${esc(t)}</b></span></p>`;
        html += tableBox(inner, `border-left:4px solid ${st.h3.border};`, st.h3.bg);
      } else {
        html += `<p style="${font}margin:10px 0 4px 0;"><span style="color:${st.h3.text};font-size:17px;"><b>${st.h3.symbol} ${esc(t)}</b></span></p>`;
      }
      justInsertedHr = false;
      isFirstLine = false;
      continue;
    }

    // ## / # → 대주제 (스타일 프리셋 박스, 아이콘 순환, useBox=false면 볼드 텍스트만)
    if (/^#{1,2}\s+/.test(tok)) {
      const t = tok.replace(/^#{1,2}\s+/, '');
      const icon = nextH2Icon();
      if (useBox) {
        if (!isFirstLine && !justInsertedHr) html += `<hr>`;
        const inner = `<p style="${font}margin:0;"><span style="color:${st.h2.text};font-size:20px;"><b>${icon} ${esc(t)}</b></span></p>`;
        html += tableBox(inner, `border-left:5px solid ${st.h2.border};`, st.h2.bg);
      } else {
        html += `<p style="${font}margin:10px 0 4px 0;"><span style="color:${st.h2.text};font-size:20px;"><b>${icon} ${esc(t)}</b></span></p>`;
      }
      justInsertedHr = false;
      isFirstLine = false;
      continue;
    }

    // 불릿 (▪ • - *)
    if (/^[▪•\-\*]\s/.test(tok)) {
      const t = tok.replace(/^[▪•\-\*]\s+/, '');
      html += `<p style="${font}line-height:1.8;margin:0 0 5px 0;"><span style="color:rgb(51,51,51);">▪ ${inline(t)}</span></p>`;
      justInsertedHr = false;
      isFirstLine = false;
      continue;
    }

    // 빈 줄
    if (!tok) {
      html += '<p><span> </span></p>';
      continue;
    }

    // 일반 문단 → 문장 단위로 나눠 2문장씩 짧은 문단으로 렌더링 (가독성 개선)
    const sentences = splitIntoSentences(raw);
    const paraGroups = sentences.length > 1 ? groupSentences(sentences, 2) : [raw];
    for (const para of paraGroups) {
      html += `<p style="${font}line-height:2;margin:0 0 10px 0;"><span style="color:rgb(51,51,51);">${inline(para)}</span></p>`;
    }
    justInsertedHr = false;
    isFirstLine = false;
  }
  return html;
}

function buildIntroHtml(text, fontName, iconCycler, style) {
  const st = style || POST_STYLE_PRESETS[0];
  const font = fontName ? `font-family:'${fontName}',sans-serif;` : '';
  const label = `<p style="${font}margin:0 0 4px 0;"><span style="color:rgb(136,136,136);font-size:13px;">📋 이 글에서 알아볼 내용</span></p>`;
  const inner = label + toNaverHtml(text, fontName, iconCycler, false, st);
  return `<div style="margin:0 0 16px 0;">` + tableBox(inner, `border:2px solid ${st.h2.border};`, st.h2.bg) + `</div>`;
}
function buildBodyHtml(text, fontName, iconCycler, style) {
  return toNaverHtml(text, fontName, iconCycler, true, style);
}

// 본문 텍스트를 N번째 대주제(H2, ##) 제목 직전에서 둘로 나눈다.
// H2 개수가 N개 미만이면 null 반환(분할 불가 → 호출측에서 기존 방식으로 폴백)
function splitBodyAtNthH2(text, n) {
  const preprocessed = (text || '')
    .replace(/([^\n#])(#{2,4}\s)/g, '$1\n$2')
    .replace(/([^\n])(▪\s)/g,     '$1\n$2');
  const lines = preprocessed.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const tok = lines[i].trim();
    if (/^#{1,2}\s+/.test(tok)) {
      count++;
      if (count === n) {
        return {
          before: lines.slice(0, i).join('\n'),
          after:  lines.slice(i).join('\n'),
        };
      }
    }
  }
  return null;
}

// 본문 텍스트를 N번째 중분류(H3, ###) 제목 직전에서 둘로 나눈다.
// splitBodyAtNthH2와 동일한 방식이지만 ### 라인만 센다. H3 개수가 N개
// 미만이면 null 반환(분할 불가 → 호출측에서 폴백). 2026-07-07: 이미지
// 5장 배치를 위해 신규 추가.
function splitBodyAtNthH3(text, n) {
  const preprocessed = (text || '')
    .replace(/([^\n#])(#{2,4}\s)/g, '$1\n$2')
    .replace(/([^\n])(▪\s)/g,     '$1\n$2');
  const lines = preprocessed.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const tok = lines[i].trim();
    if (/^###\s+/.test(tok)) {
      count++;
      if (count === n) {
        return {
          before: lines.slice(0, i).join('\n'),
          after:  lines.slice(i).join('\n'),
        };
      }
    }
  }
  return null;
}

// 2026-07-07: 헤딩 기반 분할(splitBodyAtNthH2/H3)이 실패했을 때를 위한
// 안전망. AI가 "대분류 정확히 2개" 같은 구조 규칙을 못 지키면 기존에는
// 남은 텍스트를 전부 마지막 조각(part4)에 몰아넣었는데, 그 결과 이미지
// 2~4번이 삽입될 자리가 사라져 발행/미리보기 화면에서 사진 여러 장이
// 중간 글 없이 한꺼번에 붙어 나오는 문제가 있었다(사용자 스크린샷으로
// 확인, 2026-07-07). 이를 막기 위해, 헤딩 분할이 안 될 때는 텍스트를
// 문단(빈 줄) 단위로 우선 나누고, 문단이 부족하면 문장 단위로 나눠
// 글자수 기준 N등분한다 — 어떤 경우든 이미지가 본문 전체에 고르게
// 퍼지도록 보장하기 위함(정확히 헤딩 경계에 맞진 않을 수 있음).
function splitTextIntoNParts(text, n) {
  const t = (text || '').trim();
  if (!t || n <= 1) return [t];

  // 유닛(문단/문장) 개수 기준으로 n개 그룹에 균등 분배 — 글자수 누적 기준으로
  // 하면 마지막 유닛에서 목표치를 이미 넘겨 뒷 조각이 빈 문자열로 남는
  // 경우가 있어(예: 8문장/target 4등분 시 마지막 조각이 공백), 유닛 개수
  // 기준 분배로 항상 각 조각에 최소 1개 유닛이 배정되도록 보장한다.
  const distribute = (units, joiner) => {
    const total = units.length;
    const buckets = Array.from({ length: n }, () => []);
    const perBucket = total / n;
    for (let i = 0; i < total; i++) {
      let idx = Math.floor(i / perBucket);
      if (idx >= n) idx = n - 1;
      buckets[idx].push(units[i]);
    }
    return buckets.map(arr => arr.join(joiner));
  };

  // 1순위: 문단(빈 줄) 단위 분할 — 문단 수가 n개 이상이어야 의미 있게 나뉨
  const paras = t.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paras.length >= n) return distribute(paras, '\n\n');

  // 2순위: 문장 단위 분할(문단이 부족한 긴 텍스트 대비)
  const sentences = t.split(/(?<=[.!?다요]\s)/).map(s => s.trim()).filter(Boolean);
  if (sentences.length >= n) return distribute(sentences, ' ');

  // 3순위: 그마저 부족하면(아주 짧은 본문) 문단/문장 단위 그대로 사용
  const units = paras.length ? paras : (sentences.length ? sentences : [t]);
  return distribute(units, paras.length ? '\n\n' : ' ');
}

// 본문을 이미지 5장 삽입 지점 기준 4조각으로 나눈다 (2026-07-07, 이미지
// 3장→5장 확대). 구조 규칙(대분류 정확히 2개 × 중분류 각 2개, 대분류당
// 소분류 1개 — [[body-structure-fixed-counts]])을 전제로:
//   part1 = 대분류1 제목+도입문장 (중분류1 시작 전)
//   part2 = 중분류1 전체 내용 (중분류2 시작 전까지)
//   part3 = 중분류2 전체 내용 (대분류2 시작 전까지)
//   part4 = 대분류2 전체 (본문 끝까지)
// 삽입 순서: 이미지1(도입부 뒤, 이 함수 밖에서 처리) → part1 → 이미지2 →
// part2 → 이미지3 → part3 → 이미지4 → part4 → 이미지5 → 마무리
// AI가 구조를 정확히 안 지켜 H2/H3 개수가 모자라면, 해당 구간만
// splitTextIntoNParts로 글자수 기준 대체 분할한다 — 이미지가 정확히
// 헤딩 경계에 맞진 않을 수 있지만, 항상 4조각으로 고르게 나뉘어 이미지가
// 본문 전체에 퍼지도록 보장한다(2026-07-07, 사진 몰림 문제 근본 수정).
function splitBodyForImages(body) {
  const h2 = splitBodyAtNthH2(body, 2);
  if (!h2) {
    const [p1, p2, p3, p4] = splitTextIntoNParts(body, 4);
    return { part1: p1 || null, part2: p2 || null, part3: p3 || null, part4: p4 || body };
  }
  const sec1 = h2.before; // 대분류1 전체
  const sec2 = h2.after;  // 대분류2 전체

  const h3a = splitBodyAtNthH3(sec1, 1);
  if (!h3a) {
    const [p1, p2] = splitTextIntoNParts(sec1, 2);
    return { part1: p1 || sec1, part2: p2 || null, part3: null, part4: sec2 };
  }
  const part1 = h3a.before;
  const rest1 = h3a.after; // 중분류1부터 대분류1 끝까지

  const h3b = splitBodyAtNthH3(rest1, 2);
  if (!h3b) {
    const [p2, p3] = splitTextIntoNParts(rest1, 2);
    return { part1, part2: p2 || rest1, part3: p3 || null, part4: sec2 };
  }

  return { part1, part2: h3b.before, part3: h3b.after, part4: sec2 };
}

function buildConclusionHtml(text, fontName, iconCycler, style) {
  const st = style || POST_STYLE_PRESETS[0];
  const font = fontName ? `font-family:'${fontName}',sans-serif;` : '';
  const label = `<p style="${font}margin:0 0 4px 0;"><span style="color:rgb(136,136,136);font-size:13px;">✏️ 마무리</span></p>`;
  const inner = label + toNaverHtml(text, fontName, iconCycler, false, st);
  return `<div style="margin:8px 0 0 0;">` + tableBox(inner, `border:1.5px solid ${st.h2.border};`, st.h2.bg) + `</div>`;
}

// ── 관련 사이트 링크 섹션 HTML ───────────────────────────────
function buildLinksHtml(links, fontName) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const font = fontName ? `font-family:'${fontName}',sans-serif;` : '';
  let inner = `<p style="${font}margin:0 0 4px 0;"><span style="color:rgb(136,136,136);font-size:13px;"><b>🔗 관련 사이트</b></span></p>`;
  for (const link of links) {
    const name = String(link.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const url  = String(link.url  || '').replace(/"/g,'&quot;');
    if (!url) continue;
    inner += `<p style="${font}margin:0;">`
      + `<span style="color:rgb(51,51,51);">${name} : </span>`
      + `<span style="color:rgb(3,199,90);">${url}</span>`
      + `</p>`;
  }
  return `<div style="margin:20px 0 8px 0;">` + tableBox(inner, 'border:1.5px solid rgb(208,240,216);', 'rgb(249,255,251)') + `</div>`;
}

// ── 썸네일 생성 (offscreen BrowserWindow → PNG 파일) ──────────
// (2026-07-02) "포토 프레임형"으로 전면 개편: Unsplash 실사 배경(주제 검색) +
// 이중 테두리 + 코너 액센트 + 외곽선(스트로크) 큰 제목 글자. 환경설정 →
// 글 설정 → "썸네일 스타일"에서 특정 색상을 고르면 테두리·뱃지·제목
// 글자색이 그 색으로 고정되고, "랜덤"(styleIdx=-1)이면 THUMB_ACCENTS
// 팔레트에서 매 발행마다 무작위 선택된다. Unsplash 키가 없거나 검색/
// 다운로드 실패 시 그라데이션 배경으로 자동 폴백(이때도 같은 색상 규칙 적용).
const THUMB_STYLES = [
  { bg:'linear-gradient(135deg,#0f5c2e,#03c75a)', accent:'#4ade80' }, // 0 초록
  { bg:'linear-gradient(135deg,#0d1b4b,#2563eb)', accent:'#93c5fd' }, // 1 블루
  { bg:'linear-gradient(135deg,#7c2d00,#f97316)', accent:'#fed7aa' }, // 2 오렌지
  { bg:'linear-gradient(135deg,#1e0a3c,#7c3aed)', accent:'#c4b5fd' }, // 3 퍼플
  { bg:'linear-gradient(135deg,#0f172a,#0f4c3a)', accent:'#6ee7b7' }, // 4 민트
  { bg:'linear-gradient(135deg,#4a0f2a,#e11d48)', accent:'#fda4af' }, // 5 레드
];

// 테두리·코너 액센트·제목 글자색 랜덤 팔레트
const THUMB_ACCENTS = [
  '#5EDECE', // 틸
  '#FF8A78', // 코랄
  '#E6BE6E', // 골드
  '#F0F0F0', // 화이트
  '#8FD694', // 라임그린
  '#8FB8FF', // 라이트블루
  '#FFD166', // 옐로우
  '#D291FF', // 라벤더
];

// ── 썸네일 디자인 22종 (2026-07-13 신규) ──────────────────────
// 환경설정 → 글 설정 → 썸네일 자동 생성 → "썸네일 디자인 선택" 드롭다운에서
// 고를 수 있는 고정 프레임 디자인 22개. 기존 "포토 프레임형"(Unsplash 배경 +
// 이중 테두리)은 designId==='default'일 때 100% 그대로 유지되며, 이 22개는
// 전부 사진 배경 없이 자체 색상/그라데이션 배경 + 장식 테두리로만 구성된다.
// group: 환경설정 드롭다운 <optgroup> 라벨. kind: renderThumbDesignChrome()의
// 렌더러 분기 키. logos: 'N' 로고 마크를 표시할 모서리('tl'/'tr'/'bl'/'br') 목록.
const THUMB_DESIGNS = [
  // ── 블랙 골드 럭셔리 (A1~A4) ──
  { id:'lux-scroll', label:'블랙 골드 스크롤', group:'블랙 골드 럭셔리', kind:'ornate-corner',
    bg:'#141414', accent:'#d4af37', logos:[] },
  { id:'lux-line', label:'블랙 화이트 라인', group:'블랙 골드 럭셔리', kind:'thin-line-round',
    bg:'#141414', accent:'#f2f2f2', logoAccent:'#d4af37', logos:['tr','bl'] },
  { id:'lux-bars-panel', label:'블랙 골드 바+패널', group:'블랙 골드 럭셔리', kind:'bars-panel',
    bg:'#141414', accent:'#d4af37', logos:['tl','tr','bl','br'] },
  { id:'lux-zigzag', label:'블랙 골드 지그재그', group:'블랙 골드 럭셔리', kind:'zigzag',
    bg:'#141414', accent:'#d4af37', logos:['tl','br'] },

  // ── 파스텔 일러스트 (B1~B9) — 2026-07-13 재해석: 사진 배경 위 코너/테두리 장식으로 축소 ──
  { id:'pastel-memphis', label:'멤피스 도형', group:'파스텔 일러스트', kind:'memphis',
    bg:'#f6c9d6', accent:'#f3d250', accents:{ mint:'#7fd1bd', yellow:'#f3d250', cloud:'#ffffff' }, logos:[] },
  { id:'pastel-sunburst', label:'선버스트 하늘', group:'파스텔 일러스트', kind:'sunburst',
    bg:'#8fd3f4', accent:'#ffb347', flowerColor:'#ff8ba0', logos:[] },
  { id:'pastel-fabric', label:'테라코타 텍스처', group:'파스텔 일러스트', kind:'texture-fabric',
    bg:'#b5502e', accent:'#e8c9a0', logos:[] },
  { id:'pastel-mint-frame', label:'민트 화이트 프레임', group:'파스텔 일러스트', kind:'frame-square',
    bg:'#8fd9c4', accent:'#ffffff', borderWidth:2, double:false, cutCorners:false, logos:['tl','bl'] },
  { id:'pastel-doodle', label:'옐로우 별 도들', group:'파스텔 일러스트', kind:'doodle-stars',
    bg:'#eddc3f', accent:'#fffbe0', logos:[] },
  { id:'pastel-papercut', label:'올리브 페이퍼컷', group:'파스텔 일러스트', kind:'paper-cut-wave',
    bg:'#5f6b3f', accent:'#e8dcb8', layerColors:['#8a7b4f','#c9b98a','#e8dcb8'], logos:[] },
  { id:'pastel-ivory-frame', label:'아이보리 로즈골드 프레임', group:'파스텔 일러스트', kind:'frame-square',
    bg:'linear-gradient(135deg,#f5f0e4,#ece2cc)', accent:'#c9a876', borderWidth:1, double:false, cutCorners:false, logos:[] },
  { id:'pastel-sunset-scallop', label:'선셋 스캘럽 프레임', group:'파스텔 일러스트', kind:'scallop-frame',
    bg:'linear-gradient(160deg,#ff8c42,#ff5f6d)', accent:'#ffffff', logos:[] },
  { id:'pastel-lavender-dots', label:'라벤더 스캘럽 도트', group:'파스텔 일러스트', kind:'scalloped-edge-dots',
    bg:'#c9b8e8', accent:'#ffffff', dotColor:'#ffffff', dotColor2:'#c9b8e8', logos:[] },

  // ── 컬러 + 골드 (C1~C9) ──
  { id:'color-navy-frame', label:'네이비 골드 더블프레임', group:'컬러 + 골드', kind:'frame-square',
    bg:'#0d2b4e', accent:'#d4af37', borderWidth:2, double:true, cutCorners:false, logos:['tl','br'] },
  { id:'color-charcoal-frame', label:'차콜 골드 컷코너', group:'컬러 + 골드', kind:'frame-square',
    bg:'#2b2b2b', accent:'#d4af37', borderWidth:2, double:true, cutCorners:true, logos:['tl','br'] },
  { id:'color-green-bars', label:'그린 골드 바', group:'컬러 + 골드', kind:'bars-only',
    bg:'#0b3d24', accent:'#d4af37', logos:[] },
  { id:'color-gold-frame', label:'골드 그라데이션 프레임', group:'컬러 + 골드', kind:'frame-square',
    bg:'linear-gradient(135deg,#d9b876,#b8935a)', accent:'#f0dca0', borderWidth:1, double:false, cutCorners:false, logos:[] },
  { id:'color-white-frame', label:'화이트 골드 프레임', group:'컬러 + 골드', kind:'frame-square',
    bg:'#ffffff', accent:'#d4af37', borderWidth:2, double:false, cutCorners:false, logos:['tr'] },
  { id:'color-gray-papercut', label:'그레이 골드 페이퍼컷', group:'컬러 + 골드', kind:'paper-cut-wave',
    bg:'#c9c9c9', accent:'#e9d38f', layerColors:['#a8863f','#d4af37','#e9d38f'], logos:[] },
  { id:'color-terracotta-diamond', label:'테라코타 골드 다이아프레임', group:'컬러 + 골드', kind:'frame-square',
    bg:'#a8471f', accent:'#d4af37', borderWidth:2, double:true, cutCorners:true, logos:['bl'] },
  { id:'color-mint-frame', label:'민트 골드 프레임', group:'컬러 + 골드', kind:'frame-square',
    bg:'#a8d5c5', accent:'#d4af37', borderWidth:2, double:false, cutCorners:false, logos:['bl'] },
  { id:'color-purple-dots', label:'퍼플 골드 도트클러스터', group:'컬러 + 골드', kind:'dot-cluster',
    bg:'#4a3060', accent:'#d4af37', dotColor:'#d4af37', logos:['tr'] },
];

// 선택된 코너들에 작은 'N' 로고 마크(이탤릭 세리프)를 배치하는 공용 헬퍼.
// accent: 2026-07-13부터 design.accent가 아니라 사용자가 "썸네일 스타일"에서
// 고른(또는 랜덤 뽑힌) 색을 그대로 전달받는다 — 로고도 테두리와 같은 색 계열로 통일.
function thumbLogoMarks(design, positions, accent) {
  const posCss = { tl:'top:20px;left:22px', tr:'top:20px;right:22px', bl:'bottom:20px;left:22px', br:'bottom:20px;right:22px' };
  const color = design.logoAccent || accent || '#d4af37';
  return (positions || []).map(p =>
    '<div class="thumb-logo" style="position:absolute;' + posCss[p] + ';z-index:4;color:' + color +
    ';font-size:22px;font-weight:900;font-style:italic;font-family:Georgia,\'Times New Roman\',serif;' +
    'text-shadow:0 1px 3px rgba(0,0,0,.5)">N</div>'
  ).join('');
}

// design.kind별 장식 테두리/모티프를 CSS+HTML로 렌더링. 2026-07-13부터는 모든 디자인이
// 기존 포토 프레임형과 동일하게 Unsplash 사진 배경 + 어두운 오버레이 위에 이 장식만
// 얹는 구조(사용자 요청: "사진 배경은 유지, 테두리 디자인만 변경"). 원래 참고 이미지에서
// 배경 전체가 디자인이었던 6종(memphis/sunburst/texture-fabric/doodle-stars/
// paper-cut-wave×2/scalloped-edge-dots)은 사진을 가리지 않도록 코너·모서리 장식으로
// 축소 재해석했다(사용자 확인 완료, 2026-07-13).
// accent: 2026-07-13(2차 수정) — design은 이제 "테두리 모양"만 결정하고 실제 색은
// design.accent 대신 이 파라미터(사용자가 "썸네일 스타일"에서 고른/랜덤 뽑힌 색)를
// 쓴다. design.accent는 Settings.jsx 미리보기 카드가 기본값을 보여줄 때만 쓰이고
// 실제 생성(generateThumbnail)에는 관여하지 않는다.
function renderThumbDesignChrome(design, accent) {
  const acc = accent || design.accent || '#d4af37';
  const logos = thumbLogoMarks(design, design.logos, accent);

  if (design.kind === 'ornate-corner') {
    const css = '.d-outer{position:absolute;inset:14px;border:2px solid ' + acc + ';border-radius:4px;z-index:2}' +
      '.d-inner{position:absolute;inset:22px;border:1px solid ' + acc + ';border-radius:2px;z-index:2}' +
      '.d-dot{position:absolute;width:9px;height:9px;background:' + acc + ';transform:rotate(45deg);z-index:2;box-shadow:0 0 8px ' + acc + '}';
    const html = '<div class="d-outer"></div><div class="d-inner"></div>' +
      '<div class="d-dot" style="top:9px;left:9px"></div>' +
      '<div class="d-dot" style="top:9px;right:9px"></div>' +
      '<div class="d-dot" style="bottom:9px;left:9px"></div>' +
      '<div class="d-dot" style="bottom:9px;right:9px"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'thin-line-round') {
    const css = '.d-round{position:absolute;inset:16px;border:2px solid ' + acc + ';border-radius:22px;z-index:2}';
    const html = '<div class="d-round"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'bars-panel') {
    const css = '.d-bar{position:absolute;left:16px;right:16px;height:24px;background:' + acc + ';z-index:2;border-radius:2px}' +
      '.d-bar-top{top:16px} .d-bar-bottom{bottom:16px}';
    const html = '<div class="d-bar d-bar-top"></div><div class="d-bar d-bar-bottom"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'zigzag') {
    const css = '.d-zz{position:absolute;background:repeating-linear-gradient(45deg, ' + acc + ' 0 6px, transparent 6px 13px);z-index:2}' +
      '.d-zz-t{top:16px;left:16px;right:16px;height:22px}' +
      '.d-zz-b{bottom:16px;left:16px;right:16px;height:22px}' +
      '.d-zz-l{top:38px;bottom:38px;left:16px;width:22px}' +
      '.d-zz-r{top:38px;bottom:38px;right:16px;width:22px}';
    const html = '<div class="d-zz d-zz-t"></div><div class="d-zz d-zz-b"></div><div class="d-zz d-zz-l"></div><div class="d-zz d-zz-r"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'memphis') {
    const mint = (design.accents && design.accents.mint) || '#7fd1bd';
    const yellow = (design.accents && design.accents.yellow) || '#f3d250';
    const cloud = (design.accents && design.accents.cloud) || '#ffffff';
    const css = '.d-tri{position:absolute;width:0;height:0;z-index:2;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))}' +
      '.d-sq{position:absolute;z-index:2;box-shadow:0 1px 4px rgba(0,0,0,.4)}' +
      '.d-cloud{position:absolute;bottom:0;left:0;width:130px;height:46px;z-index:2;background:' + cloud + ';' +
      'border-radius:50% 50% 0 0 / 100% 100% 0 0;opacity:.92}' +
      '.d-star{position:absolute;z-index:2;color:' + yellow + ';font-size:28px;text-shadow:0 1px 3px rgba(0,0,0,.5)}';
    const html = '<div class="d-tri" style="top:22px;left:22px;border-left:38px solid ' + mint + ';border-bottom:38px solid transparent;"></div>' +
      '<div class="d-sq" style="top:36px;right:36px;width:28px;height:28px;background:' + yellow + ';transform:rotate(18deg);border-radius:4px"></div>' +
      '<div class="d-cloud"></div>' +
      '<div class="d-star" style="top:22px;right:64px">\u2605</div>' + logos;
    return { css, html };
  }

  if (design.kind === 'sunburst') {
    const flower = design.flowerColor || '#ff8ba0';
    const css = '.d-ray{position:absolute;width:160px;height:160px;border-radius:50%;' +
      'background:repeating-conic-gradient(' + acc + ' 0 6deg, transparent 6deg 18deg);z-index:2;opacity:.6}' +
      '.d-flower{position:absolute;bottom:14px;z-index:2;font-size:18px;color:' + flower + ';text-shadow:0 1px 2px rgba(0,0,0,.5)}';
    const html = '<div class="d-ray" style="top:-80px;left:-80px"></div>' +
      '<div class="d-ray" style="bottom:-80px;right:-80px"></div>' +
      '<div class="d-flower" style="left:36px">\u2740</div>' +
      '<div class="d-flower" style="right:36px">\u2740</div>' + logos;
    return { css, html };
  }

  if (design.kind === 'texture-fabric') {
    // 원래는 배경 전체를 채우던 직물 텍스처 — 사진을 가리지 않도록 테두리 밴드로 축소.
    const css = '.d-fab{position:absolute;z-index:2;' +
      'background:repeating-linear-gradient(45deg, ' + acc + ' 0 4px, transparent 4px 9px),' +
      'repeating-linear-gradient(-45deg, rgba(255,255,255,.35) 0 4px, transparent 4px 9px),' +
      'rgba(0,0,0,.25)}' +
      '.d-fab-t{top:14px;left:14px;right:14px;height:20px}' +
      '.d-fab-b{bottom:14px;left:14px;right:14px;height:20px}' +
      '.d-fab-l{top:34px;bottom:34px;left:14px;width:20px}' +
      '.d-fab-r{top:34px;bottom:34px;right:14px;width:20px}';
    const html = '<div class="d-fab d-fab-t"></div><div class="d-fab d-fab-b"></div><div class="d-fab d-fab-l"></div><div class="d-fab d-fab-r"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'frame-square') {
    const bw = design.borderWidth || 2;
    const clip = design.cutCorners
      ? 'clip-path:polygon(18px 0,calc(100% - 18px) 0,100% 18px,100% calc(100% - 18px),calc(100% - 18px) 100%,18px 100%,0 calc(100% - 18px),0 18px);'
      : '';
    const css = '.d-fq{position:absolute;inset:20px;border:' + bw + 'px solid ' + acc + ';z-index:2;' + clip + '}' +
      '.d-fq-in{position:absolute;inset:27px;border:1px solid ' + acc + ';z-index:2;' + clip + '}';
    const html = '<div class="d-fq"></div>' + (design.double ? '<div class="d-fq-in"></div>' : '') + logos;
    return { css, html };
  }

  if (design.kind === 'doodle-stars') {
    const css = '.d-ds{position:absolute;z-index:2;color:' + acc + ';font-size:20px;text-shadow:0 1px 3px rgba(0,0,0,.6)}';
    const stars = [[26,26],[494,34],[34,486],[478,490],[260,22],[22,260],[506,260],[260,506]];
    const html = stars.map(function(p, i) {
      const glyph = (i % 2 === 0) ? '\u2605' : '\u2618';
      return '<div class="d-ds" style="top:' + p[1] + 'px;left:' + p[0] + 'px">' + glyph + '</div>';
    }).join('') + logos;
    return { css, html };
  }

  if (design.kind === 'paper-cut-wave') {
    // 원래는 캔버스 중앙을 채우던 3겹 블롭 — 사진을 가리지 않도록 대각선 코너 2곳의
    // 작은 장식 클러스터로 축소.
    const layers = design.layerColors || [acc, acc, acc];
    const css = '.d-blob{position:absolute;z-index:2;border-radius:42% 58% 61% 39% / 42% 39% 61% 58%;opacity:.85}';
    const corner = function(top, left, bottom, right) {
      const pos0 = (top !== null ? 'top:' + top + 'px;' : 'bottom:' + bottom + 'px;') + (left !== null ? 'left:' + left + 'px;' : 'right:' + right + 'px;');
      return '<div class="d-blob" style="' + pos0 + 'width:120px;height:120px;background:' + layers[0] + '"></div>' +
        '<div class="d-blob" style="' + pos0.replace(/(-?\d+)px/g, function(m, n) { return (parseInt(n, 10) + 16) + 'px'; }) + 'width:88px;height:88px;background:' + layers[1] + '"></div>' +
        '<div class="d-blob" style="' + pos0.replace(/(-?\d+)px/g, function(m, n) { return (parseInt(n, 10) + 32) + 'px'; }) + 'width:56px;height:56px;background:' + layers[2] + '"></div>';
    };
    const html = corner(-30, -30, null, null) + corner(null, null, -30, -30) + logos;
    return { css, html };
  }

  if (design.kind === 'scallop-frame') {
    const clip = 'clip-path:polygon(24px 0,calc(100% - 24px) 0,100% 24px,100% calc(100% - 24px),calc(100% - 24px) 100%,24px 100%,0 calc(100% - 24px),0 24px);';
    const css = '.d-sf{position:absolute;inset:18px;border:2px solid ' + acc + ';z-index:2;' + clip + '}' +
      '.d-sf-in{position:absolute;inset:26px;border:1px solid ' + acc + ';z-index:2;' + clip + '}' +
      '.d-sun{position:absolute;top:24px;left:24px;width:16px;height:16px;border-radius:50%;background:' + acc + ';z-index:2;box-shadow:0 0 8px rgba(0,0,0,.4)}';
    const html = '<div class="d-sf"></div><div class="d-sf-in"></div><div class="d-sun"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'scalloped-edge-dots') {
    const dc = design.dotColor || '#ffffff';
    const dc2 = design.dotColor2 || dc;
    const css = 'body{border-radius:34px}' +
      '.d-sed-border{position:absolute;inset:14px;border:2px solid ' + acc + ';border-radius:24px;z-index:2}' +
      '.d-dot2{position:absolute;border-radius:50%;z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.4)}';
    const positions = [[40,40,7,dc],[70,80,5,dc2],[100,50,4,dc],[40,460,6,dc2],[90,490,5,dc],
      [460,60,5,dc],[500,100,7,dc2],[440,470,6,dc],[490,500,5,dc2],[470,430,4,dc]];
    const dots = positions.map(function(p) {
      return '<div class="d-dot2" style="left:' + p[0] + 'px;top:' + p[1] + 'px;width:' + p[2] + 'px;height:' + p[2] + 'px;background:' + p[3] + '"></div>';
    }).join('');
    return { css, html: '<div class="d-sed-border"></div>' + dots + logos };
  }

  if (design.kind === 'bars-only') {
    const css = '.d-bar2{position:absolute;left:16px;right:16px;height:22px;background:' + acc + ';z-index:2;border-radius:2px}';
    const html = '<div class="d-bar2" style="top:16px"></div><div class="d-bar2" style="bottom:16px"></div>' + logos;
    return { css, html };
  }

  if (design.kind === 'dot-cluster') {
    const dc = design.dotColor || acc;
    const css = '.d-dc{position:absolute;border-radius:50%;background:' + dc + ';z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.4)}';
    const pts = [[0,0,8],[18,10,6],[6,24,5],[30,28,7],[14,42,4],[38,6,5],[44,20,6],[24,50,5]];
    const cluster = function(ox, oy) {
      return pts.map(function(p) {
        return '<div class="d-dc" style="left:' + (ox + p[0]) + 'px;top:' + (oy + p[1]) + 'px;width:' + p[2] + 'px;height:' + p[2] + 'px"></div>';
      }).join('');
    };
    const html = cluster(24, 24) + cluster(452, 452) + logos;
    return { css, html };
  }

  // 알 수 없는 kind — 안전 폴백(테두리 없이 로고만)
  return { css: '', html: logos };
}

// 2026-07-06 신규: 한국어 복합어(예: "강아지 운동장")는 언스플래시(주로 영어
// 태그 기반) 검색과 궁합이 안 좋아 그대로는 매칭되는 사진이 0건인 경우가
// 많음 — 검색어의 첫 단어(핵심 명사)만 남겨 더 넓은 범위로 재검색할 때 쓰는
// 단순화 함수. 공백이 없거나 이미 한 단어면 원본과 동일한 값을 반환.
function simplifyKeywordQuery(query) {
  return (query || '').trim().split(/\s+/)[0] || '';
}

// 2026-07-07 신규: 단순화 재검색으로도 0건일 때, 설정된 AI(환경설정의
// AI 제공자/모델)에게 짧은 영어 검색어로 번역을 요청해 마지막으로 한 번 더
// 재검색할 때 쓴다. 번역 결과가 비정상(빈 문자열/너무 김/따옴표 등 포함)이면
// null을 반환해 호출측이 그대로 실패 처리하도록 함 — 번역 실패가 발행
// 자체를 막지는 않는다.
async function translateKeywordToEnglish(koreanQuery) {
  const q = (koreanQuery || '').trim();
  if (!q) return null;
  try {
    const prompt = `Translate the following Korean keyword or short phrase into a simple, common English word or short phrase suitable for a stock photo search (like Unsplash). Respond with ONLY the translated English word or phrase — no explanation, no quotes, no punctuation, no Korean.\n\nKorean: ${q}`;
    const result = await callAI(prompt, 30);
    const translated = (result.text || '')
      .trim()
      .split('\n')[0]
      .replace(/["'.\u2026]/g, '')
      .trim();
    if (!translated || translated.length > 60 || /[\uac00-\ud7a3]/.test(translated)) return null;
    return translated;
  } catch (e) {
    writeLog('WARN', 'IMAGE', 'AI 키워드 영어 번역 실패', e.message);
    return null;
  }
}

// 2026-07-07 신규: 검색어로 0건이면 (1) 단순화 재검색 → (2) 그래도 0건이면
// AI 영어 번역 재검색까지 시도하는 공용 3단계 검색 헬퍼. writeLog의
// context 인자(THUMB/LOOP/IMAGE 등)로 어느 기능에서 호출됐는지 로그에 남긴다.
// perPage/page는 searchUnsplash에 그대로 전달.
async function searchUnsplashWithFallback(apiKey, query, perPage, context, page = 1) {
  let pool = await searchUnsplash(apiKey, query, perPage, page);
  if (pool.length) return pool;

  const simplified = simplifyKeywordQuery(query);
  if (simplified && simplified !== query) {
    writeLog('WARN', context, `Unsplash 검색 결과 0건 — 키워드 단순화 후 재검색`, `"${query}" → "${simplified}"`);
    pool = await searchUnsplash(apiKey, simplified, perPage, page);
    if (pool.length) {
      writeLog('INFO', context, `단순화된 키워드로 이미지 확보 성공`, `"${simplified}"`);
      return pool;
    }
  }

  const translated = await translateKeywordToEnglish(simplified || query);
  if (translated) {
    writeLog('WARN', context, `단순화 재검색도 0건 — AI 영어 번역 후 재검색 시도`, `"${simplified || query}" → "${translated}"`);
    pool = await searchUnsplash(apiKey, translated, perPage, page);
    if (pool.length) {
      writeLog('INFO', context, `영어 번역 키워드로 이미지 확보 성공`, `"${translated}"`);
      return pool;
    }
  }

  writeLog('WARN', context, 'Unsplash 검색 결과 없음(단순화/영어 번역 재검색 모두 실패)', `검색어: "${query}"`);
  return [];
}

// 주어진 이미지 URL을 다운로드해 base64 data URL로 변환. 실패 시 null.
// (2026-07-07) fetchThumbBackgroundPhoto의 다운로드 로직을 재사용 가능하게 분리 —
// 썸네일 배경으로 "직접 선택한 이미지"를 쓸 때도 동일한 변환이 필요해서 추출.
async function fetchImageAsDataUrl(url) {
  try {
    if (!url) return null;
    const imgRes = await fetch(url);
    if (!imgRes.ok) return null;
    const arrBuf = await imgRes.arrayBuffer();
    const mime = imgRes.headers.get('content-type') || 'image/jpeg';
    const b64 = Buffer.from(arrBuf).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch (e) {
    writeLog('WARN', 'THUMB', '이미지 다운로드/인코딩 실패', e.message);
    return null;
  }
}

// Unsplash에서 주제 관련 사진을 검색해 base64 data URL로 반환. 실패 시 null.
async function fetchThumbBackgroundPhoto(query) {
  try {
    const apiKey = getStore().get('settings.unsplashKey', '');
    if (!apiKey || !query) return null;
    const pool = await searchUnsplashWithFallback(apiKey, query, 10, 'THUMB');
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return await fetchImageAsDataUrl(pick.url);
  } catch (e) {
    writeLog('WARN', 'THUMB', 'Unsplash 배경 사진 검색/다운로드 실패', e.message);
    return null;
  }
}

async function generateThumbnail(title, hashtags, customBgUrl = null) {
  const os = require('os');

  // 환경설정 "썸네일 스타일" 값: -1(또는 범위 밖) = 랜덤, 0~5 = 특정 색상 고정
  const styleIdx = getStore().get('settings.thumbnailStyle', -1);
  const isFixedStyle = styleIdx >= 0 && styleIdx < THUMB_STYLES.length;

  // 테두리·코너 뱃지·제목 글자색: 고정 스타일이면 해당 색, 랜덤이면 팔레트에서 무작위
  const accent = isFixedStyle
    ? THUMB_STYLES[styleIdx].accent
    : THUMB_ACCENTS[Math.floor(Math.random() * THUMB_ACCENTS.length)];

  // 환경설정 "썸네일 디자인 선택" 값(2026-07-13 신규): 'default'면 기존
  // border-outer/inner+PICK 뱃지 테두리를 그대로 사용, 그 외 22종 중 하나를
  // 고른 상태면 해당 design 객체를 찾아 아래에서 (동일한 사진 배경 위에)
  // renderThumbDesignChrome()의 장식 테두리로 교체한다.
  const designId = getStore().get('settings.thumbnailDesign', 'default');
  const design = designId !== 'default' ? THUMB_DESIGNS.find(d => d.id === designId) : null;

  // 배경 사진 검색어: 첫 해시태그 우선, 없으면 제목
  const query = (Array.isArray(hashtags) && hashtags[0])
    ? String(hashtags[0]).replace(/^#+/, '').trim()
    : (title || '').trim();
  // 2026-07-13: design(22종 중 하나)을 선택해도 Unsplash 사진 검색은 항상 그대로
  // 수행한다 — 사용자가 "사진 배경은 유지하고 테두리 디자인만 바뀌길" 원한다고
  // 명시적으로 확인했기 때문에, 22종은 전부 기존 포토 프레임형과 같은 사진 배경 위에
  // 얹는 장식일 뿐 사진 검색 로직 자체는 default와 동일하게 유지한다.
  let bgPhoto = customBgUrl ? await fetchImageAsDataUrl(customBgUrl) : null;
  if (!bgPhoto) bgPhoto = await fetchThumbBackgroundPhoto(query);

  // 사진을 못 가져온 경우에만 그라데이션 폴백 스타일 선택 (색상 고정 시 동일 인덱스 사용).
  // design이 선택된 경우엔 THUMB_STYLES 대신 design.bg를 폴백 색상으로 사용.
  const fallbackStyle = isFixedStyle
    ? THUMB_STYLES[styleIdx]
    : THUMB_STYLES[Math.floor(Math.random() * THUMB_STYLES.length)];

  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    // frame:false + useContentSize:true — 네이티브 창 프레임(타이틀바 등)이
    // width/height에 섞여 실제 콘텐츠(webContents) 영역이 540x540보다 작아지는
    // 문제 방지. 이 불일치가 있으면 캡처된 이미지가 540x540으로 강제 리사이즈될 때
    // 세로 방향으로 불균등하게 늘어나 테두리가 한쪽으로 쏠려 보임(2026-07-02 확인).
    const thumbWin = new BrowserWindow({
      width: 540, height: 540, show: false, frame: false, useContentSize: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    // 제목 줄바꿈 처리: 실제 제목의 띄어쓰기(단어 경계)를 최대한 보존하며
    // 7자 기준으로 줄바꿈. 다만 공백 없이 이어진 단어가 기준보다 길면
    // 그 단어만 강제로 잘라 넘침을 방지.
    const safeTitle = (title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const TITLE_LINE_LIMIT = 7;
    const rawWords = safeTitle.split(/\s+/).filter(Boolean);
    const titleLines = [];
    let cur = '';
    for (const w of rawWords) {
      if (w.length > TITLE_LINE_LIMIT) {
        if (cur) { titleLines.push(cur); cur = ''; }
        let rest = w;
        while (rest.length > TITLE_LINE_LIMIT) {
          titleLines.push(rest.slice(0, TITLE_LINE_LIMIT));
          rest = rest.slice(TITLE_LINE_LIMIT);
        }
        cur = rest;
        continue;
      }
      const candidate = cur ? cur + ' ' + w : w;
      if (cur && candidate.length > TITLE_LINE_LIMIT) { titleLines.push(cur); cur = w; }
      else { cur = candidate; }
    }
    if (cur) titleLines.push(cur);
    const titleHtml = titleLines.join('<br>');

    // 제목 줄 수에 따라 폰트 크기를 단계적으로 축소(2026-07-03) — 글 생성 프롬프트의
    // 제목 목표 길이(30~50자)가 7자/줄 래핑 기준 6~7줄 이상으로 늘어날 수 있어,
    // 4줄 이하(기존 검증된 디자인, 58px)는 그대로 두고 그 이상만 축소해 부제(BLOG POST)·
    // 하단 문구와 겹치지 않게 한다.
    const TITLE_FONT_STEPS = [
      { maxLines: 4, fontSize: 58, stroke: 5 },
      { maxLines: 5, fontSize: 50, stroke: 4 },
      { maxLines: 6, fontSize: 44, stroke: 4 },
      { maxLines: Infinity, fontSize: 38, stroke: 3 },
    ];
    const { fontSize: titleFontSize, stroke: titleStroke } =
      TITLE_FONT_STEPS.find(s => titleLines.length <= s.maxLines);

    // 2026-07-13(2차 수정): design 선택 여부와 무관하게 사진 배경 + 어두운
    // 오버레이는 항상 동일하게 적용(기존 포토 프레임형과 100% 같은 사진/오버레이
    // 로직). design은 테두리 "모양"만 결정하고, 실제 색(테두리·제목 글자·로고)은
    // 항상 위에서 계산한 accent(환경설정 "썸네일 스타일" 고정 색 또는 랜덤) 하나로
    // 통일 — design.accent는 더 이상 실제 생성에 쓰지 않는다(사용자 요청: 디자인
    // 선택과 색상 선택을 완전히 분리).
    const chrome = design ? renderThumbDesignChrome(design, accent) : null;
    const titleTextColor = accent;
    const borderAccent = accent;

    const bgTint = design ? design.bg : fallbackStyle.bg;
    const bodyBg = bgPhoto
      ? `background:url('${bgPhoto}') center/cover no-repeat, ${bgTint}`
      : `background:${bgTint}`;

    const defaultChromeCss = `
      .border-outer{position:absolute;inset:10px;border:3px solid ${borderAccent};border-radius:18px;z-index:2}
      .border-inner{position:absolute;inset:18px;border:1px solid ${borderAccent};border-radius:12px;z-index:2}
      .corner-badge{position:absolute;top:20px;left:20px;z-index:3;
        display:flex;align-items:center;justify-content:center;
        background:${borderAccent};color:#1a1a1a;font-size:18px;font-weight:800;
        letter-spacing:1.5px;padding:10px 22px;border-radius:10px;line-height:1}`;
    const defaultChromeHtml = `
      <div class="border-outer"></div>
      <div class="border-inner"></div>
      <div class="corner-badge">PICK</div>`;

    // 포토 프레임형(기본): 사진 배경 + 어둡게 오버레이 + 이중 테두리 + 코너 액센트.
    // 디자인 선택형(22종): 동일한 사진 배경 + 오버레이 위에 renderThumbDesignChrome()
    // 장식 테두리만 교체(사용자 요청 2026-07-13: "사진 배경은 유지, 테두리만 변경").
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:540px;height:540px;position:relative;overflow:hidden;
        ${bodyBg};
        font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
      .overlay{position:absolute;inset:0;
        background:linear-gradient(180deg, rgba(0,0,0,0.32), rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.68))}
      ${design ? '' : defaultChromeCss}
      ${design ? chrome.css : ''}
      /* 제목을 기준점으로 삼아 캔버스 정중앙(상하좌우)에 절대 배치.
         부제는 로드 후 스크립트로 제목 실측 위치를 구해 "제목 위 20px"에
         재배치(폰트 렌더링 오차 없이 정확한 간격 보장), 하단 문구는 테두리와
         겹치지 않도록 충분히 위로 띄운 고정 위치에 별도 배치 */
      .title{position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);
        z-index:3;color:${titleTextColor};-webkit-text-stroke:${titleStroke}px #000;paint-order:stroke fill;
        font-size:${titleFontSize}px;font-weight:800;text-align:center;line-height:1.12;padding:0 46px}
      .subtitle{position:absolute;left:0;right:0;z-index:3;text-align:center;
        color:#eee;font-size:16px;letter-spacing:3px;font-weight:500}
      .footer{position:absolute;bottom:28px;left:0;right:0;text-align:center;
        color:rgba(255,255,255,0.7);font-size:13px;z-index:3}
    </style></head><body>
      <div class="overlay"></div>
      ${design ? chrome.html : defaultChromeHtml}
      <div class="subtitle">BLOG POST</div>
      <div class="title">${titleHtml}</div>
      <div class="footer">@ 네이버 블로그</div>
      <script>
        (function() {
          var title = document.querySelector('.title');
          var subtitle = document.querySelector('.subtitle');
          if (title && subtitle) {
            var tRect = title.getBoundingClientRect();
            var sRect = subtitle.getBoundingClientRect();
            subtitle.style.top = Math.max(20, tRect.top - 20 - sRect.height) + 'px';
          }
        })();
      </script>
    </body></html>`;

    thumbWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    thumbWin.webContents.once('did-finish-load', async () => {
      try {
        await new Promise(r => setTimeout(r, 600));
        const img = await thumbWin.webContents.capturePage({ x:0, y:0, width:540, height:540 });
        // Retina(2x) 디스플레이에서 실제 픽셀은 1080x1080 → 정확히 540x540으로 강제
        const resized = img.resize({ width: 540, height: 540, quality: 'best' });
        const buf = resized.toPNG();
        const tmpPath = path.join(os.tmpdir(), `naver_thumb_${Date.now()}.png`);
        fs.writeFileSync(tmpPath, buf);
        if (!thumbWin.isDestroyed()) thumbWin.destroy();
        writeLog('INFO', 'THUMB', '썸네일 생성 성공', `${tmpPath} (design=${design ? design.id : 'default'}, bg=${bgPhoto ? 'unsplash' : 'gradient'}, accent=${borderAccent})`);
        done(tmpPath);
      } catch (e) {
        writeLog('WARN', 'THUMB', '썸네일 캡처 실패', e.message);
        if (!thumbWin.isDestroyed()) thumbWin.destroy();
        done(null);
      }
    });

    setTimeout(() => {
      writeLog('WARN', 'THUMB', '썸네일 생성 타임아웃');
      if (!thumbWin.isDestroyed()) thumbWin.destroy();
      done(null);
    }, 10000);
  });
}

// ── 네이버 블로그 발행 (쿠키 로드 + 에디터 자동입력) ─────────
// forcedStyleIndex: 2026-07-07 신규 — 발행 전 미리보기(post:renderPreview)에서
// 이미 확정한 색상 프리셋 인덱스(0~4)가 있으면 그대로 재사용해, 미리보기 때
// 본 색상과 실제 발행 색상이 달라지는 문제(랜덤 프리셋이 두 번 다르게 뽑히는
// 경우)를 방지한다. null/미지정이면 기존처럼 설정값 기준으로 새로 뽑는다.
// ── 2026-07-13 신규: 발행 DOM 자동화 견고화 ──────────────────────
// 문제: 발행 흐름의 여러 지점(본문 포커스/폰트 버튼/태그 input/발행 버튼/
// 카테고리/최종 발행 버튼 등)이 executeJavaScript로 요소를 "딱 한 번만"
// 조회하고 실패하면 바로 포기하는 구조였음. 개발용 PC에서는 항상 성공했지만,
// 다른(더 느리거나 사양이 다른) PC에서 렌더링이 조금만 늦어도 요소가 아직
// 안 그려진 시점에 조회해 실패하는 사례가 실제로 확인됨(2026-07-13, 지인
// 테스트 PC). 이 프로젝트의 다른 부분(공개설정/태그패널/예약캘린더)은 이미
// 이런 재시도 방식으로 잘 동작하고 있어, 그 패턴을 공용 헬퍼로 뽑아 발행
// 흐름 전체에 일관되게 적용한다.
// queryFn: 매 시도마다 실행할 조회 함수(기존 executeJavaScript 호출을 그대로
// 감싸기만 함 — 조회 로직 자체는 절대 변경하지 않음). isFound: 그 결과가
// "성공"인지 판정하는 함수. 성공하면 즉시 반환(첫 시도에 성공하면 기존과
// 100% 동일한 속도/동작), 실패하면 attempts 횟수까지 intervalMs 간격으로
// 재시도 후 마지막 결과를 반환한다.
async function retryUntilFound(queryFn, isFound, attempts = 6, intervalMs = 350) {
  let result = null;
  for (let i = 0; i < attempts; i++) {
    result = await queryFn();
    if (isFound(result)) return result;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, intervalMs));
  }
  return result;
}

async function publishToNaver({ accountId, postId, title, thumbText = null, content, hashtags, images, category, visibility, autoThumbnail, headless = true, reserveAt = null, preGeneratedThumbPath = null, forcedStyleIndex = null, thumbBgUrl = null }) {
  // reserveAt: 'YYYY-MM-DDTHH:MM' 형식이 오면, 즉시발행과 동일하게 전체 자동화를
  // 수행하되 최종 발행 직전 네이버 자체 "예약" 기능으로 등록한다(2026-07-03).
  // 이렇게 하면 앱/PC가 꺼져 있어도 네이버 서버가 예약 시각에 알아서 발행한다.
  // 전체 선택 단축키는 OS마다 다름(macOS: Cmd/meta, Windows/Linux: Ctrl) —
  // Electron sendInputEvent의 modifiers 값도 그에 맞춰야 실제로 동작함.
  // (2026-07-02: 'ctrl' 고정 사용 시 macOS에서 아무것도 선택되지 않는 버그 확인)
  const SELECT_ALL_MOD = process.platform === 'darwin' ? 'meta' : 'ctrl';

  // content.links 기본값
  if (!Array.isArray(content.links)) content.links = [];
  const { getDB } = require('./src/db');
  const db = getDB();

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account?.cookies_encrypted) throw new Error('계정 정보를 찾을 수 없습니다');

  const cookies = JSON.parse(decrypt(account.cookies_encrypted) || '[]');
  let naverId = account.naver_id;

  // 독립 파티션 세션 생성 (발행마다 격리)
  const partition = `noinit:publish-${postId || Date.now()}`;
  const ses = electronSession.fromPartition(partition);

  // 쿠키 주입
  for (const cookie of cookies) {
    try {
      const urlBase = cookie.domain?.startsWith('.')
        ? `https://www${cookie.domain}`
        : `https://${cookie.domain || 'naver.com'}`;
      await ses.cookies.set({
        url: urlBase,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        expirationDate: cookie.expirationDate,
      });
    } catch { /* 개별 쿠키 오류 무시 */ }
  }

  // ── 실제 네이버 ID 실시간 추출 ────────────────────────────────
  // 저장된 ID가 임시값이거나 없으면 쿠키 세션으로 직접 확인
  const needsIdRefresh = !naverId || naverId.startsWith('naver_') || !isValidNaverId(naverId);
  if (needsIdRefresh) {
    writeLog('INFO', 'PUBLISH', '저장 ID 불량 — 실시간 ID 추출 시도', naverId || 'none');
    const extracted = await extractIdViaNetRedirect(ses);
    if (extracted) {
      naverId = extracted;
      db.prepare('UPDATE accounts SET naver_id = ? WHERE id = ?').run(naverId, accountId);
      writeLog('INFO', 'PUBLISH', '실시간 ID 추출 성공 → DB 업데이트', naverId);
    }
  }

  // 발행 창 생성 (headless=true → 백그라운드, false → 사용자에게 표시)
  const publishWin = new BrowserWindow({
    width: 1300,
    height: 860,
    title: `네이버 블로그 발행 — ${title}`,
    show: !headless,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
  });
  publishWin.setMenuBarVisibility(false);

  // 닫기 버튼으로 즉시 종료 (Naver SE3의 beforeunload 무시)
  publishWin.webContents.on('will-prevent-unload', (e) => e.preventDefault());

  // 여전히 ID를 모르면 로그인 상태로 my.naver 경유 — 리다이렉트에서 ID 캡처
  let writeUrl;
  if (naverId && !naverId.startsWith('naver_') && isValidNaverId(naverId)) {
    writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverId}`;
  } else {
    // 마지막 수단: blogId 없이 접속 → Naver가 로그인 세션으로 자동 라우팅
    writeUrl = 'https://blog.naver.com/PostWriteForm.naver';
    writeLog('WARN', 'PUBLISH', 'blogId 없이 글쓰기 폼 접속 시도');
  }

  // 리다이렉트 감지 → 실제 blogId 포착 + DB 갱신
  // ※ 경로 세그먼트 방식 제거 — PostView.naver 등 페이지명을 ID로 오인하는 버그 방지
  // ※ 유효 ID가 이미 확보된 경우 잠금(idLocked)으로 이후 덮어쓰기 차단
  let idLocked = !!(naverId && !naverId.startsWith('naver_') && isValidNaverId(naverId) && !naverId.includes('View') && !naverId.includes('Form') && !naverId.includes('List'));
  publishWin.webContents.on('did-navigate', (_, url) => {
    if (idLocked) return;
    // blogId= 쿼리 파라미터에서만 추출 (경로 세그먼트는 페이지명과 혼동 위험)
    const qm = url.match(/[?&]blogId=([a-zA-Z0-9][a-zA-Z0-9_]{2,19})(?:[&?#]|$)/i);
    if (qm) {
      const detectedId = qm[1].toLowerCase();
      if (isValidNaverId(detectedId) && !detectedId.startsWith('naver_')) {
        idLocked = true;  // 이후 추가 덮어쓰기 차단
        if (detectedId !== naverId) {
          naverId = detectedId;
          db.prepare('UPDATE accounts SET naver_id = ? WHERE id = ?').run(naverId, accountId);
          writeLog('INFO', 'PUBLISH', '리다이렉트에서 blogId 감지 → DB 업데이트', naverId);
        } else {
          writeLog('INFO', 'PUBLISH', '리다이렉트 blogId 확인 (변경 없음)', naverId);
        }
      }
    }
  });

  await publishWin.loadURL(writeUrl);

  // ### 마크다운 헤더 제거 (SE3에는 plain text로 입력)
  const stripMd = (text) => (text || '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');

  const tagList = (Array.isArray(hashtags) ? hashtags : [])
    .map(t => t.startsWith('#') ? t.slice(1) : t);  // SE3는 # 없이 입력

  // ── SE3 에디터 준비 대기 (최대 25초 폴링) ───────────────────
  writeLog('INFO', 'PUBLISH', 'SE3 에디터 초기화 대기 시작');
  await new Promise((resolve) => {
    let attempts = 0;
    const iv = setInterval(async () => {
      attempts++;
      if (publishWin.isDestroyed()) { clearInterval(iv); resolve(); return; }
      try {
        const ready = await publishWin.webContents.executeJavaScript(`
          !!(document.querySelector('.se-title-input') && document.querySelector('.se-main-container'))
        `);
        if (ready) { clearInterval(iv); resolve(); return; }
      } catch { /* 로딩 중 오류 무시 */ }
      if (attempts >= 50) { clearInterval(iv); resolve(); }
    }, 500);
  });
  if (publishWin.isDestroyed()) { writeLog('WARN', 'PUBLISH', '발행 창이 닫힘'); return { success: true }; }
  writeLog('INFO', 'PUBLISH', 'SE3 에디터 준비 완료 — 주입 시작');
  await new Promise(r => setTimeout(r, 800));

  // ── 도움말 패널 닫기 (show:false 창 호환 — reactFiber + DOM 숨김) ──
  const closeHelpPanel = async () => {
    return publishWin.webContents.executeJavaScript(`
      (function() {
        function reactClick(el) {
          var key = Object.keys(el).find(function(k){
            return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
          });
          if (!key) return false;
          var fiber = el[key];
          while (fiber) {
            if (fiber.memoizedProps && fiber.memoizedProps.onClick) {
              try { fiber.memoizedProps.onClick({ preventDefault:function(){}, stopPropagation:function(){} }); return true; } catch(e) {}
            }
            fiber = fiber.return;
          }
          return false;
        }

        // 1순위: 패널 자체 CSS 숨김 (가장 확실)
        var panelSels = [
          '.se-help-panel','[class*="helpPanel"]','[class*="help-panel"]',
          '[class*="HelpPanel"]','[class*="tutorial"]','[class*="guide-panel"]',
        ];
        for (var i = 0; i < panelSels.length; i++) {
          var panel = document.querySelector(panelSels[i]);
          if (panel && panel.offsetParent !== null) {
            panel.style.display = 'none';
            panel.style.visibility = 'hidden';
            return 'panel_hidden:' + panelSels[i];
          }
        }

        var allBtns = Array.from(document.querySelectorAll('button,[role="button"]'));

        // 2순위: 텍스트 기반
        var byText = allBtns.find(function(b) {
          var t = (b.textContent||'').trim();
          return (t==='닫기'||t==='확인'||t==='시작하기'||t==='×'||t==='X') && b.offsetParent!==null;
        });
        if (byText) { reactClick(byText) || byText.click(); return 'closed_text:' + (byText.textContent||'').trim(); }

        // 3순위: aria-label
        var byAria = allBtns.find(function(b) {
          var lbl = (b.getAttribute('aria-label')||'').toLowerCase();
          return (lbl==='닫기'||lbl==='close') && b.offsetParent!==null;
        });
        if (byAria) { reactClick(byAria) || byAria.click(); return 'closed_aria'; }

        // 4순위: 클래스 기반 셀렉터
        var closeSels = [
          '.se-help-panel .se-close-btn','.se-help-panel button',
          '[class*="help"] button[class*="close"]','[class*="help"] button',
          '[class*="guide"] button','.se-popup-button-close',
        ];
        for (var j = 0; j < closeSels.length; j++) {
          var el = document.querySelector(closeSels[j]);
          if (el && el.offsetParent !== null) { reactClick(el) || el.click(); return 'closed_sel:' + closeSels[j]; }
        }

        // 5순위: SVG 전용 버튼 (우측 패널 영역)
        var svgBtns = allBtns.filter(function(b) {
          var r = b.getBoundingClientRect();
          return !!b.querySelector('svg') && (b.textContent||'').trim().length === 0
            && r.width > 0 && r.height > 0 && r.left > 700;
        });
        if (svgBtns.length > 0) {
          svgBtns.sort(function(a,b){ return b.getBoundingClientRect().left - a.getBoundingClientRect().left; });
          var btn = svgBtns[0]; var r = btn.getBoundingClientRect();
          reactClick(btn) || btn.click();
          return 'closed_svg:x' + Math.round(r.left) + 'y' + Math.round(r.top);
        }

        var dbg = allBtns.slice(0,6).map(function(b){
          var r = b.getBoundingClientRect();
          return (b.className||'').slice(0,12) + '|' + (b.textContent||'').trim().slice(0,5) + '|x' + Math.round(r.left);
        }).join(' ');
        return 'not_found|' + dbg;
      })()
    `).catch(() => 'err');
  };

  // 에디터 로드 후 1.5초 대기 후 닫기 시도 (패널 늦게 렌더링됨)
  await new Promise(r => setTimeout(r, 1500));
  for (let hi = 0; hi < 4; hi++) {
    const helpResult = await closeHelpPanel();
    writeLog('INFO', 'PUBLISH', '도움말 닫기 시도' + (hi+1), String(helpResult).slice(0, 200));
    if (typeof helpResult === 'string' && (helpResult.startsWith('closed') || helpResult.startsWith('panel_hidden'))) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  // ── DOM 전체 스냅샷 (디버그) ────────────────────────────────
  const snap = await publishWin.webContents.executeJavaScript(`
    (function() {
      var info = [];
      // contenteditable 요소
      document.querySelectorAll('[contenteditable]').forEach(function(el, i) {
        var r = el.getBoundingClientRect();
        info.push('CE['+i+'] cls='+el.className+' tag='+el.tagName+' y='+Math.round(r.top));
      });
      // iframe
      document.querySelectorAll('iframe').forEach(function(fr, i) {
        info.push('IFRAME['+i+'] id='+fr.id+' src='+fr.src.slice(0,50));
      });
      // SE 관련 클래스
      ['se-main-container','se-wrap','se-editor','smartEditor','se2_inputarea'].forEach(function(c) {
        var el = document.querySelector('.'+c) || document.querySelector('#'+c);
        info.push(c+':'+(el?'FOUND':'NF'));
      });
      return info.join(' | ');
    })()
  `).catch(() => 'snap_error');
  writeLog('INFO', 'PUBLISH', 'DOM 스냅샷', snap);

  // ── ① 제목 입력 ─────────────────────────────────────────────
  // .se-title-text 는 이전 테스트에서 OK 확인
  const titleSels = [
    '.se-title-input [contenteditable="true"]',
    '.se-title-input [contenteditable]',
    '.se-title-text',
    'h2[contenteditable]',
    '[contenteditable]',  // 마지막 수단: 첫 번째 contenteditable
  ];
  let titleRect = null;
  for (const sel of titleSels) {
    const res = await publishWin.webContents.executeJavaScript(`
      (function() {
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height/2 + 5) };
      })()
    `).catch(() => null);
    if (res) { titleRect = res; writeLog('INFO', 'PUBLISH', '제목 셀렉터 OK', sel); break; }
  }

  if (titleRect) {
    // 실제 마우스 클릭으로 제목 영역 활성화
    publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: titleRect.x, y: titleRect.y, button: 'left', clickCount: 1 });
    publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: titleRect.x, y: titleRect.y, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 400));
    // 전체 선택(플랫폼별 Cmd/Ctrl+A) 후 붙여넣기
    publishWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [SELECT_ALL_MOD] });
    publishWin.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'A', modifiers: [SELECT_ALL_MOD] });
    await new Promise(r => setTimeout(r, 100));
    clipboard.writeText(title);
    publishWin.webContents.paste();
    writeLog('INFO', 'PUBLISH', '제목 paste 완료');
    await new Promise(r => setTimeout(r, 600));
  } else {
    writeLog('WARN', 'PUBLISH', '제목 요소 좌표 획득 실패');
  }

  // ── ② 본문 입력 — 도입부 → 이미지1 → 본문(대분류1 도입) → 이미지2 →
  //    본문(중분류1) → 이미지3 → 본문(중분류2) → 이미지4 → 본문(대분류2) →
  //    이미지5 → 마무리 (2026-07-07: 이미지 3장→5장 확대) ─────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const imgs = Array.isArray(images) ? images : [];

  // 폰트 설정 읽기
  const editorFont = (getStore().get('settings.editorFont', '') || '').trim();

  // 본문 영역 포커스는 pasteHtml 내부 focusBodyEditor()에서 JS로 처리
  await sleep(300);

  // 헬퍼: 본문 contenteditable 포커스 (JS 직접 — 헤드리스 창 대응)
  const focusBodyEditor = async () => {
    // 2026-07-13: 다른 PC에서 SE3 렌더링이 늦어 요소가 아직 없을 때를
    // 대비해 재시도(최대 6회, 350ms 간격) — 첫 시도에 찾으면 지금까지와
    // 완전히 동일하게 즉시 반환됨.
    return retryUntilFound(
      () => publishWin.webContents.executeJavaScript(`
      (function() {
        // SE3 본문 영역: title 제외한 contenteditable 중 가장 큰 것
        var candidates = Array.from(document.querySelectorAll('[contenteditable]'));
        var body = null;
        var maxArea = 0;
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          var cls = (el.className || '').toLowerCase();
          // title 계열 제외
          if (cls.includes('title') || cls.includes('subject')) continue;
          var r = el.getBoundingClientRect();
          if (r.height < 50) continue; // 너무 작은 요소 제외
          var area = r.width * r.height;
          if (area > maxArea) { maxArea = area; body = el; }
        }
        if (body) {
          body.focus();
          // 커서를 끝으로 이동
          try {
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(body);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch(e) {}
          return 'se3_focused:' + (body.className || '').slice(0, 60);
        }
        return 'se3_body_not_found';
      })()
    `).catch(() => 'focus_err'),
      (v) => typeof v === 'string' && v.startsWith('se3_focused:')
    );
  };

  // 헬퍼: HTML 주입 — SE3 표준 클립보드 붙여넣기
  // ※ 과거 코드는 input_buffer iframe에 execCommand('insertHTML')로 먼저 주입을 시도했으나
  //   (당시 "구형 SE2 에디터 경로"로 오인), 실제로는 새 글 작성 시 항상 SE3만 사용되고
  //   이 iframe은 SE3 내부 붙여넣기 버퍼로 추정됨. execCommand로 직접 주입하면 true는
  //   반환되지만 표(색상 박스) 서식과 텍스트가 소실되는 문제가 확인되어(2026-07-02),
  //   이 경로는 제거하고 실제 사용자가 Cmd+V 하는 것과 동일한 클립보드 붙여넣기만 사용.
  const pasteHtml = async (html, label) => {
    if (!html) return;

    // SE3 — webContents 포커스 + JS 본문 포커스 + clipboard paste (표준 붙여넣기 경로)
    // 헤드리스 창에서 SE3가 document.hasFocus()=false 시 paste 무시 → webContents.focus()로 해결
    publishWin.webContents.focus();            // renderer 내부 포커스 활성화
    await sleep(200);

    const focusResult = await focusBodyEditor();
    writeLog('INFO', 'PUBLISH', label + ' SE3 포커스', String(focusResult));
    await sleep(400); // SE3 React 재렌더링 안정화 대기

    clipboard.writeHTML(html);
    await sleep(150);
    publishWin.webContents.paste();
    writeLog('INFO', 'PUBLISH', label + ' SE3 clipboard paste');
    await sleep(900);
  };

  // 헬퍼: 이미지 클립보드 삽입 (사진 버튼 불필요)
  const insertImgSection = async (img, label) => {
    if (!img || !img.url) return;
    // 이미지 앞 줄바꿈
    publishWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    publishWin.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'Return' });
    await sleep(200);
    const ok = await insertImageViaClipboard(publishWin, img.url);
    writeLog('INFO', 'PUBLISH', label + ' 이미지 삽입', ok ? 'OK' : 'FAIL/SKIP');
    // 이미지 뒤 줄바꿈 (다음 섹션을 위해)
    await sleep(300);
    publishWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    publishWin.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'Return' });
    await sleep(200);
  };

  // ── 썸네일 생성 및 삽입 (본문 맨 앞) ────────────────────────
  if (autoThumbnail && title) {
    // 2026-07-07: 완전자동 발행 전 누락 검사 단계(processLoopStep)에서 이미
    // 썸네일을 한 번 생성해 성공 여부를 확인한 경우, 그 결과를 그대로
    // 재사용해 여기서 또 생성하지 않도록(중복 생성/불필요한 언스플래시
    // 요청 방지) preGeneratedThumbPath가 있으면 우선 사용한다.
    // 2026-07-08: 썸네일 전용 문구(thumbText)가 있으면 제목 대신 사용.
    const thumbPath = preGeneratedThumbPath || await generateThumbnail((thumbText || '').trim() || title, hashtags, thumbBgUrl);
    if (thumbPath) {
      try {
        const thumbBuf = fs.readFileSync(thumbPath);
        const { nativeImage: ni } = require('electron');
        const thumbImg = ni.createFromBuffer(thumbBuf);
        if (!thumbImg.isEmpty()) {
          clipboard.writeImage(thumbImg);
          publishWin.webContents.paste();
          await sleep(800);

          // 정렬 버튼 클릭 전, 삽입된 썸네일을 화면(뷰포트)에 스크롤해서 보이게 함
          // — 제목 입력 직후엔 스크롤이 아래로 내려가 있어 정렬 툴바가 화면 밖에
          //   있을 수 있고, 그 상태에서 좌표를 클릭하면 아무 반응이 없음.
          // 이 시점엔 썸네일이 첫/유일한 이미지이므로 se-is-selected 여부와
          // 무관하게 .se-section-image 첫 번째 요소를 기준으로 스크롤한다.
          // 2026-07-13: 재시도 추가(3회, 300ms) — 이미지 삽입 직후 DOM 반영이
          // 아직 안 끝났을 수 있음. 실패해도 이후 로직이 완전히 막히지는 않는
          // 낮은 우선순위 지점이라 재시도 횟수는 짧게 유지.
          const scrollResult = await retryUntilFound(
            () => publishWin.webContents.executeJavaScript(`
            (function() {
              var img = document.querySelector('.se-section-image');
              if (img && img.scrollIntoView) {
                img.scrollIntoView({ block: 'center', inline: 'nearest' });
                return 'scrolled';
              }
              return 'img_not_found';
            })()
          `).catch((e) => 'scroll_err:' + e.message),
            (v) => v === 'scrolled',
            3, 300
          );
          writeLog('INFO', 'PUBLISH', '썸네일 스크롤', String(scrollResult));
          await sleep(500); // 스크롤 + 리렌더링 안정화 대기

          // 스크롤 후 이미지가 실제로 선택 상태인지 보장하기 위해 이미지를 한 번 클릭
          // (paste 직후 선택 상태가 유지되지 않는 경우를 대비한 안전장치)
          // 2026-07-13: 재시도 추가(3회, 300ms)
          const imgClickPos = await retryUntilFound(
            () => publishWin.webContents.executeJavaScript(`
            (function() {
              var img = document.querySelector('.se-section-image');
              if (!img) return null;
              var r = img.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return null;
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 40)) };
            })()
          `).catch(() => null),
            (v) => !!v,
            3, 300
          );
          if (imgClickPos) {
            publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: imgClickPos.x, y: imgClickPos.y, button: 'left', clickCount: 1 });
            publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: imgClickPos.x, y: imgClickPos.y, button: 'left', clickCount: 1 });
            writeLog('INFO', 'PUBLISH', '썸네일 클릭(선택)', JSON.stringify(imgClickPos));
            await sleep(400);
          } else {
            writeLog('WARN', 'PUBLISH', '썸네일 요소 좌표 획득 실패 — 클릭 생략');
          }

          // 정렬 버튼(가운데 정렬로 전환되는 cycle-toggle 버튼) 좌표를
          // 스크롤/클릭 이후 다시 조회해서 클릭 — 3개(좌/중앙/우) 버튼 중
          // 현재 화면에 보이는(폭·높이 > 0) 것이 지금 상태(좌측)를 나타내며,
          // 클릭하면 다음 상태(가운데)로 전환됨.
          // 2026-07-13: 재시도 추가(3회, 300ms)
          const alignBtnResult = await retryUntilFound(
            () => publishWin.webContents.executeJavaScript(`
            (function() {
              var container = document.querySelector('.se-context-toolbar-cycle-toggle-container[data-name="align"]');
              if (!container) return { found:false, reason:'container_not_found' };
              var btns = Array.from(container.querySelectorAll('button'));
              var btn = btns.find(function(b) {
                var r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              });
              if (!btn) return { found:false, reason:'no_visible_button', total:btns.length };
              var r = btn.getBoundingClientRect();
              return { found:true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()
          `).catch((e) => ({ found:false, reason:'js_err:' + e.message })),
            (v) => v && v.found,
            3, 300
          );

          writeLog('INFO', 'PUBLISH', '썸네일 정렬 버튼 조회', JSON.stringify(alignBtnResult));

          if (alignBtnResult && alignBtnResult.found) {
            publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: alignBtnResult.x, y: alignBtnResult.y, button: 'left', clickCount: 1 });
            publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: alignBtnResult.x, y: alignBtnResult.y, button: 'left', clickCount: 1 });
            writeLog('INFO', 'PUBLISH', '썸네일 가운데 정렬 클릭', JSON.stringify(alignBtnResult));
            await sleep(300);
          } else {
            writeLog('WARN', 'PUBLISH', '썸네일 정렬 버튼 찾기 실패 — 좌측 정렬 상태로 유지됨');
          }

          // 썸네일 뒤 줄바꿈
          publishWin.webContents.sendInputEvent({ type:'keyDown', keyCode:'Return' });
          publishWin.webContents.sendInputEvent({ type:'keyUp',   keyCode:'Return' });
          await sleep(200);
          writeLog('INFO', 'PUBLISH', '썸네일 삽입 완료');
        }
        try { fs.unlinkSync(thumbPath); } catch {}
      } catch(e) {
        writeLog('WARN', 'PUBLISH', '썸네일 삽입 실패', e.message);
      }
    }
  }

  // 본문 서식 스타일(색상/아이콘 프리셋) — settings.postStyle(-1=랜덤, 0~4=고정)을
  // 이번 발행 1건에 대해 한 번만 뽑아 도입부/본문/마무리 전체에 동일하게 적용.
  // forcedStyleIndex가 있으면(발행 전 미리보기에서 이미 확정된 값) 그걸 그대로 사용.
  const postStylePreset = (forcedStyleIndex !== null && forcedStyleIndex >= 0 && forcedStyleIndex < POST_STYLE_PRESETS.length)
    ? POST_STYLE_PRESETS[forcedStyleIndex]
    : resolvePostStyle(store.get('settings.postStyle', -1));

  // 대주제(H2) 아이콘 순환자 — 도입부→본문→마무리 전체에서 선택된 프리셋의
  // 아이콘 목록을 공유 순환
  const iconCycler = makeIconCycler(postStylePreset.h2.icons);

  // 도입부 (HTML 빌더 — 폰트 포함)
  await pasteHtml(buildIntroHtml(content.intro, editorFont, iconCycler, postStylePreset), '도입부');
  // 이미지 1 (도입부 아래, 본문 시작 전)
  await insertImgSection(imgs[0], '이미지1');

  // 본문 — 2026-07-07: 이미지 3장 → 5장 확대에 따라 본문을 4조각으로
  // 나눠 대분류1 도입문장 뒤 / 중분류1→2 경계 / 대분류2 시작 지점에도
  // 이미지를 추가 삽입 (splitBodyForImages 참고: [[body-structure-fixed-counts]]).
  // 일부 분할이 실패하면(AI가 H2/H3 개수를 정확히 안 지킨 경우) 해당
  // 이미지 삽입을 건너뛰고 남은 텍스트를 이어붙이며, 끝까지 중간 이미지를
  // 하나도 못 넣은 예외적인 경우엔 본문 전체 뒤에서 한꺼번에 삽입한다
  // (이미지가 통째로 버려지지 않도록 하는 안전장치).
  const { part1, part2, part3, part4 } = splitBodyForImages(content.body);
  let usedMidImages = false;
  if (part1) {
    await pasteHtml(buildBodyHtml(part1, editorFont, iconCycler, postStylePreset), '본문(대분류1 도입)');
    await insertImgSection(imgs[1], '이미지2');
    usedMidImages = true;
  }
  if (part2) {
    await pasteHtml(buildBodyHtml(part2, editorFont, iconCycler, postStylePreset), '본문(중분류1)');
    await insertImgSection(imgs[2], '이미지3');
    usedMidImages = true;
  }
  if (part3) {
    await pasteHtml(buildBodyHtml(part3, editorFont, iconCycler, postStylePreset), '본문(중분류2)');
    await insertImgSection(imgs[3], '이미지4');
    usedMidImages = true;
  }
  await pasteHtml(buildBodyHtml(part4, editorFont, iconCycler, postStylePreset), '본문(대분류2)');
  if (!usedMidImages) {
    await insertImgSection(imgs[1], '이미지2');
    await insertImgSection(imgs[2], '이미지3');
    await insertImgSection(imgs[3], '이미지4');
  }

  // 이미지 5 (마무리 시작 지점 — 2026-07-07: 기존엔 마무리 "뒤"였으나
  // 마무리를 읽는 도중 시각적 전환을 주도록 마무리 "시작 지점"으로 변경)
  await insertImgSection(imgs[4], '이미지5');
  // 마무리
  await pasteHtml(buildConclusionHtml(content.conclusion, editorFont, iconCycler, postStylePreset), '마무리');
  // 관련 사이트 링크 섹션 (links가 있을 때만)
  if (content.links && content.links.length > 0) {
    await pasteHtml(buildLinksHtml(content.links, editorFont), '관련 사이트');
  }

  // ── 에디터 폰트 적용 (본문 전체 선택 후 상단 서식 툴바에서 실제 클릭) ──
  // (2026-07-02) 인라인 font-family CSS는 과거 SE2 execCommand 붙여넣기
  // 경로에서 스타일이 제거되던 것과 같은 이유로 반영되지 않았던 것으로
  // 추정. 이번엔 실제 사용자가 하듯 전체 선택(Ctrl+A) 후 툴바의 "서체 변경"
  // 버튼 → 드롭다운에서 목표 폰트 옵션을 진짜 마우스 클릭으로 선택.
  // 버튼 셀렉터는 실제 네이버 에디터 DOM Inspect로 확인한 값:
  //   토글 버튼: button[data-name="font-family"][data-type="label-select"]
  //   옵션 버튼: button[data-name="font-family"][data-role="option"]
  //             (하위 span.se-toolbar-option-label 텍스트로 폰트명 매칭)
  if (editorFont) {
    publishWin.webContents.focus();
    await sleep(150);

    // (2026-07-02) focusBodyEditor()로 특정 컴포넌트(se-module-text) 안쪽에
    // 커서를 두면 Cmd/Ctrl+A가 "그 컴포넌트 안"만 선택하고 전체 문서를
    // 선택하지 못함(SE3가 컴포넌트별로 로컬 편집 영역을 가짐). 실제
    // 사용자가 수동 테스트로 확인한 대로, 모든 컴포넌트 바깥의 "빈 캔버스
    // 영역"을 클릭해야 문서 전체 선택 스코프로 포커스가 잡힘.
    // (2026-07-03) 1차 시도는 scrollIntoView({block:'end'})로 마지막
    // 컴포넌트의 "아래쪽"을 노렸는데, block:'end'는 그 컴포넌트의 하단을
    // 뷰포트 맨 아래에 딱 붙여버려서 정작 클릭할 빈 공간이 화면 밖으로
    // 밀려남(좌표 y가 창 높이(860)에 거의 딱 붙어 있었던 게 그 증거).
    // block:'center'로 바꿔 아래쪽 여백을 확보하고, 클릭 좌표도 뷰포트
    // 높이를 넘지 않도록 clamp 처리.
    await publishWin.webContents.executeJavaScript(`
      (function() {
        var comps = document.querySelectorAll('.se-component');
        if (comps.length) comps[comps.length - 1].scrollIntoView({ block: 'center' });
      })()
    `).catch(() => null);
    await sleep(400); // 스크롤 안정화 대기

    const emptyAreaPos = await publishWin.webContents.executeJavaScript(`
      (function() {
        var comps = document.querySelectorAll('.se-component');
        if (!comps.length) return null;
        var last = comps[comps.length - 1];
        var r = last.getBoundingClientRect();
        var y = Math.min(r.bottom + 60, window.innerHeight - 30);
        return { x: Math.round(r.left + 20), y: Math.round(y) };
      })()
    `).catch(() => null);
    writeLog('INFO', 'PUBLISH', '폰트 적용 - 빈 영역 좌표 조회', JSON.stringify(emptyAreaPos));

    if (emptyAreaPos) {
      publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: emptyAreaPos.x, y: emptyAreaPos.y, button: 'left', clickCount: 1 });
      publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: emptyAreaPos.x, y: emptyAreaPos.y, button: 'left', clickCount: 1 });
      writeLog('INFO', 'PUBLISH', '폰트 적용 - 빈 영역 클릭', JSON.stringify(emptyAreaPos));
      await sleep(300);
    } else {
      // 폴백: 기존 방식(특정 컴포넌트 포커스)이라도 시도
      const fontFocusResult = await focusBodyEditor();
      writeLog('WARN', 'PUBLISH', '폰트 적용 - 빈 영역 못 찾음, 폴백 포커스', String(fontFocusResult));
      await sleep(300);
    }

    publishWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [SELECT_ALL_MOD] });
    publishWin.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'A', modifiers: [SELECT_ALL_MOD] });
    writeLog('INFO', 'PUBLISH', '폰트 적용 - 전체 선택(' + SELECT_ALL_MOD + '+A)');
    await sleep(300);

    // 2026-07-13: 재시도 추가(5회, 350ms)
    const fontBtnPos = await retryUntilFound(
      () => publishWin.webContents.executeJavaScript(`
      (function() {
        var btn = document.querySelector('button[data-name="font-family"][data-type="label-select"]');
        if (!btn) return null;
        var r = btn.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()
    `).catch(() => null),
      (v) => !!v,
      5, 350
    );
    writeLog('INFO', 'PUBLISH', '폰트 버튼 조회', JSON.stringify(fontBtnPos));

    if (fontBtnPos) {
      publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: fontBtnPos.x, y: fontBtnPos.y, button: 'left', clickCount: 1 });
      publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: fontBtnPos.x, y: fontBtnPos.y, button: 'left', clickCount: 1 });
      await sleep(400);

      // 2026-07-13: 재시도 추가(5회, 350ms)
      const fontOptResult = await retryUntilFound(
        () => publishWin.webContents.executeJavaScript(`
        (function() {
          var target = ${JSON.stringify(editorFont)};
          var opts = Array.from(document.querySelectorAll('button[data-name="font-family"][data-role="option"]'));
          var match = opts.find(function(b) {
            var label = b.querySelector('.se-toolbar-option-label');
            var t = label ? (label.textContent || '').trim() : (b.textContent || '').trim();
            return t === target;
          });
          if (!match) {
            var dbg = opts.slice(0, 12).map(function(b) {
              var l = b.querySelector('.se-toolbar-option-label');
              return l ? (l.textContent || '').trim() : '?';
            }).join(' / ');
            return { found: false, debug: dbg };
          }
          var r = match.getBoundingClientRect();
          return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()
      `).catch((e) => ({ found: false, debug: 'js_err:' + e.message })),
        (v) => v && v.found,
        5, 350
      );

      writeLog('INFO', 'PUBLISH', '폰트 옵션 조회', JSON.stringify(fontOptResult));

      if (fontOptResult && fontOptResult.found) {
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: fontOptResult.x, y: fontOptResult.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: fontOptResult.x, y: fontOptResult.y, button: 'left', clickCount: 1 });
        writeLog('INFO', 'PUBLISH', '폰트 옵션 클릭', JSON.stringify(fontOptResult));
        await sleep(500);
      } else {
        writeLog('WARN', 'PUBLISH', '폰트 옵션 찾기 실패 — 인라인 CSS만 적용된 상태로 유지');
      }
    } else {
      writeLog('WARN', 'PUBLISH', '폰트 버튼 찾기 실패 — 인라인 CSS만 적용된 상태로 유지');
    }
  }

  // ── ③ 태그 입력 ─────────────────────────────────────────────
  if (tagList.length > 0) {
    await new Promise(r => setTimeout(r, 600));

    // 페이지 하단으로 스크롤 → 태그 input 노출
    await publishWin.webContents.executeJavaScript(
      'window.scrollTo(0, document.body.scrollHeight);'
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    // 태그 input 탐색: placeholder 다국어 + 클래스명 fallback
    // 2026-07-13: 재시도 추가(6회, 400ms) — 다른 PC에서 렌더링이 늦어 이
    // 시점에 아직 input이 없을 수 있음.
    const tagInfo = await retryUntilFound(
      () => publishWin.webContents.executeJavaScript(`
      (function() {
        var inputs = Array.from(document.querySelectorAll('input, textarea'));
        var tagKw = ['태그', 'tag', 'Tag', '해시태그', 'hashtag'];
        // 1순위: placeholder에 태그 관련 단어 포함
        var found = inputs.find(function(inp) {
          return tagKw.some(function(k) { return (inp.placeholder||'').toLowerCase().includes(k.toLowerCase()); });
        });
        // 2순위: 클래스명에 'tag' 포함
        if (!found) {
          found = inputs.find(function(inp) {
            return (inp.className||'').toLowerCase().includes('tag');
          });
        }
        // 3순위: 가장 아래쪽에 있는 input (편집창 제외 — y > 600)
        if (!found) {
          var bottom = inputs.filter(function(inp) {
            var r = inp.getBoundingClientRect();
            return r.height > 0 && r.top > 600;
          });
          if (bottom.length) found = bottom[bottom.length - 1];
        }
        if (!found) {
          return { found: false, list: inputs.map(function(e,i){ return i+':'+e.placeholder+':y='+Math.round(e.getBoundingClientRect().top); }).join(' | ') };
        }
        var r = found.getBoundingClientRect();
        // 화면 밖에 있으면 스크롤해서 보이게
        found.scrollIntoView({ block: 'center' });
        return { found: true, x: Math.round(r.left + 30), y: Math.round(r.top + r.height/2), ph: found.placeholder };
      })()
    `).catch(() => null),
      (v) => v && v.found,
      6, 400
    );
    writeLog('INFO', 'PUBLISH', '태그 input', tagInfo ? JSON.stringify(tagInfo) : 'null');

    if (tagInfo && tagInfo.found) {
      await new Promise(r => setTimeout(r, 300));
      publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: tagInfo.x, y: tagInfo.y, button: 'left', clickCount: 1 });
      publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: tagInfo.x, y: tagInfo.y, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 400));
      // 태그는 쉼표 구분으로 한 번에 입력
      const tagStr = tagList.slice(0, 30).join(',');
      clipboard.writeText(tagStr);
      publishWin.webContents.paste();
      await new Promise(r => setTimeout(r, 300));
      publishWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      publishWin.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'Return' });
      writeLog('INFO', 'PUBLISH', '태그 paste 완료', tagStr.slice(0, 80));
    } else {
      writeLog('WARN', 'PUBLISH', '태그 input 못 찾음', tagInfo?.list?.slice(0, 200) || '');
    }
  }

  // ── ④ 발행 버튼 클릭 → 발행 패널 자동 설정 ─────────────────
  await sleep(800);

  // 에디터 상단 발행 버튼 클릭
  // 2026-07-13: 재시도 추가(6회, 400ms) — 매 발행마다 항상 거치는 지점이라
  // 실패 시 파급력이 큼.
  const publishBtnPos = await retryUntilFound(
    () => publishWin.webContents.executeJavaScript(`
    (function() {
      var btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      var found = btns.find(function(b) {
        var t = (b.textContent || '').trim();
        return (t === '발행' || t.startsWith('발행')) && b.getBoundingClientRect().top < 200;
      });
      if (!found) return null;
      var r = found.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()
  `).catch(() => null),
    (v) => !!v,
    6, 400
  );

  if (publishBtnPos) {
    publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: publishBtnPos.x, y: publishBtnPos.y, button: 'left', clickCount: 1 });
    publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: publishBtnPos.x, y: publishBtnPos.y, button: 'left', clickCount: 1 });
    writeLog('INFO', 'PUBLISH', '발행 버튼 클릭', `x=${publishBtnPos.x} y=${publishBtnPos.y}`);
    await sleep(2200);  // 패널 애니메이션 대기
  } else {
    writeLog('WARN', 'PUBLISH', '발행 버튼 못 찾음 — 패널 설정 건너뜀');
  }

  // 발행 패널이 열렸으면 카테고리·공개설정·태그 자동 입력
  if (publishBtnPos) {
    // ── 카테고리 설정 (React fiber 직접 호출 방식) ─────────────
    if (category) {
      // ① <select> 직접 변경 시도
      // 2026-07-13: 재시도 추가(6회, 400ms) — 발행 패널이 카테고리 목록까지
      // 완전히 그려지기 전에 조회되면 못 찾을 수 있음.
      const catResult = await retryUntilFound(
        () => publishWin.webContents.executeJavaScript(`
        (function() {
          var cat = ${JSON.stringify(category)};

          // React fiber onClick 헬퍼
          function reactClick(el) {
            var key = Object.keys(el).find(function(k){ return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'); });
            if (!key) return false;
            var fiber = el[key];
            while (fiber) {
              if (fiber.memoizedProps && fiber.memoizedProps.onClick) {
                try { fiber.memoizedProps.onClick({ preventDefault: function(){}, stopPropagation: function(){} }); return true; } catch(e) {}
              }
              fiber = fiber.return;
            }
            return false;
          }

          // ① <select> 직접 변경
          var sel = document.querySelector('select');
          if (sel) {
            var opt = Array.from(sel.options).find(function(o){ return o.textContent.trim().includes(cat); });
            if (opt) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input',  { bubbles: true }));
              return 'SELECT_OK:' + opt.textContent.trim();
            }
          }

          // ② 드롭다운 항목 탐색 (스크롤 포함) → scrollIntoView + reactClick + 좌표 반환
          var items = Array.from(document.querySelectorAll('li, [role="option"], [role="listitem"]'));
          var target = items.find(function(el) {
            return (el.textContent||'').trim().includes(cat);
          });
          if (target) {
            target.scrollIntoView({ block: 'nearest' });
            var r = target.getBoundingClientRect();
            reactClick(target);
            return { method: 'fiber_item', ok: true, txt: target.textContent.trim(),
                     x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
          }

          // ③ 드롭다운 버튼 탐색 → 좌표만 반환 (JS click 없음, sendInputEvent로 열기)
          var SYSTEM_BTN = /^(전체보기|저장|발행|예약|취소|닫기|전체공개|비공개|이웃공개|서로이웃|댓글|공감|검색|링크|외부|CCL|설정|새 글|관리|통계|기본 서체|사진|MYBOX|동영상|스티커|인용구|구분선|파일|일정)$/;
          var dropBtn = null;
          // categ 클래스 우선
          dropBtn = Array.from(document.querySelectorAll('[class*="categ"], [class*="Categ"]')).find(function(el) {
            return el.getBoundingClientRect().height > 0;
          });
          if (!dropBtn) {
            // 발행 패널 버튼 중 시스템 버튼 제외
            dropBtn = Array.from(document.querySelectorAll('button')).find(function(el) {
              var t = (el.textContent||'').trim();
              var r = el.getBoundingClientRect();
              return r.height > 0 && r.top < 700 && !SYSTEM_BTN.test(t) && t.length > 0 && t.length <= 20;
            });
          }
          if (dropBtn) {
            var r = dropBtn.getBoundingClientRect();
            return { method: 'open_btn', x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
          }

          return 'CAT_NOT_FOUND';
        })()
      `).catch(() => 'ERR'),
        (v) => v && v !== 'ERR' && v !== 'CAT_NOT_FOUND',
        6, 400
      );
      writeLog('INFO', 'PUBLISH', '카테고리 설정', JSON.stringify(catResult).slice(0, 150));

      if (catResult && typeof catResult === 'object' && catResult.method === 'open_btn') {
        // 드롭다운 열기 → 항목 선택
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: catResult.x, y: catResult.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: catResult.x, y: catResult.y, button: 'left', clickCount: 1 });
        await sleep(700);
        // 2026-07-13: 재시도 추가(5회, 400ms)
        const catOptResult = await retryUntilFound(
          () => publishWin.webContents.executeJavaScript(`
          (function() {
            var cat = ${JSON.stringify(category)};
            function reactClick(el) {
              var key = Object.keys(el).find(function(k){ return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'); });
              if (!key) return false;
              var fiber = el[key];
              while (fiber) {
                if (fiber.memoizedProps && fiber.memoizedProps.onClick) {
                  try { fiber.memoizedProps.onClick({ preventDefault: function(){}, stopPropagation: function(){} }); return true; } catch(e) {}
                }
                fiber = fiber.return;
              }
              return false;
            }
            var items = Array.from(document.querySelectorAll('li, [role="option"]'));
            var target = items.find(function(el) {
              return (el.textContent||'').trim().includes(cat);
            });
            if (!target) return { ok: false, debug: '항목없음' };
            target.scrollIntoView({ block: 'nearest' });
            var r = target.getBoundingClientRect();
            reactClick(target);
            return { ok: true, x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), txt: target.textContent.trim() };
          })()
        `).catch(() => ({ ok: false })),
          (v) => v && v.ok,
          5, 400
        );
        if (catOptResult && catOptResult.ok) {
          publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: catOptResult.x, y: catOptResult.y, button: 'left', clickCount: 1 });
          publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: catOptResult.x, y: catOptResult.y, button: 'left', clickCount: 1 });
          writeLog('INFO', 'PUBLISH', '카테고리 옵션 클릭', catOptResult.txt);
          await sleep(400);
        }
      } else if (catResult && typeof catResult === 'object' && catResult.x) {
        // fiber_item의 sendInputEvent fallback
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: catResult.x, y: catResult.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: catResult.x, y: catResult.y, button: 'left', clickCount: 1 });
        await sleep(400);
      }
    }

    // ── 공개/비공개 설정 (전체공개 / 비공개만 지원) ─────────────
    // (2026-07-02) DOM checked 속성 + change/input 이벤트만으로는 리액트 내부
    // 상태가 갱신되지 않아(리액트는 라디오/체크박스 onChange를 내부적으로 click
    // 이벤트 기반 합성 이벤트로 처리) 로그는 성공으로 찍혀도 실제 발행 값은
    // 바뀌지 않는 문제가 있었음. 발행/카테고리/태그/썸네일 정렬 버튼과 동일하게
    // 실제 좌표에 마우스 클릭(mouseDown+mouseUp)을 시뮬레이션하고, 클릭 후
    // checked 상태를 재조회해 실제로 반영됐는지 검증한다. 태그 입력 등 후속
    // 상호작용 중 값이 되돌아가는 경우가 있어, 최종 발행 버튼 클릭 직전에도
    // 한 번 더 호출해 재확정한다.
    const visTarget = visibility === 'private' ? '비공개' : '전체공개';
    const applyVisibility = async (logLabel) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        // 1) 이미 선택돼 있는지 + 클릭할 좌표 한 번에 조회
        const info = await publishWin.webContents.executeJavaScript(`
          (function() {
            var target = ${JSON.stringify(visTarget)};
            var radios = Array.from(document.querySelectorAll('input[type="radio"]'));
            function labelOf(r) { return r.id ? document.querySelector('label[for="' + r.id + '"]') : null; }

            for (var i = 0; i < radios.length; i++) {
              var r = radios[i];
              var lbl = labelOf(r);
              var t = lbl ? (lbl.textContent||'').trim() : '';
              if (t === target && r.checked) return { already: true };
            }

            for (var i = 0; i < radios.length; i++) {
              var r = radios[i];
              var lbl = labelOf(r);
              var t = lbl ? (lbl.textContent||'').trim() : '';
              if (t !== target) continue;
              var el = lbl;
              var rect = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
              if (!el || rect.width === 0 || rect.height === 0) { el = r; rect = r.getBoundingClientRect(); }
              if (rect.width === 0 || rect.height === 0) continue;
              el.scrollIntoView({ block: 'nearest' });
              rect = el.getBoundingClientRect();
              return { found: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
            }

            // 부모 텍스트 매칭 폴백 (label 연결이 없는 커스텀 마크업 대비)
            for (var i = 0; i < radios.length; i++) {
              var r = radios[i];
              var el2 = r.parentElement;
              for (var d = 0; d < 3 && el2; d++) {
                var t2 = (el2.textContent || '').replace(/\\s+/g, ' ').trim();
                if (t2 === target) {
                  var rect2 = el2.getBoundingClientRect();
                  if (rect2.width > 0 && rect2.height > 0) {
                    return { found: true, x: Math.round(rect2.left + rect2.width / 2), y: Math.round(rect2.top + rect2.height / 2) };
                  }
                }
                el2 = el2.parentElement;
              }
            }

            var dbg = radios.slice(0, 6).map(function(r) {
              var l = labelOf(r);
              return (l ? (l.textContent || '').trim().slice(0, 10) : 'no-lbl') + '|checked=' + r.checked;
            }).join(' / ');
            return { found: false, debug: dbg };
          })()
        `).catch(() => ({ found: false, debug: 'js_err' }));

        if (info && info.already) {
          writeLog('INFO', 'PUBLISH', logLabel, 'ALREADY_OK:' + visTarget);
          return 'ALREADY_OK';
        }

        if (!info || !info.found) {
          writeLog('WARN', 'PUBLISH', logLabel + ' 시도' + (attempt + 1), 'NOT_FOUND:' + (info && info.debug));
          if (attempt < 2) await sleep(400);
          continue;
        }

        // 2) 실제 마우스 클릭 (리액트가 인식하는 진짜 click 이벤트)
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: info.x, y: info.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: info.x, y: info.y, button: 'left', clickCount: 1 });
        await sleep(250);

        // 3) 클릭 후 실제 반영 여부 검증
        const verified = await publishWin.webContents.executeJavaScript(`
          (function() {
            var target = ${JSON.stringify(visTarget)};
            var radios = Array.from(document.querySelectorAll('input[type="radio"]'));
            for (var i = 0; i < radios.length; i++) {
              var r = radios[i];
              var lbl = r.id ? document.querySelector('label[for="' + r.id + '"]') : null;
              var t = lbl ? (lbl.textContent||'').trim() : '';
              if (t === target) return r.checked;
            }
            return false;
          })()
        `).catch(() => false);

        writeLog('INFO', 'PUBLISH', logLabel + ' 시도' + (attempt + 1), 'CLICKED@' + info.x + ',' + info.y + ' verified=' + verified);
        if (verified) return 'VERIFIED_OK';
        if (attempt < 2) await sleep(300);
      }
      writeLog('WARN', 'PUBLISH', logLabel, 'FAILED_ALL_ATTEMPTS:' + visTarget);
      return 'FAILED';
    };

    await sleep(400);
    await applyVisibility('공개설정');

    // ── 발행 패널 태그 입력 (재시도 방식) ────────────────────────
    if (tagList.length > 0) {
      let panelTagPos = null;
      for (let tagAttempt = 0; tagAttempt < 8; tagAttempt++) {
        panelTagPos = await publishWin.webContents.executeJavaScript(`
          (function() {
            // 방법 1: input/textarea — placeholder에 '태그' 포함
            var inputs = Array.from(document.querySelectorAll('input, textarea'));
            var inp = inputs.find(function(el) {
              var r = el.getBoundingClientRect();
              var ph = (el.placeholder||'').toLowerCase();
              return r.height > 0 && (ph.includes('태그') || ph.includes('tag') || ph.includes('해시'));
            });
            if (inp) {
              inp.scrollIntoView({ block: 'center' });
              inp.focus();
              var r = inp.getBoundingClientRect();
              return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), kind: 'input', ph: inp.placeholder };
            }
            // 방법 2: contenteditable — class/placeholder에 'tag' 포함
            var ces = Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable=""]'));
            var ce = ces.find(function(el) {
              var r = el.getBoundingClientRect();
              var cls = (el.className||'').toLowerCase();
              var ph = (el.getAttribute('placeholder')||el.getAttribute('data-placeholder')||'').toLowerCase();
              return r.height > 0 && (cls.includes('tag') || ph.includes('태그') || ph.includes('tag'));
            });
            if (ce) {
              ce.scrollIntoView({ block: 'center' });
              ce.focus();
              var r = ce.getBoundingClientRect();
              return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), kind: 'contenteditable' };
            }
            // 디버그: 보이는 모든 input placeholder
            var dbg = Array.from(document.querySelectorAll('input, textarea, [contenteditable]'))
              .filter(function(e){ return e.getBoundingClientRect().height > 0; })
              .map(function(e){ return (e.placeholder||e.getAttribute('placeholder')||e.className||'').slice(0,30); })
              .filter(Boolean).join(' | ');
            return { kind: 'NOT_FOUND', debug: dbg };
          })()
        `).catch(() => null);

        if (panelTagPos && panelTagPos.kind !== 'NOT_FOUND') break;
        writeLog('WARN', 'PUBLISH', '패널 태그 재시도 ' + (tagAttempt+1), panelTagPos?.debug || '');
        await sleep(500);
      }

      writeLog('INFO', 'PUBLISH', '패널 태그 input', panelTagPos ? JSON.stringify(panelTagPos) : 'null');

      if (panelTagPos && panelTagPos.kind !== 'NOT_FOUND') {
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: panelTagPos.x, y: panelTagPos.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: panelTagPos.x, y: panelTagPos.y, button: 'left', clickCount: 1 });
        await sleep(400);
        // 태그 한 개씩 입력 + Enter (# 기호는 제거하고 입력)
        for (const tag of tagList.slice(0, 30)) {
          const cleanTag = (tag || '').replace(/^#+/, '').trim();
          if (!cleanTag) continue;
          clipboard.writeText(cleanTag);
          publishWin.webContents.paste();
          await sleep(250);
          publishWin.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
          publishWin.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'Return' });
          await sleep(250);
        }
        writeLog('INFO', 'PUBLISH', '패널 태그 입력 완료', `${tagList.length}개`);
      }
    }

    // ── 최종 발행 직전, 공개 설정 재확인 ────────────────────────
    // 태그 입력 등 후속 상호작용 중 패널이 공개설정을 기본값으로 되돌리는
    // 경우가 있어(2026-07-02 확인), 발행 버튼을 찾기 직전에 한 번 더 확정한다.
    await applyVisibility('공개설정(최종 확인)');

    // ── 네이버 자체 "예약" 발행 설정 (2026-07-03) ────────────────
    // reserveAt이 있으면, 최종 발행 버튼을 누르기 전에 네이버 에디터의
    // "발행 시간" 옵션을 "예약"으로 바꾸고 날짜/시(時)/분(分)을 맞춘다.
    // DOM 구조는 실제 사용자 확인(스크린샷+DOM 캡처)으로 확보한 셀렉터:
    //   예약 라디오: input#radio_time2[name="radio_time"][value="pre"]
    //   날짜 입력(readonly, 클릭 시 jQuery UI 달력): input[class*="input_date"]
    //   시(時) select: select[class*="hour_option"]
    //   분(分) select: select[class*="minute_option"] — 10분 단위(00/10/.../50)만 존재
    if (reserveAt) {
      // 분은 네이버가 10분 단위만 지원하므로 가장 가까운 단위로 반올림
      // (Date의 자동 롤오버를 이용해 시/일 단위 넘어가는 경우까지 안전하게 처리)
      const targetDate = new Date(reserveAt);
      targetDate.setSeconds(0, 0);
      targetDate.setMinutes(Math.round(targetDate.getMinutes() / 10) * 10);

      // 1) "예약" 라디오 클릭
      // 2026-07-13: 재시도 추가(5회, 350ms)
      const reserveRadioPos = await retryUntilFound(
        () => publishWin.webContents.executeJavaScript(`
        (function() {
          var radio = document.querySelector('input#radio_time2[name="radio_time"][value="pre"]')
            || document.querySelector('input[data-testid="preTimeRadioBtn"]');
          if (!radio) return null;
          var label = radio.id ? document.querySelector('label[for="' + radio.id + '"]') : null;
          var target = label || radio;
          target.scrollIntoView({ block: 'center' });
          var r = target.getBoundingClientRect();
          return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        })()
      `).catch(() => null),
        (v) => !!v,
        5, 350
      );
      if (reserveRadioPos) {
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: reserveRadioPos.x, y: reserveRadioPos.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: reserveRadioPos.x, y: reserveRadioPos.y, button: 'left', clickCount: 1 });
        writeLog('INFO', 'PUBLISH', '예약 라디오 클릭', JSON.stringify(reserveRadioPos));
        await sleep(600);
      } else {
        writeLog('WARN', 'PUBLISH', '예약 라디오 못 찾음 — 즉시발행으로 진행될 수 있음');
      }

      // 2) 날짜 입력 클릭 → 달력 열기
      // 2026-07-13: 재시도 추가(5회, 350ms)
      const dateInputPos = await retryUntilFound(
        () => publishWin.webContents.executeJavaScript(`
        (function() {
          var inp = document.querySelector('input[class*="input_date"]');
          if (!inp) return null;
          inp.scrollIntoView({ block: 'center' });
          var r = inp.getBoundingClientRect();
          return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        })()
      `).catch(() => null),
        (v) => !!v,
        5, 350
      );
      if (dateInputPos) {
        publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: dateInputPos.x, y: dateInputPos.y, button: 'left', clickCount: 1 });
        publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: dateInputPos.x, y: dateInputPos.y, button: 'left', clickCount: 1 });
        await sleep(500);

        // 달력 렌더링 대기 (페이드인 등으로 지연될 수 있어 짧은 간격으로 재시도) +
        // 화면 아래로 잘리면 스크롤 (사용자 확인 사항)
        for (let calTries = 0; calTries < 10; calTries++) {
          const calReady = await publishWin.webContents.executeJavaScript(`
            (function() {
              var cal = document.querySelector('.ui-datepicker');
              var title = document.querySelector('.ui-datepicker-title');
              if (cal && title) { cal.scrollIntoView({ block: 'center' }); return true; }
              return false;
            })()
          `).catch(() => false);
          if (calReady) break;
          await sleep(150);
        }
        await sleep(200);

        // 목표 월까지 이전/다음 화살표 클릭 (최대 24회 안전장치)
        const targetYM = targetDate.getFullYear() * 12 + targetDate.getMonth();
        for (let i = 0; i < 24; i++) {
          const monthInfo = await publishWin.webContents.executeJavaScript(`
            (function() {
              var titleEl = document.querySelector('.ui-datepicker-title');
              if (!titleEl) return null;
              var m = titleEl.textContent.match(/(\\d{4})\\D+(\\d{1,2})/);
              if (!m) return null;
              return { year: parseInt(m[1],10), month: parseInt(m[2],10) };
            })()
          `).catch(() => null);
          if (!monthInfo) break;
          const curYM = monthInfo.year * 12 + (monthInfo.month - 1);
          if (curYM === targetYM) break;
          const dir = curYM < targetYM ? 'next' : 'prev';
          const navBtnPos = await publishWin.webContents.executeJavaScript(`
            (function() {
              var el = document.querySelector('.ui-datepicker-${dir}');
              if (!el) return null;
              var r = el.getBoundingClientRect();
              return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
            })()
          `).catch(() => null);
          if (!navBtnPos) break;
          publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: navBtnPos.x, y: navBtnPos.y, button: 'left', clickCount: 1 });
          publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: navBtnPos.x, y: navBtnPos.y, button: 'left', clickCount: 1 });
          await sleep(250);
        }

        // 목표 날짜(일) 클릭 — 렌더링 지연 대비 짧은 간격으로 재시도
        const targetDay = targetDate.getDate();
        let dayPos = null;
        for (let dayTries = 0; dayTries < 10; dayTries++) {
          dayPos = await publishWin.webContents.executeJavaScript(`
            (function() {
              var targetDay = ${targetDay};
              // 네이버 예약 달력은 .ui-datepicker-calendar 클래스가 없고, 날짜 칸이 <table> 안의
              // <button class="ui-state-default">로 렌더됨 (2026-07-03 로그로 확인). 이전/다음달
              // 버튼(ui-datepicker-prev/next)은 ui-state-default 클래스가 없어 자동으로 제외됨.
              var links = Array.from(document.querySelectorAll('.ui-datepicker table button.ui-state-default'));
              var link = links.find(function(a) {
                var td = a.closest('td');
                if (td && td.className && td.className.indexOf('ui-state-disabled') !== -1) return false;
                return parseInt((a.textContent||'').trim(), 10) === targetDay;
              });
              if (!link) return null;
              link.scrollIntoView({ block: 'center' });
              var r = link.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return null;
              return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
            })()
          `).catch(() => null);
          if (dayPos) break;
          await sleep(200);
        }
        if (dayPos) {
          publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: dayPos.x, y: dayPos.y, button: 'left', clickCount: 1 });
          publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: dayPos.x, y: dayPos.y, button: 'left', clickCount: 1 });
          writeLog('INFO', 'PUBLISH', '예약 날짜 클릭', targetDate.toISOString().slice(0,10));
          await sleep(400);
        } else {
          writeLog('WARN', 'PUBLISH', '예약 날짜 못 찾음', String(targetDay));
          // 진단용: 실제 달력에 렌더된 날짜 링크 텍스트 목록 + 달력 HTML 일부를 남겨서
          // 텍스트 매칭 실패의 정확한 원인(요일 라벨 포함, other-month 중복, 구조 변경 등)을 확인
          const debugInfo = await publishWin.webContents.executeJavaScript(`
            (function() {
              var links = Array.from(document.querySelectorAll('.ui-datepicker table button'));
              var texts = links.map(function(a) {
                return {
                  raw: a.textContent,
                  trimmed: (a.textContent||'').trim(),
                  cls: a.className,
                  parentCls: a.parentElement ? a.parentElement.className : null
                };
              });
              var spans = Array.from(document.querySelectorAll('.ui-datepicker table span')).map(function(s) {
                return { trimmed: (s.textContent||'').trim(), cls: s.className, parentCls: s.parentElement ? s.parentElement.className : null };
              });
              var cal = document.querySelector('.ui-datepicker');
              return {
                linkCount: links.length,
                links: texts,
                disabledSpans: spans,
                calHTML: cal ? cal.outerHTML.slice(0, 2000) : null
              };
            })()
          `).catch((e) => ({ err: e.message }));
          writeLog('WARN', 'PUBLISH', '예약 날짜 디버그', JSON.stringify(debugInfo));
        }
      } else {
        writeLog('WARN', 'PUBLISH', '예약 날짜 입력 못 찾음');
      }

      // 3) 시(時)/분(分) select — 네이티브 <select>이므로 열린 팝업 좌표를 클릭하는
      //    방식은 불가능(옵션이 OS 레벨 팝업으로 렌더되어 좌표를 가질 수 없음).
      //    대신 select.value를 직접 지정하고 change 이벤트를 발생시킨다.
      const pickTimeUnit = async (classHint, targetText, logLabel) => {
        const result = await publishWin.webContents.executeJavaScript(`
          (function() {
            var sel = document.querySelector('select[class*="${classHint}"]');
            if (!sel) return { ok:false, reason:'select_not_found' };
            var target = '${targetText}';
            var stripZero = function(s) { return String(s).replace(/^0+(?=\\d)/, ''); };
            var opt = Array.from(sel.options).find(function(o) {
              return o.value === target ||
                     (o.textContent||'').trim() === target ||
                     stripZero(o.value) === stripZero(target) ||
                     stripZero((o.textContent||'').trim()) === stripZero(target);
            });
            if (!opt) return { ok:false, reason:'option_not_found' };
            sel.value = opt.value;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok:true, value: opt.value };
          })()
        `).catch((e) => ({ ok:false, reason:'js_err:' + e.message }));
        if (result && result.ok) {
          writeLog('INFO', 'PUBLISH', logLabel + ' 선택', JSON.stringify(result));
          await sleep(300);
        } else {
          writeLog('WARN', 'PUBLISH', logLabel + ' 옵션 못 찾음', JSON.stringify(result));
        }
      };

      const hourStr   = String(targetDate.getHours()).padStart(2, '0');
      const minuteStr = String(targetDate.getMinutes()).padStart(2, '0');
      await pickTimeUnit('hour_option', hourStr, '예약 시(hour)');
      await pickTimeUnit('minute_option', minuteStr, '예약 분(minute)');

      await sleep(300);
    }

    // ── 최종 발행 버튼 클릭 ──────────────────────────────────
    await sleep(700);
    // 2026-07-13: 재시도 추가(8회, 400ms) — 이 발행 흐름에서 가장 중요한
    // 지점. 실패하면 발행 자체가 조용히 누락되므로 재시도 횟수를 가장
    // 넉넉하게 준다.
    const finalPublishBtn = await retryUntilFound(
      () => publishWin.webContents.executeJavaScript(`
      (function() {
        var all = Array.from(document.querySelectorAll('button'));
        // 패널 내부 발행 버튼: 상단 툴바(y<200) 제외한 모든 발행 버튼
        var candidates = all.filter(function(b) {
          var r = b.getBoundingClientRect();
          var t = (b.textContent||'').trim();
          return r.height > 0 && r.top >= 200 && (t === '발행' || t.startsWith('발행') || t === '확인');
        });
        if (!candidates.length) {
          // 폴백: y >= 100 이상 모든 발행 버튼 중 마지막
          candidates = all.filter(function(b) {
            var r = b.getBoundingClientRect();
            var t = (b.textContent||'').trim();
            return r.height > 0 && r.top >= 100 && (t === '발행' || t.startsWith('발행'));
          });
        }
        if (!candidates.length) return null;
        // y 좌표가 가장 큰 버튼(패널 하단 발행 버튼)
        var btn = candidates.reduce(function(a, b) {
          return b.getBoundingClientRect().top > a.getBoundingClientRect().top ? b : a;
        });
        var r = btn.getBoundingClientRect();
        return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), txt: btn.textContent.trim() };
      })()
    `).catch(() => null),
      (v) => !!v,
      8, 400
    );

    if (finalPublishBtn) {
      publishWin.webContents.sendInputEvent({ type: 'mouseDown', x: finalPublishBtn.x, y: finalPublishBtn.y, button: 'left', clickCount: 1 });
      publishWin.webContents.sendInputEvent({ type: 'mouseUp',   x: finalPublishBtn.x, y: finalPublishBtn.y, button: 'left', clickCount: 1 });
      writeLog('INFO', 'PUBLISH', '최종 발행 클릭', finalPublishBtn.txt);
      await sleep(2000);
      // 2026-07-08: 아래 publishWin.once('closed', ...) 핸들러가 DB 상태를
      // publishing → published/reserved로 갱신하는데, 지금까지는 이 창을
      // 프로그램이 직접 닫는 코드가 없어서(특히 기본값인 headless=true일 때는
      // 창이 보이지도 않아 사용자가 수동으로 닫을 수도 없음) 실제로는 네이버에
      // 정상 게시되었어도 앱에는 "발행중" 상태가 영구히 남는 버그가 있었음.
      // 발행 버튼 클릭이 확인된 시점에 명시적으로 닫아 상태 갱신을 보장한다.
      publishWin.close();
    } else {
      writeLog('WARN', 'PUBLISH', '최종 발행 버튼 못 찾음');
    }
  }

  // 창이 닫히면 상태 업데이트
  publishWin.once('closed', () => {
    try {
      const { getDB: gdb } = require('./src/db');
      const row = gdb().prepare('SELECT status FROM posts WHERE id=?').get(postId);
      if (row && row.status === 'publishing') {
        if (reserveAt) {
          // 네이버 자체 예약으로 등록된 상태 — 아직 실제로 발행된 것은 아니므로
          // published_at은 건드리지 않고 'reserved' 상태로만 표시한다.
          gdb().prepare("UPDATE posts SET status='reserved' WHERE id=?").run(postId);
        } else {
          gdb().prepare("UPDATE posts SET status='published', published_at=datetime('now','localtime') WHERE id=?").run(postId);
        }
      }
    } catch { /* ignore */ }
  });

  return { success: true };
}

// ── IPC: 즉시 발행 ────────────────────────────────────────────
ipcMain.handle('publish:now', async (event, { accountId, post }) => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();

    // 2026-07-14: 등급별 제한 조회 — 하루 최대 발행(스탠다드 10회 고정/
    // 프리미엄 기본 무제한)과 썸네일 사용 가능 여부에 함께 사용.
    const tierLimits = await getTierLimits();

    // ── 일일 최대 발행 체크 (2026-07-03, 2026-07-14 등급별 상한 적용) ──
    // 기존에는 예약 발행 스케줄러(startScheduler)에만 이 체크가 있어서
    // 즉시 발행 버튼은 하루 발행 횟수 제한 없이 계속 발행되던 버그가 있었음.
    // 스케줄러와 동일하게 전체 계정 합산(글로벌) 기준으로 카운트.
    const todayStr = new Date().toISOString().slice(0, 10);
    const maxDailyPosts = tierLimits.maxDailyPosts;
    const todayCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM posts WHERE status IN ('publishing','published') AND DATE(published_at) = ?"
    ).get(todayStr)?.cnt || 0;
    if (todayCount >= maxDailyPosts) {
      writeLog('WARN', 'PUBLISH', '일일 최대 발행 초과 — 즉시 발행 차단', `${todayCount}/${maxDailyPosts}`);
      return { success: false, error: `오늘 발행 가능 횟수를 초과했습니다 (${todayCount}/${maxDailyPosts}회)` };
    }

    // 계정 naver_id 조회
    const acc = db.prepare('SELECT naver_id FROM accounts WHERE id=?').get(accountId);

    const r = db.prepare(`
      INSERT INTO posts (account_id, naver_id, title, content_json, hashtags, images_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'publishing', datetime('now','localtime'))
    `).run(
      accountId,
      acc?.naver_id || '',
      post.title,
      // 2026-07-08: thumbText(썸네일 전용 문구)도 함께 저장
      JSON.stringify({ intro: post.intro, body: post.body, conclusion: post.conclusion, links: post.links || [], thumbText: post.thumbText || '' }),
      JSON.stringify(post.hashtags || []),
      JSON.stringify(post.images || [])
    );
    const postId = r.lastInsertRowid;

    await publishToNaver({
      accountId,
      postId,
      title: post.title,
      // 2026-07-08: 썸네일 전용 문구 — 있으면 제목 대신 썸네일에 사용
      thumbText: post.thumbText || null,
      content: { intro: post.intro, body: post.body, conclusion: post.conclusion, links: post.links || [] },
      hashtags: post.hashtags || [],
      images: post.images || [],
      category: post.category || '',
      visibility: post.visibility || 'public',
      // 2026-07-14: 썸네일 자동 생성은 프리미엄 전용 — 렌더러가 무엇을
      // 보내든(post.autoThumbnail) 스탠다드면 항상 false로 강제한다.
      // UI에서 이미 토글을 비활성화해두지만, IPC를 직접 호출해 우회하는
      // 경우까지 막기 위한 최종 방어선.
      autoThumbnail: tierLimits.thumbnail && post.autoThumbnail !== false,
      headless: post.headless !== false,
      // 2026-07-07: 발행 전 미리보기에서 이미 만든 썸네일/확정 색상이 있으면
      // 그대로 재사용(중복 생성 방지 + 미리보기와 실제 결과 일치 보장)
      preGeneratedThumbPath: tierLimits.thumbnail ? (post.forcedThumbPath || null) : null,
      forcedStyleIndex: post.forcedStyleIndex != null ? post.forcedStyleIndex : null,
      // 2026-07-07: 미리보기 없이 바로 발행한 경우(previewEnabled=false)에도
      // 사용자가 이미지 카드에서 선택한 썸네일 배경이 반영되도록 전달
      thumbBgUrl: post.thumbBgUrl || null,
    });

    return { success: true, postId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 예약 가능한 가장 빠른 시각 조회 (2026-07-03) ─────────
// 예약 모달을 열 때 프론트에서 미리 호출해, 최소 간격(intervalMin) 이전
// 시각은 날짜/시간 입력 자체에서 고를 수 없도록 min 속성에 사용한다.
// publish:schedule 안의 사전 검증과 동일한 기준(계정별 마지막 발행시각
// + intervalMin)을 사용 — 등록 시점에 가서야 오류를 보여주는 대신
// 선택 단계에서부터 막기 위함.
ipcMain.handle('publish:getEarliestSlot', async (event, { accountId }) => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const intervalMin = getStore().get('settings.intervalMin', 30);
    const lastRow = db.prepare(
      "SELECT published_at FROM posts WHERE account_id=? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
    ).get(accountId);
    const now = new Date();
    let earliest = now;
    if (lastRow && lastRow.published_at) {
      const candidate = new Date(new Date(lastRow.published_at).getTime() + intervalMin * 60000);
      if (candidate > earliest) earliest = candidate;
    }
    // datetime-local input이 바로 쓸 수 있는 'YYYY-MM-DDTHH:MM' 포맷 (로컬 시간 기준)
    const pad = (n) => String(n).padStart(2, '0');
    const earliestAt = `${earliest.getFullYear()}-${pad(earliest.getMonth()+1)}-${pad(earliest.getDate())}T${pad(earliest.getHours())}:${pad(earliest.getMinutes())}`;
    return { success: true, earliestAt, intervalMin };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 예약 발행 등록 ───────────────────────────────────────
ipcMain.handle('publish:schedule', async (event, { accountId, post, scheduledAt }) => {
  try {
    // 2026-07-14: 예약 발행은 프리미엄 전용 기능 — 앱/PC가 꺼져 있어도
    // 네이버가 알아서 발행해주는 강력한 기능이라 등급 차별화 포인트로 확정.
    // UI에서 버튼을 비활성화해두지만, IPC 직접 호출 우회까지 막기 위해
    // 여기서도 최종적으로 막는다.
    const tierLimits = await getTierLimits();
    if (!tierLimits.reservation) {
      return { success: false, error: '예약 발행은 프리미엄 전용 기능입니다. 프리미엄으로 업그레이드하면 이용할 수 있습니다.' };
    }

    const { getDB } = require('./src/db');
    const db = getDB();
    const acc = db.prepare('SELECT naver_id FROM accounts WHERE id=?').get(accountId);

    // ── 예약 발행 간격 사전 검증 (Task #34) ─────────────────────
    const store = getStore();
    const intervalMin = store.get('settings.intervalMin', 30);
    const lastRow = db.prepare(
      "SELECT published_at FROM posts WHERE account_id=? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
    ).get(accountId);
    if (lastRow && lastRow.published_at) {
      const lastMs  = new Date(lastRow.published_at).getTime();
      const schedMs = new Date(scheduledAt).getTime();
      const diffMin = Math.round((schedMs - lastMs) / 60000);
      if (diffMin < intervalMin) {
        const earliest = new Date(lastMs + intervalMin * 60000);
        const hh = String(earliest.getHours()).padStart(2, '0');
        const mm = String(earliest.getMinutes()).padStart(2, '0');
        return { success: false, error: `발행 간격 미달 — 최소 ${hh}:${mm} 이후 가능 (간격 ${intervalMin}분)` };
      }
    }

    // ── (2026-07-03) 예약 등록 즉시 전체 자동화 실행 ────────────
    // 기존에는 여기서 status='scheduled'로 DB에만 저장해두고, 예약 시각에
    // 우리 앱의 스케줄러(startScheduler)가 그때 가서 에디터를 여는 방식이었음
    // — 앱/PC가 그 시각까지 켜져 있어야 하는 한계가 있었음.
    // 지금은 "예약 등록"을 누르는 즉시(=지금) 네이버 에디터를 열어 즉시발행과
    // 동일하게 전체 작업을 수행하고, 마지막 발행 단계만 네이버 자체 "예약"
    // 기능으로 등록한다(publishToNaver의 reserveAt 옵션). 이후로는 앱/PC가
    // 꺼져 있어도 네이버 서버가 예약 시각에 알아서 발행한다.
    const r = db.prepare(`
      INSERT INTO posts (account_id, naver_id, title, content_json, hashtags, images_json, status, scheduled_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'publishing', ?, datetime('now','localtime'))
    `).run(
      accountId,
      acc?.naver_id || '',
      post.title,
      // 2026-07-08: thumbText(썸네일 전용 문구)도 함께 저장
      JSON.stringify({ intro: post.intro, body: post.body, conclusion: post.conclusion, links: post.links || [], thumbText: post.thumbText || '' }),
      JSON.stringify(post.hashtags || []),
      JSON.stringify(post.images || []),
      scheduledAt
    );
    const postId = r.lastInsertRowid;

    await publishToNaver({
      accountId,
      postId,
      title: post.title,
      // 2026-07-08: 썸네일 전용 문구 — 있으면 제목 대신 썸네일에 사용
      thumbText: post.thumbText || null,
      content: { intro: post.intro, body: post.body, conclusion: post.conclusion, links: post.links || [] },
      hashtags: post.hashtags || [],
      images: post.images || [],
      category: post.category || '',
      visibility: post.visibility || 'public',
      // 2026-07-14: 즉시발행과 동일하게 등급별 썸네일 제한 최종 적용
      // (이 시점의 tierLimits는 이미 reservation:true를 통과한 프리미엄
      // 사용자 것이므로 사실상 항상 tierLimits.thumbnail===true지만,
      // 혹시 모를 상태 불일치에 대비해 그대로 조건을 걸어둔다).
      autoThumbnail: tierLimits.thumbnail && post.autoThumbnail !== false,
      headless: post.headless !== false,
      reserveAt: scheduledAt,
      // 2026-07-07: 발행 전 미리보기에서 이미 만든 썸네일/확정 색상이 있으면
      // 그대로 재사용(중복 생성 방지 + 미리보기와 실제 결과 일치 보장)
      preGeneratedThumbPath: tierLimits.thumbnail ? (post.forcedThumbPath || null) : null,
      forcedStyleIndex: post.forcedStyleIndex != null ? post.forcedStyleIndex : null,
      // 2026-07-07: 미리보기 없이 바로 발행한 경우(previewEnabled=false)에도
      // 사용자가 이미지 카드에서 선택한 썸네일 배경이 반영되도록 전달
      thumbBgUrl: post.thumbBgUrl || null,
    });

    return { success: true, postId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 발행 목록 조회 ───────────────────────────────────────
ipcMain.handle('publish:getAll', (event, filters = {}) => {
  try {
    const { getDB } = require('./src/db');
    let sql = `
      SELECT p.*, a.nickname AS account_nickname
      FROM posts p
      LEFT JOIN accounts a ON p.account_id = a.id
    `;
    const params = [];
    const conds = [];
    if (filters.status) { conds.push('p.status = ?'); params.push(filters.status); }
    if (filters.year && filters.month) {
      conds.push("strftime('%Y-%m', COALESCE(p.scheduled_at, p.created_at)) = ?");
      params.push(`${filters.year}-${String(filters.month).padStart(2, '0')}`);
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY COALESCE(p.scheduled_at, p.created_at) DESC';
    return { success: true, posts: getDB().prepare(sql).all(...params) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 대시보드 통계 ────────────────────────────────────────
ipcMain.handle('dashboard:getStats', () => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const todayPublished = db.prepare(
      "SELECT COUNT(*) as c FROM posts WHERE status='published' AND date(published_at)=date('now','localtime')"
    ).get()?.c || 0;
    // 2026-07-13 수정: 기존엔 "최근 7일" 롤링 윈도우라 월요일이 지나도
    // 지난주 화~일 발행분이 계속 섞여 보이던 문제 — 월요일 0시부터 시작하는
    // 달력주(月~日) 기준으로 변경. 'weekday 0'는 다음 일요일로 이동하고
    // (오늘이 일요일이면 그대로), '-6 days'로 그 주의 월요일로 되돌림.
    const weekPublished = db.prepare(
      "SELECT COUNT(*) as c FROM posts WHERE status='published' AND published_at >= date('now','localtime','weekday 0','-6 days')"
    ).get()?.c || 0;
    const totalPublished = db.prepare(
      "SELECT COUNT(*) as c FROM posts WHERE status='published'"
    ).get()?.c || 0;
    const totalAccounts = db.prepare(
      "SELECT COUNT(*) as c FROM accounts"
    ).get()?.c || 0;
    const recent = db.prepare(`
      SELECT p.title, p.published_at, p.post_url, a.nickname AS account_nickname
      FROM posts p LEFT JOIN accounts a ON p.account_id=a.id
      WHERE p.status='published'
      ORDER BY p.published_at DESC LIMIT 5
    `).all();
    const scheduled = db.prepare(
      "SELECT COUNT(*) as c FROM posts WHERE status='scheduled'"
    ).get()?.c || 0;

    return { success: true, stats: { todayPublished, weekPublished, totalPublished, totalAccounts, scheduled }, recent };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 7일 발행 트렌드 ─────────────────────────────────────
ipcMain.handle('dashboard:getTrend', () => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const trend = [];
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const mm = d.getMonth() + 1;
      const dd = d.getDate();
      const dayName = dayNames[d.getDay()];
      const count = db.prepare(
        "SELECT COUNT(*) as c FROM posts WHERE status='published' AND date(published_at,'localtime')=?"
      ).get(dateStr)?.c || 0;
      trend.push({ date: dateStr, label: `${mm}/${dd}`, dayName, count });
    }
    return { success: true, trend };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: 계정별 발행 통계 ─────────────────────────────────────
ipcMain.handle('dashboard:getAccountStats', () => {
  try {
    const { getDB } = require('./src/db');
    const rows = getDB().prepare(`
      SELECT a.nickname, a.naver_id,
             COUNT(p.id) as total,
             SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) as published,
             SUM(CASE WHEN p.status='scheduled' THEN 1 ELSE 0 END) as scheduled,
             SUM(CASE WHEN p.status='failed'    THEN 1 ELSE 0 END) as failed
      FROM accounts a
      LEFT JOIN posts p ON a.id = p.account_id
      GROUP BY a.id
      ORDER BY published DESC
      LIMIT 10
    `).all();
    return { success: true, accounts: rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: [개발용] 데이터 초기화 (계정 제외) ──────────────────
ipcMain.handle('dev:reset', () => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    db.prepare('DELETE FROM posts').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name='posts'").run();
    writeLog('INFO', 'DEV', '데이터 초기화 완료 (posts 테이블 삭제)');
    return { success: true };
  } catch (err) {
    writeLog('ERROR', 'DEV', '데이터 초기화 실패', err.message);
    return { success: false, error: err.message };
  }
});

// ── IPC: 예약 취소 ────────────────────────────────────────────
ipcMain.handle('publish:delete', (event, id) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('DELETE FROM posts WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('publish:cancel', (event, id) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare("UPDATE posts SET status='cancelled' WHERE id=? AND status='scheduled'").run(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── 제목 유사도 (Jaccard, 한글/영문 단어 단위) ───────────────
function calcTitleSimilarity(a, b) {
  const tokenize = s => new Set((s || '').match(/[가-힣]+|[a-zA-Z]+/g) || []);
  const setA = tokenize(a), setB = tokenize(b);
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  setA.forEach(t => { if (setB.has(t)) inter++; });
  return inter / (setA.size + setB.size - inter);
}

// ── 스케줄러 로그 스팸 방지 변수 ─────────────────────────────
let _maxReachedLogDate = '';
let _intervalLogMin   = -1;

// ── 자동 스케줄러 (30초 주기 — 안전장치 포함) ───────────────
function startScheduler() {
  setInterval(async () => {
    try {
      const { getDB } = require('./src/db');
      const db    = getDB();
      const store = getStore();
      const now   = new Date();
      const nowStr = now.toISOString().slice(0, 16);
      const todayStr = now.toISOString().slice(0, 10);
      const nowMin = Math.floor(now.getTime() / 60000);

      const maxDailyPosts       = store.get('settings.maxDailyPosts', 3);
      const intervalMin         = store.get('settings.intervalMin', 30);
      const similarityThreshold = store.get('settings.similarityThreshold', 70) / 100;

      // ── 일일 최대 발행 체크 ────────────────────────────────
      const todayCount = db.prepare(
        "SELECT COUNT(*) as cnt FROM posts WHERE status IN ('publishing','published') AND DATE(published_at) = ?"
      ).get(todayStr)?.cnt || 0;
      if (todayCount >= maxDailyPosts) {
        if (_maxReachedLogDate !== todayStr) {
          _maxReachedLogDate = todayStr;
          writeLog('INFO', 'SCHEDULER', `일일 최대 도달 (${todayCount}/${maxDailyPosts}) — 오늘 발행 중단`);
        }
        // 예약 발행은 별도 처리 (아래)
      } else {
        // ── 발행 간격 체크 ────────────────────────────────────
        const lastRow = db.prepare(
          "SELECT published_at FROM posts WHERE status IN ('publishing','published') AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1"
        ).get();
        const lastMs  = lastRow?.published_at ? new Date(lastRow.published_at).getTime() : 0;
        const diffMin = Math.floor((now.getTime() - lastMs) / 60000);
        const intervalOk = !lastMs || diffMin >= intervalMin;

        if (!intervalOk) {
          if (_intervalLogMin !== nowMin) {
            _intervalLogMin = nowMin;
            writeLog('INFO', 'SCHEDULER', `발행 간격 대기 (${diffMin}/${intervalMin}분)`);
          }
        }
      }

      // ── 예약 발행 처리 (간격 체크 무관 — 등록 시 이미 검증됨) ──
      const due = db.prepare(
        "SELECT * FROM posts WHERE status='scheduled' AND scheduled_at <= ?"
      ).all(nowStr + ':59');

      for (const post of due) {
        try {
          // 중복 제목 유사도 체크
          const recent = db.prepare(
            "SELECT title FROM posts WHERE status IN ('publishing','published') ORDER BY published_at DESC LIMIT 20"
          ).all();
          for (const r of recent) {
            const sim = calcTitleSimilarity(post.title, r.title);
            if (sim >= similarityThreshold) {
              db.prepare("UPDATE posts SET status='failed', error_msg=? WHERE id=?")
                .run(`제목 유사도 초과 (${Math.round(sim*100)}% ≥ ${Math.round(similarityThreshold*100)}%)`, post.id);
              sendNotification('⚠️ 발행 취소', `"${post.title.slice(0,20)}" — 유사 글 존재`);
              writeLog('WARN', 'SCHEDULER', '유사 제목 발행 취소', `sim=${Math.round(sim*100)}%`);
              continue;
            }
          }

          db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(post.id);
          const content  = JSON.parse(post.content_json || '{}');
          const hashtags = JSON.parse(post.hashtags || '[]');
          const images   = JSON.parse(post.images_json || '[]');

          await publishToNaver({
            accountId:     post.account_id,
            postId:        post.id,
            title:         post.title,
            content,
            hashtags,
            images,
            category:      post.category || '',
            visibility:    post.visibility || 'public',
            autoThumbnail: true,
          });

          db.prepare(
            "UPDATE posts SET status='publishing', published_at=datetime('now','localtime') WHERE id=?"
          ).run(post.id);
          sendNotification('📝 블로그 발행', `"${post.title.slice(0, 30)}" 발행 창이 열렸습니다`);
          break; // 1회에 1건씩 처리
        } catch (err) {
          db.prepare("UPDATE posts SET status='failed', error_msg=? WHERE id=?")
            .run(err.message, post.id);
          sendNotification('⚠️ 발행 실패', `"${post.title.slice(0, 20)}" 발행 중 오류 발생`);
        }
      }
    } catch { /* scheduler top-level error — ignore */ }
  }, 30000);
}

// ══════════════════════════════════════════════════════════════
// 자동화 루프 엔진 (2026-07-05 신규, 설계 협의 완료 후 구현)
// ──────────────────────────────────────────────────────────────
// - 완전자동: 글감 수집 → 글 생성 → 즉시 발행까지 전부 자동
// - 반자동  : 글감 수집 → 글 생성까지만 자동, 발행은 검수 대기 목록에서
//             사용자가 최종 확인 후 수동으로 발행 버튼을 눌러야 함
// - 시작은 항상 사용자가 대시보드에서 모드 선택 후 "시작" 버튼을 눌러야
//   하며, 앱을 재시작해도 자동으로 다시 시작되지 않는다(안전 습관 유지 —
//   2026-07-05 사용자 확정 사항, 되돌리지 말 것).
// - 다계정 순차 발행 시, 한 사이클 안에서 계정마다 서로 다른 키워드를
//   배정한다(동일 주제를 여러 블로그에 동시 배포하는 것은 저품질 위험
//   신호이기 때문 — 2026-07-05 설계 협의에서 확정).
// - 계정당 발행 사이 최소 30분 강제 딜레이(저품질 방지, 하드 플로어).
//   발행 안전 설정의 intervalMin이 30분보다 크면 그 값을 따른다.
// - 중지 후 재시작 시 "멈춘 지점부터 이어하기" (2026-07-05 사용자 확정).
// ══════════════════════════════════════════════════════════════

let loopState = {
  running: false,
  mode: null,               // 'auto' | 'semi'
  cycleIndex: 0,
  totalCycles: null,        // cycleMode='count'일 때만 값 존재
  endAt: null,              // cycleMode='duration'일 때만 값 존재
  accountQueue: [],         // 이번 실행 대상 계정 id 목록
  processedThisCycle: [],   // 이번 사이클에서 이미 처리한 계정 id
  currentAccountId: null,
  currentStep: null,        // 'collecting' | 'generating' | 'publishing' | 'waiting' | 'idle' | null
  nextRunAt: null,
  startedAt: null,
  lastResult: null,         // 최근 처리 결과 요약 (대시보드 표시용)
  shutdown: null,           // { active, secondsLeft, totalSec }
};
let loopTimer = null;
let shutdownTimer = null;

function publicLoopState() {
  const { accountQueue, processedThisCycle, ...rest } = loopState;
  return {
    ...rest,
    totalAccounts: accountQueue.length,
    processedCount: processedThisCycle.length,
  };
}

function stopAutomationLoop(reason = '사용자 요청') {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  if (loopState.running) {
    writeLog('INFO', 'LOOP', `자동화 루프 중지 (${reason})`);
  }
  loopState.running = false;
  loopState.currentStep = null;
}

function scheduleNextLoopStep(delayMs) {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = setTimeout(() => {
    processLoopStep().catch(err => {
      writeLog('ERROR', 'LOOP', '루프 처리 중 예외', err.message);
    });
  }, Math.max(0, delayMs));
}

async function startAutomationLoop(mode) {
  if (loopState.running) return { success: false, error: '이미 자동화 루프가 실행 중입니다.' };
  if (mode !== 'auto' && mode !== 'semi') return { success: false, error: '알 수 없는 모드입니다.' };

  // 2026-07-14: 자동화 루프는 프리미엄 전용 기능 — 시작 시점에 한 번만
  // 등급을 확인한다(캐시 TTL 5분 이내에는 즉시 반환). 루프가 실행되는
  // 동안에는 재확인하지 않는다 — processLoopStep은 짧은 간격으로 반복
  // 호출되는데, 매번 등급을 확인하면 온라인 시간조작 검사(최대 ~2초)가
  // 반복돼 불필요하게 무거워진다. 시작 시점 확인만으로 충분하다고 판단.
  const tierLimits = await getTierLimits();
  if (!tierLimits.automationLoop) {
    return { success: false, error: '자동화 루프는 프리미엄 전용 기능입니다. 프리미엄으로 업그레이드하면 이용할 수 있습니다.' };
  }

  const store = getStore();
  const settings = { ...DEFAULT_LOOP_SETTINGS, ...store.get('settings.automationLoop', {}) };
  const { getDB } = require('./src/db');
  const db = getDB();

  let accounts;
  if (settings.accountMode === 'single') {
    if (!settings.singleAccountId) return { success: false, error: '자동화 루프에 사용할 계정을 환경설정에서 먼저 선택하세요.' };
    accounts = db.prepare('SELECT id FROM accounts WHERE id = ? AND loop_enabled = 1').all(settings.singleAccountId);
  } else {
    accounts = db.prepare('SELECT id FROM accounts WHERE loop_enabled = 1 ORDER BY id').all();
  }
  if (!accounts.length) {
    return { success: false, error: '자동화 루프 대상 계정이 없습니다. 환경설정 > 자동화 루프에서 계정 구성을 확인하세요.' };
  }

  // 이전에 "중지"로 멈춘 지점이 있고, 대상 계정 구성이 동일하면 이어서 진행
  const sameQueue = loopState.accountQueue.length === accounts.length &&
    loopState.accountQueue.every((id, i) => id === accounts[i].id);
  const resume = sameQueue && loopState.processedThisCycle.length > 0 && loopState.processedThisCycle.length < accounts.length;

  loopState.running = true;
  loopState.mode = mode;
  loopState.accountQueue = accounts.map(a => a.id);
  if (!resume) {
    loopState.cycleIndex = 0;
    loopState.processedThisCycle = [];
  }
  loopState.totalCycles = settings.cycleMode === 'count' ? settings.cycleCount : null;
  loopState.endAt = settings.cycleMode === 'duration' ? Date.now() + settings.cycleDurationHours * 3600000 : null;
  loopState.startedAt = loopState.startedAt || Date.now();
  loopState.currentStep = 'idle';
  loopState.shutdown = null;

  writeLog('INFO', 'LOOP', `자동화 루프 시작 (${mode === 'auto' ? '완전자동' : '반자동'})`,
    `대상 계정 ${accounts.length}개${resume ? ' — 이전 중지 지점부터 이어감' : ''}`);
  scheduleNextLoopStep(0);
  return { success: true, state: publicLoopState() };
}

// ── 키워드 소진 처리 ──────────────────────────────────────────
async function handleKeywordExhaustion(settings) {
  if (settings.keywordExhaustion === 'refill') {
    writeLog('INFO', 'LOOP', '키워드 소진 — 등록된 활성 키워드로 트렌드 자동 보충 시도');
    try {
      const { getDB } = require('./src/db');
      const db = getDB();
      const activeKeywords = db.prepare('SELECT id FROM research_keywords WHERE active = 1').all();
      let totalAdded = 0;
      for (const kw of activeKeywords) {
        const res = await collectKeywordItems(kw.id);
        if (res.success) totalAdded += (res.count || 0);
      }
      if (totalAdded > 0) {
        writeLog('INFO', 'LOOP', `트렌드 자동 보충 완료 — ${totalAdded}건 추가`);
        scheduleNextLoopStep(1000);
        return;
      }
      writeLog('WARN', 'LOOP', '트렌드 자동 보충 결과 0건 — 루프 중단');
    } catch (err) {
      writeLog('ERROR', 'LOOP', '트렌드 자동 보충 실패', err.message);
    }
  }

  // notify + stop
  sendNotification('⚠️ 자동화 루프 중단', '등록된 글감(키워드)을 모두 사용했습니다.');
  writeLog('WARN', 'LOOP', '키워드 소진으로 자동화 루프 중단');
  const mode = loopState.mode;
  stopAutomationLoop('키워드 소진');

  if (mode === 'auto' && settings.pcShutdownOnExhaustion) {
    startShutdownCountdown();
  }
}

// ── PC 종료 카운트다운 (완전자동 + 키워드 소진 시, 사용자 확정: 60초) ──
function startShutdownCountdown() {
  loopState.shutdown = { active: true, secondsLeft: LOOP_SHUTDOWN_COUNTDOWN_SEC, totalSec: LOOP_SHUTDOWN_COUNTDOWN_SEC };
  writeLog('WARN', 'LOOP', `키워드 소진 — PC 종료 카운트다운 시작 (${LOOP_SHUTDOWN_COUNTDOWN_SEC}초)`);
  if (shutdownTimer) clearInterval(shutdownTimer);
  shutdownTimer = setInterval(() => {
    if (!loopState.shutdown || !loopState.shutdown.active) { clearInterval(shutdownTimer); shutdownTimer = null; return; }
    loopState.shutdown.secondsLeft -= 1;
    if (loopState.shutdown.secondsLeft <= 0) {
      clearInterval(shutdownTimer); shutdownTimer = null;
      writeLog('WARN', 'LOOP', 'PC 종료 실행');
      try {
        const { exec } = require('child_process');
        if (process.platform === 'win32') exec('shutdown /s /t 0');
        else if (process.platform === 'darwin') exec("osascript -e 'tell application \"System Events\" to shut down'");
        else exec('shutdown -h now');
      } catch (err) {
        writeLog('ERROR', 'LOOP', 'PC 종료 명령 실패', err.message);
      }
    }
  }, 1000);
}

function cancelShutdownCountdown() {
  if (shutdownTimer) { clearInterval(shutdownTimer); shutdownTimer = null; }
  if (loopState.shutdown) {
    loopState.shutdown.active = false;
    writeLog('INFO', 'LOOP', 'PC 종료 취소됨 (사용자)');
  }
}

// ── 계정별 카테고리 기반 글감 선택 (Method 2, 2026-07-05 신규) ──
// account.loop_category가 비어있으면(기본값) 기존과 동일하게 전체 글감 풀에서
// 선입선출로 선택. 값이 지정돼 있으면 그 카테고리에 속한 키워드의 글감만
// 선택 대상으로 좁힌다 — 계정 간 콘텐츠 중복/유사 위험을 낮추는 2번째 안전장치.
// (1번째 안전장치: 선택 즉시 used=1 처리하는 기존 잠금 로직, 그대로 유지)
function pickItemForAccount(db, account) {
  const category = (account.loop_category || '').trim();
  if (!category) {
    return db.prepare("SELECT * FROM research_items WHERE used = 0 ORDER BY collected_at ASC LIMIT 1").get();
  }
  return db.prepare(`
    SELECT ri.* FROM research_items ri
    JOIN research_keywords rk ON rk.id = ri.keyword_id
    WHERE ri.used = 0 AND TRIM(rk.category) = ?
    ORDER BY ri.collected_at ASC LIMIT 1
  `).get(category);
}

// 2026-07-06 신규: 계정의 배정/네이버 카테고리 "쌍" 목록을 반환한다.
// 1번째 쌍은 항상 accounts.loop_category/naver_category(기존 컬럼, 하위
// 호환), 2번째부터는 account_category_pairs 테이블의 추가 쌍(sort_order
// 순서). 파일럿(skysmoga 계정)만 실제로 추가 쌍을 가지므로, 다른 계정은
// 항상 길이 1인 배열(기존 동작과 완전히 동일)을 반환한다.
function getAccountCategoryPairs(db, account) {
  const base = { isBase: true, loop_category: account.loop_category || '', naver_category: account.naver_category || '' };
  let extra = [];
  try {
    extra = db.prepare(
      'SELECT id, loop_category, naver_category FROM account_category_pairs WHERE account_id = ? ORDER BY sort_order ASC, id ASC'
    ).all(account.id);
  } catch (_) { extra = []; }
  return [base, ...extra.map(p => ({ isBase: false, id: p.id, loop_category: p.loop_category || '', naver_category: p.naver_category || '' }))];
}

// 계정에 배정된 카테고리 안의 글감이 소진됐을 때, 그 카테고리에 속한 활성
// 키워드만 대상으로 트렌드 자동 보충 시도 (전역 handleKeywordExhaustion과 별개,
// 더 좁은 범위 — "더 큰 범위인 카테고리에서 키워드를 찾아" 요청사항의 핵심 로직)
async function refillCategoryKeywords(category) {
  const { getDB } = require('./src/db');
  const db = getDB();
  const kws = db.prepare("SELECT id FROM research_keywords WHERE active = 1 AND TRIM(category) = ?").all(category);
  let totalAdded = 0;
  for (const kw of kws) {
    const res = await collectKeywordItems(kw.id);
    if (res.success) totalAdded += (res.count || 0);
  }
  return totalAdded;
}

// ── 루프 한 스텝 처리 (계정 1개 분량) ─────────────────────────
async function processLoopStep() {
  if (!loopState.running) return;
  const store = getStore();
  const settings = { ...DEFAULT_LOOP_SETTINGS, ...store.get('settings.automationLoop', {}) };

  // 사이클/시간 제한 체크
  if (loopState.totalCycles != null && loopState.cycleIndex >= loopState.totalCycles) {
    writeLog('INFO', 'LOOP', `설정된 실행 횟수(${loopState.totalCycles}회) 도달 — 루프 종료`);
    stopAutomationLoop('실행 횟수 도달');
    return;
  }
  if (loopState.endAt != null && Date.now() >= loopState.endAt) {
    writeLog('INFO', 'LOOP', '설정된 실행 시간 도달 — 루프 종료');
    stopAutomationLoop('실행 시간 도달');
    return;
  }

  // 이번 사이클에서 아직 처리하지 않은 계정 찾기
  const remaining = loopState.accountQueue.filter(id => !loopState.processedThisCycle.includes(id));
  if (remaining.length === 0) {
    // 사이클 완료 → 다음 사이클로
    loopState.cycleIndex += 1;
    loopState.processedThisCycle = [];
    writeLog('INFO', 'LOOP', `사이클 ${loopState.cycleIndex} 완료 — 다음 사이클 준비`);
    scheduleNextLoopStep(3000);
    return;
  }

  const accountId = remaining[0];
  const { getDB } = require('./src/db');
  const db = getDB();
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);

  if (!account || account.status === 'expired' || !account.loop_enabled) {
    writeLog('WARN', 'LOOP', '만료/제외된 계정 건너뜀', account?.naver_id || String(accountId));
    if (!account || account.status === 'expired') {
      sendNotification('⚠️ 자동화 루프', `계정 로그인이 만료되어 건너뛰었습니다: ${account?.nickname || account?.naver_id || accountId}`);
    }
    loopState.processedThisCycle.push(accountId);
    // 만료 계정이 바로 다시 걸리는 것을 막기 위해 짧게라도 딜레이(0초 폭주 방지)
    scheduleNextLoopStep(5 * 60000);
    return;
  }

  // 일일 최대 발행 체크 (기존 예약 스케줄러와 동일한 전역 카운트를 공유)
  // 2026-07-14: 자동화 루프는 시작 시점에 이미 프리미엄 확인을 마쳤으므로
  // (startAutomationLoop 참고) 여기서는 온라인 시간조작 검사가 포함된
  // getTierLimits()를 매 스텝 다시 호출하지 않고, computeMaxDailyPosts만
  // 재사용해 매번 최신 설정값(사용자가 방금 저장한 무제한/숫자 설정)을
  // 반영하면서도 비용은 store 읽기 수준으로 가볍게 유지한다.
  const maxDailyPosts = computeMaxDailyPosts(true, store);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM posts WHERE status IN ('publishing','published') AND DATE(published_at) = ?"
  ).get(todayStr)?.cnt || 0;
  if (loopState.mode === 'auto' && todayCount >= maxDailyPosts) {
    writeLog('INFO', 'LOOP', `일일 최대 발행 도달(${todayCount}/${maxDailyPosts}) — 30분 후 재확인`);
    loopState.currentStep = 'waiting';
    scheduleNextLoopStep(30 * 60000);
    return;
  }

  loopState.currentAccountId = accountId;
  loopState.currentStep = 'collecting';

  // 2026-07-06: 계정에 등록된 배정/네이버 카테고리 "쌍" 목록(기본 1개 +
  // 파일럿 계정의 추가 쌍, 최대 5개)을 라운드로빈으로 순회하며 글감을
  // 찾는다. 쌍이 1개뿐인 계정(대부분)은 기존과 완전히 동일하게 동작.
  const categoryPairs = getAccountCategoryPairs(db, account);
  if (!loopState.pairCursor) loopState.pairCursor = {};
  let pairStartIdx = loopState.pairCursor[accountId] || 0;
  if (pairStartIdx >= categoryPairs.length) pairStartIdx = 0;

  let item = null;
  let usedPair = categoryPairs[pairStartIdx] || categoryPairs[0];
  for (let i = 0; i < categoryPairs.length; i++) {
    const pairIdx = (pairStartIdx + i) % categoryPairs.length;
    const pair = categoryPairs[pairIdx];
    let found = pickItemForAccount(db, pair);
    if (!found && pair.loop_category) {
      // 배정된 카테고리 안에서만 소진된 경우 — 전역 소진과 구분해서 처리
      writeLog('WARN', 'LOOP', `배정 카테고리("${pair.loop_category}") 글감 소진 — 카테고리 범위 보충 시도`, account.nickname || account.naver_id);
      if (settings.keywordExhaustion === 'refill') {
        const added = await refillCategoryKeywords(pair.loop_category);
        if (added > 0) {
          writeLog('INFO', 'LOOP', `카테고리("${pair.loop_category}") 트렌드 자동 보충 완료 — ${added}건 추가`);
          found = pickItemForAccount(db, pair);
        }
      }
    }
    if (found) {
      item = found;
      usedPair = pair;
      loopState.pairCursor[accountId] = (pairIdx + 1) % categoryPairs.length;
      break;
    }
  }
  if (!item) {
    // 등록된 쌍 전부를 순회해도 못 찾은 경우: 다른 카테고리/미지정 계정이 쓸
    // 글감이 전역적으로 남아있다면 이 계정만 이번 사이클 건너뛰고 루프 전체는
    // 계속 진행. 전역적으로도 완전히 없을 때만 기존 handleKeywordExhaustion
    // (중단/전역보충/PC종료)으로 처리 — 검증된 전역 소진 동작은 그대로 유지.
    const globalRemaining = db.prepare("SELECT COUNT(*) as cnt FROM research_items WHERE used = 0").get()?.cnt || 0;
    const anyCategoryAssigned = categoryPairs.some(p => p.loop_category);
    if (anyCategoryAssigned && globalRemaining > 0) {
      writeLog('WARN', 'LOOP', `계정 "${account.nickname || account.naver_id}" 배정 카테고리(들) 모두 글감 없음 — 이번 사이클 건너뜀`);
      sendNotification('⚠️ 자동화 루프', `배정된 카테고리에 글감이 없어 이번 회차는 건너뛰었습니다: ${account.nickname || account.naver_id}`);
      loopState.lastResult = { ok: false, accountId, error: '배정 카테고리 글감 소진', mode: loopState.mode };
      loopState.processedThisCycle.push(accountId);
      loopState.currentStep = 'idle';
      scheduleNextLoopStep(5 * 60000);
      return;
    }
    await handleKeywordExhaustion(settings);
    return;
  }
  // 같은 사이클 내 다른 계정에 동일 키워드가 배정되지 않도록 즉시 사용 처리
  // (여러 블로그에 같은 주제를 동시에 올리는 것은 저품질 위험 신호이므로 금지 —
  //  2026-07-05 설계 협의에서 확정된 규칙, 임의로 되돌리지 말 것)
  db.prepare('UPDATE research_items SET used = 1 WHERE id = ?').run(item.id);

  loopState.currentStep = 'generating';
  writeLog('INFO', 'LOOP', `글 생성 시작 — 계정:${account.nickname || account.naver_id}, 키워드:${item.keyword_text}`);

  const genParams = {
    topic: item.keyword_text,
    keywords: [item.keyword_text],
    tone: store.get('settings.tone', 'info'),
    writingStyle: store.get('settings.writingStyle', 'auto'),
    personalExp: store.get('settings.personalExp', 'auto'),
    sentenceStyle: store.get('settings.sentenceStyle', 'auto'),
    targetMin: 2000,
  };
  const genRes = await generatePostContent(genParams);

  if (!genRes.success) {
    writeLog('ERROR', 'LOOP', '글 생성 실패 — 이 계정은 이번 사이클에서 건너뜀', genRes.error);
    loopState.lastResult = { ok: false, accountId, error: genRes.error };
    loopState.processedThisCycle.push(accountId);
    loopState.currentStep = 'idle';
    scheduleNextLoopStep(5000);
    return;
  }

  const result = genRes.result;

  // 완전자동 발행 직전 제목 유사도 검증 (Method 3, 2026-07-05 신규)
  // 카테고리 분리(Method 2)로도 못 거른, 계정 간 콘텐츠 중복/유사 위험에 대한
  // 마지막 안전망 — 기존 30초 스케줄러 포커가 쓰는 calcTitleSimilarity 재사용.
  // 반자동은 사람이 발행 전 직접 검수하므로 이 자동 차단은 완전자동에만 적용.
  if (loopState.mode === 'auto') {
    const similarityThreshold = store.get('settings.similarityThreshold', 70) / 100;
    const recentTitles = db.prepare(
      "SELECT title FROM posts WHERE status IN ('publishing','published') ORDER BY published_at DESC LIMIT 20"
    ).all();
    const tooSimilar = recentTitles.some(r => calcTitleSimilarity(result.title, r.title) >= similarityThreshold);
    if (tooSimilar) {
      writeLog('WARN', 'LOOP', `완전자동 발행 취소 — 최근 발행 글과 제목 유사도 임계치 초과`, `"${(result.title || '').slice(0, 30)}"`);
      sendNotification('⚠️ 자동화 루프', `유사한 제목이 있어 이번 회차는 발행을 건너뛰었습니다: "${(result.title || '').slice(0, 20)}"`);
      loopState.lastResult = { ok: false, accountId, error: '유사 제목으로 발행 취소', mode: 'auto' };
      loopState.processedThisCycle.push(accountId);
      loopState.currentStep = 'idle';
      scheduleNextLoopStep(5000);
      return;
    }
  }

  // 2026-07-08: thumbText(썸네일 전용 문구)도 함께 저장해 반자동 검수
  // 대기 → "글 생성으로 이동" 왕복 시 유실되지 않도록 함.
  const contentObj = { intro: result.intro, body: result.body, conclusion: result.conclusion, links: result.links || [], thumbText: result.thumbText || '' };
  const autoThumbnail = store.get('settings.customThumbnail', true) !== false;
  // 2026-07-06: 네이버 블로그 발행 카테고리 — 이번 사이클에 실제로 사용된
  // 쌍(usedPair)의 naver_category를 사용(다중 쌍 파일럿). 쌍이 1개뿐인
  // 계정은 usedPair가 곧 accounts.naver_category와 동일해 기존과 동일하게
  // 동작한다. 비어있으면 기존과 동일하게 카테고리 미지정(그 블로그의 마지막
  // 선택값 유지).
  const naverCategory = (usedPair.naver_category || '').trim();

  // 2026-07-06: 자동화 루프에도 수동 "글 생성" 화면과 동일하게 언스플래시
  // 이미지를 자동으로 골라 넣는다 — 기존에는 images:[]로 하드코딩되어 있어
  // 완전자동/반자동 모두 본문에 사진이 전혀 삽입되지 않던 문제 수정.
  // 키 미설정/검색 실패 시에는 경고만 남기고 이미지 없이 발행 진행(발행
  // 자체는 막지 않음 — 수동 흐름과 동일한 완화 처리).
  const imgRes = await autoPickUnsplashImages([item.keyword_text]);
  const loopImages = imgRes.images;
  if (imgRes.error) {
    writeLog('WARN', 'LOOP', '언스플래시 이미지 자동 삽입 건너뜀', imgRes.error);
  }

  // 2026-07-07 신규: 완전자동 발행 직전 "누락 항목" 점검 — 썸네일/이미지/
  // 본문/관련 사이트 중 하나라도 빠져 있으면 그대로 자동 발행하지 않고
  // 검수 대기로 돌린다(사용자 확정 설계). 반자동은 원래도 항상 검수 대기로
  // 가므로 이 점검은 완전자동에만 적용.
  // - 썸네일 누락 판정: 그라데이션 폴백은 "정상"으로 취급하고, 생성 자체가
  //   완전히 실패(타임아웃/캡처 실패 등으로 null 반환)했을 때만 누락으로 봄.
  // - 이미지 누락: 언스플래시 사진을 한 장도 확보하지 못한 경우.
  // - 본문 누락: result.body가 비어있는 경우.
  // - 관련 사이트 누락: result.links가 비어있는 경우.
  let preGenThumbPath = null;
  const missingParts = [];
  if (loopState.mode === 'auto') {
    if (autoThumbnail && (result.title || item.keyword_text)) {
      // 2026-07-07: 완전자동도 반자동과 동일하게, 이미 확보된 본문 이미지 중
      // 하나를 무작위로 썸네일 배경으로 사용(글과 무관한 사진 삽입 완화).
      const randomBgUrl = loopImages.length
        ? loopImages[Math.floor(Math.random() * loopImages.length)].url
        : null;
      // 2026-07-08: thumbText가 있으면 제목/키워드 대신 우선 사용.
      preGenThumbPath = await generateThumbnail((result.thumbText || '').trim() || result.title || item.keyword_text, result.hashtags || [], randomBgUrl);
    }
    if (autoThumbnail && !preGenThumbPath) missingParts.push('썸네일');
    if (!loopImages.length) missingParts.push('이미지');
    if (!result.body || !result.body.trim()) missingParts.push('본문');
    if (!result.links || !result.links.length) missingParts.push('관련 사이트');
  }
  const needsReview = loopState.mode === 'auto' && missingParts.length > 0;
  const finalStatus = (loopState.mode === 'semi' || needsReview) ? 'review' : 'publishing';
  const finalSource = loopState.mode === 'semi' ? 'loop_semi' : (needsReview ? 'loop_auto_review' : 'loop_auto');
  const memo = needsReview
    ? `완전자동에서 발행되었으나 ${missingParts.join(', ')}가 누락되어 검수 대기로 이동되었습니다.`
    : '';

  const insertInfo = db.prepare(
    `INSERT INTO posts (account_id, naver_id, title, content_json, hashtags, images_json, status, category, visibility, auto_thumbnail, source, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
  ).run(
    accountId, account.naver_id || '', result.title || item.keyword_text,
    JSON.stringify(contentObj), JSON.stringify(result.hashtags || []), JSON.stringify(loopImages),
    finalStatus,
    naverCategory, 'public', autoThumbnail ? 1 : 0,
    finalSource, memo
  );
  const postId = insertInfo.lastInsertRowid;

  if (loopState.mode === 'semi') {
    writeLog('INFO', 'LOOP', `반자동 — 검수 대기 등록 완료: "${(result.title || '').slice(0, 30)}"`);
    sendNotification('📝 검수 대기 추가', `"${(result.title || '').slice(0, 24)}" — 검수 후 발행하세요`);
    loopState.lastResult = { ok: true, accountId, title: result.title, mode: 'semi' };
    loopState.processedThisCycle.push(accountId);
    loopState.currentStep = 'idle';
    // 반자동은 실제 발행이 일어나지 않으므로 30분 강제 딜레이 없이 바로 다음 계정 진행
    scheduleNextLoopStep(2000);
    return;
  }

  if (needsReview) {
    writeLog('WARN', 'LOOP', `완전자동 — ${missingParts.join(', ')} 누락으로 검수 대기로 이동`, `"${(result.title || '').slice(0, 30)}"`);
    sendNotification('📝 검수 대기로 이동', `${missingParts.join(', ')} 누락 — "${(result.title || '').slice(0, 24)}"`);
    loopState.lastResult = { ok: false, accountId, error: `${missingParts.join(', ')} 누락으로 검수 대기 이동`, mode: 'auto' };
    loopState.processedThisCycle.push(accountId);
    loopState.currentStep = 'idle';
    // 실제 발행이 일어나지 않았으므로(도배 위험 없음) 반자동과 동일하게 바로 다음 계정 진행
    scheduleNextLoopStep(2000);
    return;
  }

  // 완전자동: 즉시 발행
  loopState.currentStep = 'publishing';
  try {
    await publishToNaver({
      accountId, postId, title: result.title || item.keyword_text,
      content: contentObj, hashtags: result.hashtags || [], images: loopImages,
      category: naverCategory, visibility: 'public', autoThumbnail,
      preGeneratedThumbPath: preGenThumbPath,
    });
    db.prepare("UPDATE posts SET status='publishing', published_at=datetime('now','localtime') WHERE id=?").run(postId);
    writeLog('INFO', 'LOOP', `완전자동 발행 완료: "${(result.title || '').slice(0, 30)}"`);
    sendNotification('📝 자동 발행 완료', `"${(result.title || '').slice(0, 24)}"`);
    loopState.lastResult = { ok: true, accountId, title: result.title, mode: 'auto' };
  } catch (err) {
    db.prepare("UPDATE posts SET status='failed', error_msg=? WHERE id=?").run(err.message, postId);
    writeLog('ERROR', 'LOOP', '완전자동 발행 실패', err.message);
    sendNotification('⚠️ 자동 발행 실패', `"${(result.title || '').slice(0, 24)}"`);
    loopState.lastResult = { ok: false, accountId, error: err.message, mode: 'auto' };
  }

  loopState.processedThisCycle.push(accountId);

  // 2026-07-06 수정: 기존에는 계정을 1개 처리할 때마다 무조건 최소 30분을
  // 대기해서, 계정이 여러 개면 계정 간에도 30분씩 밀려 각 계정이 한 바퀴
  // 도는 데 (계정 수 × 30분)이 걸리고 있었음. 사용자 확정 의도: "등록된
  // 계정이 모두 한 번씩 발행(=한 사이클)을 마친 뒤에만 최소 30분을 대기하고,
  // 그 다음에 다음 사이클(각 계정의 2번째 발행)을 시작한다" — 즉 30분
  // 하한선은 사이클과 사이클 사이에만 적용되고, 같은 사이클 내 계정 간에는
  // (서로 다른 블로그라 저품질/도배 위험이 없으므로) 바로 다음 계정으로 진행.
  const cycleComplete = loopState.processedThisCycle.length >= loopState.accountQueue.length;
  if (cycleComplete) {
    loopState.currentStep = 'waiting';
    const intervalMin = store.get('settings.intervalMin', 30);
    const delayMin = Math.max(30, intervalMin); // 사이클 완료 후 다음 사이클 시작 전 최소 대기 — 저품질 방지 하드 플로어
    loopState.nextRunAt = Date.now() + delayMin * 60000;
    scheduleNextLoopStep(delayMin * 60000);
  } else {
    loopState.currentStep = 'idle';
    loopState.nextRunAt = Date.now() + 5000;
    scheduleNextLoopStep(5000);
  }
}

// ── IPC: 자동화 루프 제어 ──────────────────────────────────────
ipcMain.handle('automationLoop:start', async (event, { mode }) => startAutomationLoop(mode));

ipcMain.handle('automationLoop:stop', () => {
  stopAutomationLoop('사용자 요청');
  return { success: true, state: publicLoopState() };
});

ipcMain.handle('automationLoop:getStatus', () => {
  const state = publicLoopState();
  try {
    if (state.currentAccountId) {
      const { getDB } = require('./src/db');
      const acc = getDB().prepare('SELECT nickname, naver_id FROM accounts WHERE id = ?').get(state.currentAccountId);
      state.currentAccountName = acc ? (acc.nickname || acc.naver_id) : null;
    }
  } catch { /* 표시용 부가 정보이므로 실패해도 무시 */ }
  return { success: true, state };
});

ipcMain.handle('automationLoop:cancelShutdown', () => {
  cancelShutdownCountdown();
  return { success: true, state: publicLoopState() };
});

// ── IPC: 반자동 검수 대기 목록 ─────────────────────────────────
ipcMain.handle('post:getReviewQueue', () => {
  try {
    const { getDB } = require('./src/db');
    const rows = getDB().prepare(`
      SELECT p.*, a.naver_id as account_naver_id, a.nickname as account_nickname
      FROM posts p LEFT JOIN accounts a ON a.id = p.account_id
      WHERE p.status = 'review'
      ORDER BY p.created_at DESC
    `).all();
    return { success: true, posts: rows };
  } catch (err) {
    return { success: false, error: err.message, posts: [] };
  }
});

ipcMain.handle('post:publishReview', async (event, { id }) => {
  const { getDB } = require('./src/db');
  const db = getDB();
  try {
    const post = db.prepare("SELECT * FROM posts WHERE id = ? AND status = 'review'").get(id);
    if (!post) return { success: false, error: '대상 글을 찾을 수 없습니다.' };

    db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(id);

    // 2026-07-07: 반자동은 수동 발행처럼 이미지 카드를 클릭해 썸네일 배경을
    // 고를 UI가 없으므로, 이미 확보된 본문 이미지 중 하나를 무작위로 골라
    // 썸네일 배경으로 사용한다(글과 무관한 사진이 배경에 들어가는 문제 완화).
    const reviewImages = JSON.parse(post.images_json || '[]');
    const randomBgUrl = reviewImages.length
      ? reviewImages[Math.floor(Math.random() * reviewImages.length)].url
      : null;
    // 2026-07-08: content_json에 함께 저장된 썸네일 전용 문구가 있으면
    // 제목 대신 썸네일에 사용
    const reviewContent = JSON.parse(post.content_json || '{}');

    await publishToNaver({
      accountId: post.account_id, postId: post.id, title: post.title,
      thumbText: reviewContent.thumbText || null,
      content: reviewContent,
      hashtags: JSON.parse(post.hashtags || '[]'),
      images: reviewImages,
      category: post.category || '', visibility: post.visibility || 'public',
      autoThumbnail: !!post.auto_thumbnail,
      thumbBgUrl: randomBgUrl,
    });
    db.prepare("UPDATE posts SET status='publishing', published_at=datetime('now','localtime') WHERE id=?").run(id);
    writeLog('INFO', 'LOOP', `반자동 검수 승인 발행 완료: "${(post.title || '').slice(0, 30)}"`);
    return { success: true };
  } catch (err) {
    db.prepare("UPDATE posts SET status='failed', error_msg=? WHERE id=?").run(err.message, id);
    writeLog('ERROR', 'LOOP', '반자동 검수 발행 실패', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:deleteReview', (event, { id }) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare("DELETE FROM posts WHERE id = ? AND status = 'review'").run(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: blog:getCategories ───────────────────────────────────
// 방식: BrowserWindow로 SE2 에디터 → 발행 버튼 클릭 → 카테고리 드롭다운 container-li 추출
ipcMain.handle('blog:getCategories', async (_, accountId) => {
  try {
    // ── 캐시 히트 → 즉시 반환 ──────────────────────────────
    if (categoryCache.has(accountId)) {
      return { success: true, categories: categoryCache.get(accountId) };
    }

    const { getDB } = require('./src/db');
    const account = getDB().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account?.cookies_encrypted) return { success: false, error: '계정 정보 없음' };

    const cookies = JSON.parse(decrypt(account.cookies_encrypted) || '[]');
    const naverId = account.naver_id;
    if (!naverId) return { success: false, error: 'naver_id 없음' };

    writeLog('INFO', 'CATEGORY', '카테고리 로드 시작', `accountId=${accountId}`);
    writeLog('INFO', 'CATEGORY', `naverId=${naverId}, 쿠키수=${cookies.length}`);

    // ── 격리 세션 + 쿠키 주입 ──────────────────────────────
    const partition = `persist:cat-${accountId}`;
    const ses = electronSession.fromPartition(partition);
    for (const cookie of cookies) {
      try {
        const urlBase = cookie.domain?.startsWith('.')
          ? `https://www${cookie.domain}`
          : `https://${cookie.domain || 'naver.com'}`;
        await ses.cookies.set({
          url: urlBase, name: cookie.name, value: cookie.value,
          domain: cookie.domain, path: cookie.path || '/',
          secure: !!cookie.secure, httpOnly: !!cookie.httpOnly,
          expirationDate: cookie.expirationDate,
        });
      } catch {}
    }

    // ── BrowserWindow 생성 (백그라운드) ────────────────────
    const catWin = new BrowserWindow({
      width: 1300, height: 860, show: false,
      webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
    });
    catWin.setMenuBarVisibility(false);
    catWin.webContents.on('will-prevent-unload', (e) => e.preventDefault());

    const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverId}`;

    return new Promise((resolve) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        if (!catWin.isDestroyed()) catWin.destroy();
        resolve(result);
      };

      // 전체 타임아웃 (2026-07-06: 30초 → 45초로 상향.
      // 안쪽 에디터 대기 루프(waitForEditor)가 자체적으로 최대 60회 × 600ms
      // = 36초까지 기다린 뒤에야 "에디터 대기 타임아웃 — 그래도 진행"으로
      // 스스로 복구를 시도하는데, 바깥쪽 전체 타임아웃이 30초로 그보다
      // 짧게 설정돼 있어 안쪽 루프가 복구를 시도해보기도 전에 항상 먼저
      // 실패 처리되는 경합(race) 버그가 있었음. 새로 추가한 계정처럼
      // 세션 파티션이 처음 쓰이거나 에디터 로딩이 27~30초를 넘기는
      // 경우 이 버그에 걸려 실제로는 조금만 더 기다리면 성공할 수 있는
      // 상황도 무조건 타임아웃 처리됐음. 안쪽 루프 최대 소요시간(36초)
      // + 이후 단계(발행 버튼 클릭 최대 3초, 카테고리 추출 약 1~4초)를
      // 감안해 여유 있게 45초로 상향.
      const globalTimeout = setTimeout(() => {
        writeLog('WARN', 'CATEGORY', '카테고리 로드 타임아웃');
        done({ success: false, error: '타임아웃' });
      }, 45000);

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // SE2 에디터 준비 대기 — se-wrap 감지 + input_buffer iframe 추가 확인
      const waitForEditor = async () => {
        writeLog('INFO', 'CATEGORY', 'SE2 에디터 초기화 대기');
        let seWrapFound = false;
        for (let i = 0; i < 60; i++) {
          await sleep(600);
          if (settled) return;
          try {
            const state = await catWin.webContents.executeJavaScript(`
              (function() {
                var wrap = !!(document.querySelector('.se-wrap') || document.querySelector('[class*="se-wrap"]'));
                var iframe = !!(document.querySelector('iframe[id^="input_buffer"]'));
                return wrap + '|' + iframe;
              })()
            `);
            const [wrap, iframe] = state.split('|');
            if (wrap === 'true' && iframe === 'true') { seWrapFound = true; break; }
            if (wrap === 'true') seWrapFound = true; // wrap만 있어도 일단 기록
          } catch {}
        }
        if (!seWrapFound) {
          writeLog('WARN', 'CATEGORY', '에디터 대기 타임아웃 — 그래도 진행');
        }
        writeLog('INFO', 'CATEGORY', 'SE2 에디터 준비 완료');
        await sleep(2000); // 에디터 완전 초기화 보장 대기

        // ── 발행 버튼: executeJavaScript 텍스트 기반 클릭
        let clickResult = 'NOT_TRIED';
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            clickResult = await catWin.webContents.executeJavaScript(`
              (function() {
                var btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
                var btn = btns.find(function(b) { return (b.textContent || '').trim() === '발행'; });
                if (!btn) btn = btns.find(function(b) {
                  var t = (b.textContent || '').trim();
                  return t === '발행' || (t.includes('발행') && !t.includes('예약') && t.length < 5);
                });
                if (btn) { btn.click(); return '클릭완료:발행'; }
                // debug: 현재 보이는 버튼 텍스트 목록
                return 'NOT_FOUND:' + btns.slice(0,10).map(function(b){ return (b.textContent||'').trim().slice(0,10); }).join(',');
              })()
            `);
            if (clickResult.startsWith('클릭완료')) break;
          } catch(e) { clickResult = 'ERR:' + e.message; }
          await sleep(1000);
        }
        writeLog('INFO', 'CATEGORY', '발행 버튼 클릭', clickResult);
        await sleep(3000); // 발행 패널 열릴 때까지 충분히 대기

        // ── 카테고리 드롭다운 버튼 클릭 → catBtn 조상 컨테이너에서 li 추출
        try {
          const cats = await catWin.webContents.executeJavaScript(`
            (function() {
              try {
                var SYSTEM = /^(전체보기|저장|발행|예약 발행|예약|취소|닫기|전체공개|비공개|이웃공개|서로이웃|댓글허용|공감허용|검색허용|링크 허용|외부 공유|CCL|발행 설정|새 글쓰기|내 블로그|관리|통계|기본 서체|사진|MYBOX|동영상|스티커|인용구|구분선|링크|파일|일정)$/;

                // 카테고리 드롭다운 버튼 탐색
                var catBtn = null;
                var btns = Array.from(document.querySelectorAll('button, [role="button"]'));

                // 전략 1: 버튼/조상 클래스에 'category' 포함
                for (var i = 0; i < btns.length; i++) {
                  var b = btns[i];
                  var el = b;
                  for (var j = 0; j < 5; j++) {
                    if ((el.className || '').toLowerCase().includes('category')) { catBtn = b; break; }
                    el = el.parentElement;
                    if (!el) break;
                  }
                  if (catBtn) break;
                }

                // 전략 2: 발행 패널 내 시스템 버튼 제외 후 남은 버튼 = 카테고리 버튼
                if (!catBtn) {
                  var panel = document.querySelector('[class*="publish"], [class*="setting"], [class*="panel"]');
                  var panelBtns = panel ? Array.from(panel.querySelectorAll('button')) : btns;
                  catBtn = panelBtns.find(function(b) {
                    var t = (b.textContent || '').trim();
                    return t.length >= 1 && t.length <= 20 && !SYSTEM.test(t) && !/^\\d+$/.test(t);
                  });
                }

                var catBtnText = catBtn ? (catBtn.textContent || '').trim() : 'NOT_FOUND';

                // 드롭다운 클릭
                if (catBtn) catBtn.click();

                return new Promise(function(resolve) {
                  setTimeout(function() {
                    try {
                      // catBtn 조상 컨테이너 탐색 (category 클래스 포함)
                      var container = null;
                      if (catBtn) {
                        var el = catBtn;
                        for (var k = 0; k < 10; k++) {
                          el = el.parentElement;
                          if (!el) break;
                          if ((el.className || '').toLowerCase().includes('category')) { container = el; break; }
                        }
                      }

                      var items;
                      if (container) {
                        items = Array.from(container.querySelectorAll('li'));
                      } else if (catBtn && catBtn.parentElement) {
                        items = Array.from(catBtn.parentElement.querySelectorAll('li'));
                      } else {
                        items = [];
                      }

                      var result = items
                        .map(function(li) { return (li.textContent || '').trim().replace(/\\s+/g, ' '); })
                        .filter(function(t) {
                          return t.length >= 1 && t.length <= 30 && !SYSTEM.test(t) && !/^\\d+$/.test(t);
                        });

                      resolve({ cats: result, catBtnText: catBtnText, containerFound: !!container });
                    } catch(e2) { resolve({ cats: [], catBtnText: catBtnText, err: e2.message }); }
                  }, 1000);
                });
              } catch(e) { return { cats: [], err: e.message }; }
            })()
          `);

          const catList = cats.cats || [];
          writeLog('INFO', 'CATEGORY', '추출 결과 (container-li)',
            JSON.stringify(catList) + ' | catBtn=' + cats.catBtnText + ' | container=' + cats.containerFound);

          if (catList.length > 0) {
            categoryCache.set(accountId, catList);
            writeLog('INFO', 'CATEGORY', '카테고리 로드 성공 (캐시 저장)', `${catList.length}개`);
            clearTimeout(globalTimeout);
            done({ success: true, categories: catList });
          } else {
            writeLog('WARN', 'CATEGORY', '카테고리 미추출 — 빈 결과', JSON.stringify(cats));
            clearTimeout(globalTimeout);
            done({ success: false, error: '카테고리를 찾지 못했습니다' });
          }
        } catch (e) {
          writeLog('ERROR', 'CATEGORY', '카테고리 JS 실행 오류', e.message);
          clearTimeout(globalTimeout);
          done({ success: false, error: e.message });
        }
      };

      catWin.loadURL(writeUrl).then(() => waitForEditor()).catch((e) => {
        writeLog('ERROR', 'CATEGORY', '에디터 로드 실패', e.message);
        clearTimeout(globalTimeout);
        done({ success: false, error: e.message });
      });
    });

  } catch (e) {
    writeLog('ERROR', 'CATEGORY', '카테고리 로드 실패', e.message);
    return { success: false, error: e.message };
  }
});

// ── IPC: blog:getCategoryTopics (2026-07-06, 실제 추출 기능 완성) ──
// 목적: 블로그 관리자 페이지(admin.blog.naver.com)의 카테고리 관리
// 화면에서 실제 카테고리명 ↔ 주제분류(네이버 표준 카테고리) 매칭을
// 읽어와 { 표준주제분류: 실제카테고리명 } 매핑을 반환한다.
//
// 조사 과정에서 확인된 사실(향후 DOM 변경 시 참고):
// - 카테고리 트리는 iframe#papermain 안에 있고, 각 항목은
//   <li class="tree-node ..."><div class="drag-label" tabindex="0">
//   <label><span class="_categoryName">이름</span><em>(글수)</em></label>...
// - 이 트리는 커스텀 JS 위젯이라 onclick 속성이 없고 단순 .click()에도
//   반응하지 않음 — mousedown→mouseup→click을 좌표값과 함께 순서대로
//   dispatch해야 실제 편집 폼이 채워짐(실기기 UI 클릭과 동일 효과).
// - 클릭 후 같은 iframe 안의 #category_name(input) = 실제 카테고리명,
//   #theme_select_button(a) = 현재 선택된 주제분류 텍스트("주제분류
//   선택하지 않음"이면 미설정)로 값을 읽을 수 있음.
// - 카테고리명에 사용자가 직접 넣은 특수 접두 문자(예: "ㅎHㄹi ")가
//   포함될 수 있으므로 절대 임의로 잘라내지 말 것 — 그대로 사용.
ipcMain.handle('blog:getCategoryTopics', async (_, accountId) => {
  try {
    const { getDB } = require('./src/db');
    const account = getDB().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account?.cookies_encrypted) return { success: false, error: '계정 정보 없음' };

    const cookies = JSON.parse(decrypt(account.cookies_encrypted) || '[]');
    const naverId = account.naver_id;
    if (!naverId) return { success: false, error: 'naver_id 없음' };

    writeLog('INFO', 'CATTOPIC', '실제 카테고리 매칭 시작', `accountId=${accountId}, naverId=${naverId}`);

    const partition = `persist:cattopic-${accountId}`;
    const ses = electronSession.fromPartition(partition);
    for (const cookie of cookies) {
      try {
        const urlBase = cookie.domain?.startsWith('.')
          ? `https://www${cookie.domain}`
          : `https://${cookie.domain || 'naver.com'}`;
        await ses.cookies.set({
          url: urlBase, name: cookie.name, value: cookie.value,
          domain: cookie.domain, path: cookie.path || '/',
          secure: !!cookie.secure, httpOnly: !!cookie.httpOnly,
          expirationDate: cookie.expirationDate,
        });
      } catch {}
    }

    const topicWin = new BrowserWindow({
      width: 1300, height: 900, show: false,
      webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
    });
    topicWin.setMenuBarVisibility(false);

    const url = `https://admin.blog.naver.com/AdminMain.naver?blogId=${naverId}&Redirect=Categoryinfo`;

    return new Promise((resolve) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        if (!topicWin.isDestroyed()) topicWin.destroy();
        resolve(result);
      };
      const globalTimeout = setTimeout(() => {
        writeLog('WARN', 'CATTOPIC', '매칭 타임아웃');
        done({ success: false, error: '타임아웃' });
      }, 60000);
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      topicWin.loadURL(url).then(async () => {
        await sleep(3000); // 관리자 페이지/iframe 로딩 대기

        try {
          const resultJson = await topicWin.webContents.executeJavaScript(`
            (async function() {
              function sleep(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }
              function readTopic(doc) {
                var nameInput = doc.getElementById('category_name');
                var themeBtn = doc.getElementById('theme_select_button');
                return {
                  categoryNameValue: nameInput ? (nameInput.value || '').trim() : '',
                  themeButtonText: themeBtn ? (themeBtn.textContent || '').trim() : ''
                };
              }
              function extractCategoryElements(doc) {
                var lis = Array.from(doc.querySelectorAll('li'));
                var result = [];
                lis.forEach(function(li){
                  var t = (li.textContent||'').trim();
                  var m = t.match(/^(.+?)\\((\\d+)\\)접기\\s*or\\s*펼치기$/);
                  if (m) {
                    var name = m[1].trim();
                    if (['쓰레기통','게시판'].indexOf(name) === -1) result.push({ name: name, li: li });
                  }
                });
                return result;
              }
              function simulateFullClick(el) {
                var rect = el.getBoundingClientRect();
                var x = rect.left + rect.width / 2;
                var y = rect.top + rect.height / 2;
                var win = el.ownerDocument.defaultView;
                var opts = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0 };
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
                if (typeof el.focus === 'function') { try { el.focus(); } catch(e) {} }
              }
              function pickClickTarget(li) {
                var kids = Array.from(li.querySelectorAll('a,span,em,strong'));
                var target = null;
                for (var i=0;i<kids.length;i++) {
                  var t = (kids[i].textContent||'').trim();
                  if (t && t.indexOf('접기') === -1 && t.indexOf('펼치기') === -1) { target = kids[i]; break; }
                }
                if (!target) target = li;
                var interactive = target.closest ? target.closest('[tabindex]') : null;
                return interactive || target;
              }

              var iframe = Array.from(document.querySelectorAll('iframe')).find(function(f){ return (f.id||f.name) === 'papermain'; });
              if (!iframe || !iframe.contentDocument) return JSON.stringify({ error: 'papermain iframe 접근 불가' });
              var doc = iframe.contentDocument;

              var catEls = extractCategoryElements(doc);
              if (catEls.length === 0) return JSON.stringify({ error: '카테고리 목록을 찾지 못함' });

              var mapping = {}; // { 표준주제분류: 실제카테고리명 }
              var details = [];
              for (var i = 0; i < catEls.length; i++) {
                var entry = catEls[i];
                var clickTarget = pickClickTarget(entry.li);
                simulateFullClick(clickTarget);
                await sleep(1000);
                var topic = readTopic(doc);
                var realName = topic.categoryNameValue || entry.name;
                details.push({ realName: realName, themeButtonText: topic.themeButtonText });
                if (topic.themeButtonText && topic.themeButtonText !== '주제분류 선택하지 않음') {
                  mapping[topic.themeButtonText] = realName;
                }
              }

              return JSON.stringify({ mapping: mapping, details: details });
            })()
          `);

          const parsed = JSON.parse(resultJson);
          clearTimeout(globalTimeout);
          if (parsed.error) {
            writeLog('WARN', 'CATTOPIC', '매칭 실패', parsed.error);
            done({ success: false, error: parsed.error });
            return;
          }
          writeLog('INFO', 'CATTOPIC', '실제 카테고리 매칭 완료', JSON.stringify(parsed));
          done({ success: true, mapping: parsed.mapping, details: parsed.details });
        } catch (e) {
          writeLog('ERROR', 'CATTOPIC', '매칭 실행 오류', e.message);
          clearTimeout(globalTimeout);
          done({ success: false, error: e.message });
        }
      }).catch((e) => {
        writeLog('ERROR', 'CATTOPIC', '페이지 로드 실패', e.message);
        clearTimeout(globalTimeout);
        done({ success: false, error: e.message });
      });
    });

  } catch (e) {
    writeLog('ERROR', 'CATTOPIC', '실패', e.message);
    return { success: false, error: e.message };
  }
});

// ── IPC: keyword:analyze (네이버 검색광고 API) ───────────────
ipcMain.handle('keyword:analyze', async (event, keywords) => {
  try {
    // 2026-07-14: 키워드 검색량·수익성 조회는 프리미엄 전용 기능.
    const tierLimits = await getTierLimits();
    if (!tierLimits.keywordResearch) {
      return { success: false, error: '키워드 검색량·수익성 조회는 프리미엄 전용 기능입니다. 프리미엄으로 업그레이드하면 이용할 수 있습니다.' };
    }

    const store = getStore();
    const customerId = (store.get('settings.searchAdCustomerId', '') || '').trim();
    const apiKey     = (store.get('settings.searchAdApiKey', '') || '').trim();
    const secretKey  = (store.get('settings.searchAdSecretKey', '') || '').trim();
    if (!customerId || !apiKey || !secretKey) return { success: false, error: '네이버 검색광고 API 키 미설정' };

    const crypto = require('crypto');
    const kws = (Array.isArray(keywords) ? keywords : [keywords]).slice(0, 5).filter(Boolean);
    const results = [];

    for (const kw of kws) {
      await new Promise((resolve) => {
        const timestamp = Date.now().toString();
        const path = '/keywordstool';
        const message = `${timestamp}.GET.${path}`;
        const signature = crypto.createHmac('sha256', secretKey).update(message).digest('base64');
        const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(kw)}&showDetail=1`;
        const req = net.request({ method: 'GET', url });
        req.setHeader('X-Timestamp', timestamp);
        req.setHeader('X-API-KEY', apiKey);
        req.setHeader('X-Customer', customerId);
        req.setHeader('X-Signature', signature);
        let body = '';
        req.on('response', (res) => {
          res.on('data', (chunk) => { body += chunk.toString(); });
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              const items = json.keywordList || [];
              for (const item of items) {
                const pc  = item.monthlyPcQcCnt  || 0;
                const mob = item.monthlyMobileQcCnt || 0;
                results.push({
                  keyword:       item.relKeyword,
                  pcMonthly:     pc,
                  mobileMonthly: mob,
                  total:         pc + mob,
                  compIdx:       item.compIdx || 'low',
                  plAvgDepth:    item.plAvgDepth || 0,
                });
              }
            } catch {}
            resolve();
          });
        });
        req.on('error', () => resolve());
        req.end();
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC: research:getKeywords ─────────────────────────────────
ipcMain.handle('research:getKeywords', () => {
  try {
    const { getDB } = require('./src/db');
    const data = getDB().prepare('SELECT * FROM research_keywords ORDER BY created_at DESC').all();
    return { success: true, data };
  } catch (err) { return { success: false, data: [], error: err.message }; }
});

// ── IPC: research:getCategories (2026-07-05 신규) ─────────────
// 등록된 키워드에서 쓰인 카테고리 목록만 중복 없이 반환 — 자동화 루프에서
// 계정별 카테고리 배정 시 드롭다운으로 보여주기 위함(오타로 인한 불일치 방지).
ipcMain.handle('research:getCategories', () => {
  try {
    const { getDB } = require('./src/db');
    const rows = getDB().prepare(
      "SELECT DISTINCT category FROM research_keywords WHERE TRIM(category) != '' ORDER BY category"
    ).all();
    return { success: true, categories: rows.map(r => r.category) };
  } catch (err) { return { success: false, categories: [], error: err.message }; }
});

// ── IPC: research:addKeyword ──────────────────────────────────
ipcMain.handle('research:addKeyword', (event, { keyword, category = '', intervalHours = 24, dateFrom = null, dateTo = null }) => {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const exists = db.prepare('SELECT id FROM research_keywords WHERE keyword = ?').get(keyword);
    if (exists) return { success: false, error: '이미 등록된 키워드입니다.' };
    const r = db.prepare(
      'INSERT INTO research_keywords (keyword, category, interval_hours, date_from, date_to) VALUES (?, ?, ?, ?, ?)'
    ).run(keyword, category, intervalHours, dateFrom, dateTo);
    return { success: true, id: r.lastInsertRowid };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── IPC: research:deleteKeyword ───────────────────────────────
ipcMain.handle('research:deleteKeyword', (event, id) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('DELETE FROM research_keywords WHERE id = ?').run(id);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── IPC: research:deleteAllKeywords ──────────────────────────
ipcMain.handle('research:deleteAllKeywords', () => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('DELETE FROM research_keywords').run();
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── IPC: research:toggleActive ────────────────────────────────
ipcMain.handle('research:toggleActive', (event, id, val) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE research_keywords SET active = ? WHERE id = ?').run(val ? 1 : 0, id);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── IPC: research:collect ─────────────────────────────────────
// ── 등록 키워드 1건 수집 (2026-07-05: 자동화 루프의 "트렌드 자동 보충"에서도
//    재사용할 수 있도록 ipcMain.handle 본체를 일반 함수로 분리) ──────────
async function collectKeywordItems(id) {
  try {
    const { getDB } = require('./src/db');
    const db = getDB();
    const kw = db.prepare('SELECT * FROM research_keywords WHERE id = ?').get(id);
    if (!kw) return { success: false, error: '키워드 없음' };

    const store = getStore();
    const clientId     = (store.get('settings.naverApiId', '') || '').trim();
    const clientSecret = (store.get('settings.naverApiSecret', '') || '').trim();

    if (!clientId || !clientSecret) return { success: false, error: '네이버 Open API 키 미설정 (환경설정 확인)' };

    // 날짜 필터 파라미터 구성
    let url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(kw.keyword)}&display=10&sort=date`;
    if (kw.date_from) url += `&start=1`; // 날짜 필터는 파라미터 미지원 → 수집 후 필터링

    const items = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'GET', url });
      req.setHeader('X-Naver-Client-Id', clientId);
      req.setHeader('X-Naver-Client-Secret', clientSecret);
      let body = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve(json.items || []);
          } catch { reject(new Error('응답 파싱 실패')); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    let added = 0;
    for (const item of items) {
      const title   = (item.title || '').replace(/<[^>]*>/g, '').trim();
      const summary = (item.description || '').replace(/<[^>]*>/g, '').trim();
      const url     = item.link || '';
      const exists  = db.prepare('SELECT id FROM research_items WHERE url = ?').get(url);
      if (!exists && title) {
        db.prepare(
          'INSERT INTO research_items (keyword_id, keyword_text, title, summary, url, source) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, kw.keyword, title, summary, url, 'naver');
        added++;
      }
    }

    // (2026-07-05 수정) datetime("now","localtime")처럼 큰따옴표를 쓰면 SQLite가
    // "now"를 문자열이 아니라 컬럼명으로 해석하려다 "no such column: now" 예외를
    // 던짐 — 이미 위에서 글감 INSERT는 끝난 뒤라 이 UPDATE만 실패하는데, 그 예외가
    // 아래 catch로 빠지면서 함수 전체가 success:false를 반환해버림. 그 결과
    // last_collected_at은 영영 갱신 안 되고("미수집" 고정), 즉시수집/전체수집에서도
    // 실제로는 저장된 글감이 있는데 실패로 처리돼 신규 개수가 0으로 집계됐음.
    // 작은따옴표로 바꿔 정상적인 SQLite 문자열 리터럴로 수정.
    db.prepare("UPDATE research_keywords SET last_collected_at = datetime('now','localtime') WHERE id = ?").run(id);
    return { success: true, count: added };
  } catch (err) { return { success: false, error: err.message }; }
}

ipcMain.handle('research:collect', async (event, id) => collectKeywordItems(id));

// ── IPC: research:getItems ────────────────────────────────────
ipcMain.handle('research:getItems', (event, kwId) => {
  try {
    const { getDB } = require('./src/db');
    const stmt = kwId
      ? getDB().prepare('SELECT * FROM research_items WHERE keyword_id = ? ORDER BY collected_at DESC')
      : getDB().prepare('SELECT * FROM research_items ORDER BY collected_at DESC');
    const data = kwId ? stmt.all(kwId) : stmt.all();
    return { success: true, data };
  } catch (err) { return { success: false, data: [], error: err.message }; }
});

// ── IPC: research:deleteItem ──────────────────────────────────
ipcMain.handle('research:deleteItem', (event, id) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('DELETE FROM research_items WHERE id = ?').run(id);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── IPC: research:toggleUsed ──────────────────────────────────
ipcMain.handle('research:toggleUsed', (event, id, val) => {
  try {
    const { getDB } = require('./src/db');
    getDB().prepare('UPDATE research_items SET used = ? WHERE id = ?').run(val ? 1 : 0, id);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── IPC: research:getTrends (Google Trends 실시간 스크래핑) ──
ipcMain.handle('research:getTrends', async () => {
  // 2026-07-04: 검색량 기준 재정렬(sortByTraffic) 제거 — 사용자가 웹에서 구글
  // 트렌드 실시간 인기를 직접 봤을 때의 순위와 일치시키려는 의도로 이 스크래핑
  // 방식을 만들었으므로, 스크래핑/RSS가 반환한 순서를 그대로 유지한다.
  // (검색량이 항상 비어있던 이전 버그 때문에 이 정렬이 사실상 무의미해 우연히
  //  구글 순서가 유지되고 있었으나, 검색량 추출을 고치면서 실제로 재정렬이
  //  발동해 순위가 어긋나는 것을 방지하기 위해 명시적으로 제거함)

  // BrowserWindow로 실제 페이지 렌더링 후 스크래핑
  const scrapeViaWindow = () => new Promise((resolve) => {
    let win = null;
    const cleanup = (result) => {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
      win = null;
      resolve(result);
    };
    const timer = setTimeout(() => cleanup([]), 25000);

    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          javascript: true,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
        },
      });

      win.loadURL('https://trends.google.com/trending?geo=KR&sort=2&hours=24&hl=ko', {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      });

      win.webContents.on('did-finish-load', () => {
        // SPA 렌더링 대기 (4초)
        setTimeout(async () => {
          try {
            const data = await win.webContents.executeJavaScript(`
              (function() {
                const results = [];
                // 전략 1: 실제 트렌드 행 — 키워드(.mZ3RIc)와 검색량(.lqv0Cb)을 직접 선택
                // (2026-07-04: 구글이 표 셀 구조를 합쳐서 기존 정규식 기반 검색량 추출이
                //  깨진 것을 실제 페이지 DOM 조사로 확인 후 정확한 클래스 선택자로 교체.
                //  DOM 순서를 그대로 유지해 구글 실시간 인기 페이지와 순위가 일치하도록 함
                //  — 이 결과는 이후 별도로 재정렬하지 않음)
                const rows = document.querySelectorAll('table tbody tr');
                for (const row of rows) {
                  if (row.querySelectorAll('td').length < 2) continue;
                  const kw = row.querySelector('.mZ3RIc')?.textContent?.trim() || '';
                  const traffic = row.querySelector('.lqv0Cb')?.textContent?.trim() || '';
                  if (kw && kw.length > 1 && kw.length < 60) {
                    results.push({ keyword: kw, traffic: traffic.replace(/\\s+/g, ''), news: '' });
                  }
                }
                if (results.length >= 5) return results.slice(0, 25);

                // 전략 2: 데이터 속성 기반 (위 선택자가 다시 바뀔 경우를 대비한 백업)
                const items = document.querySelectorAll('[data-row-id], [jsname="oKdM2c"] tr');
                for (const item of items) {
                  const kw = item.querySelector('.mZ3RIc, [jsname="FKz6V"], [class*="title"]')?.textContent?.trim();
                  const traffic = item.querySelector('.lqv0Cb, [class*="traffic"], [class*="volume"], [jsname="Etxnzd"]')?.textContent?.trim();
                  if (kw && kw.length > 1) results.push({ keyword: kw, traffic: (traffic || '').replace(/\\s+/g, ''), news: '' });
                }
                return results.slice(0, 25);
              })()
            `);
            clearTimeout(timer);
            cleanup(Array.isArray(data) ? data.filter(d => d.keyword) : []);
          } catch { clearTimeout(timer); cleanup([]); }
        }, 4000);
      });

      win.webContents.on('did-fail-load', () => { clearTimeout(timer); cleanup([]); });
    } catch { clearTimeout(timer); cleanup([]); }
  });

  // 1차: BrowserWindow 스크래핑
  try {
    const items = await scrapeViaWindow();
    if (items.length >= 5) return { success: true, data: items };
  } catch {}

  // 2차 fallback: RSS
  try {
    const rssBody = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'GET', url: 'https://trends.google.com/trending/rss?geo=KR' });
      req.setHeader('User-Agent', 'Mozilla/5.0');
      let body = '';
      req.on('response', (res) => { res.on('data', c => { body += c; }); res.on('end', () => resolve(body)); });
      req.on('error', reject);
      req.end();
    });
    const items = [];
    const blocks = rssBody.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const block of blocks.slice(0, 20)) {
      const kw      = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const traffic = (block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/) || [])[1] || '';
      const news    = (block.match(/<ht:news_item_title><!\[CDATA\[(.*?)\]\]>/) || block.match(/<ht:news_item_title>(.*?)<\/ht:news_item_title>/) || [])[1] || '';
      if (kw) items.push({ keyword: kw.trim(), traffic: traffic.trim(), news: news.trim() });
    }
    if (items.length) return { success: true, data: items };
  } catch {}

  return { success: false, error: '트렌드 데이터를 가져올 수 없습니다.' };
});
