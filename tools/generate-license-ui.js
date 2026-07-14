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
function firebasePush(pathSeg, data) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(data);
      const url = new URL(`${FIREBASE_DB_URL}/${pathSeg}.json`);
      const req = https.request(url, {
        method: 'POST',
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
  firebasePush('licenses', {
    '시각': formatKoreanTimestamp(),
    '라이선스ID': licenseId,
    '등급': tier,
    '기기수': maxDevices,
    '발급일': issuedAt,
    '만료일': expiresAt || '무제한',
    '이메일': userEmail,
    '판매채널': channel,
    '주문번호': orderId,
    '메모': note,
  });

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
</style>
</head>
<body>
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

  <div class="card history-card">
    <h2>발급 이력 (로컬 기록, keys/license-ledger.json)</h2>
    <div id="historyBox"><div class="empty">불러오는 중…</div></div>
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

  async function loadHistory() {
    const res = await fetch('/api/history');
    const data = await res.json();
    const box = document.getElementById('historyBox');
    if (!data.success || !data.list.length) {
      box.innerHTML = '<div class="empty">아직 발급 이력이 없습니다.</div>';
      return;
    }
    let html = '<table><thead><tr><th>발급일</th><th>등급</th><th>기기수</th><th>만료일</th><th>이메일</th><th>번호</th><th>판매채널</th><th>주문번호</th><th>메모</th></tr></thead><tbody>';
    for (const rec of data.list) {
      html += '<tr>' +
        '<td>' + rec.issuedAt + '</td>' +
        '<td><span class="badge badge-' + rec.tier + '">' + (rec.tier === 'premium' ? '프리미엄' : '스탠다드') + '</span></td>' +
        '<td>' + rec.maxDevices + '대</td>' +
        '<td>' + (rec.expiresAt || '무제한') + '</td>' +
        '<td>' + (rec.userEmail || '-') + '</td>' +
        '<td>' + rec.licenseId + '</td>' +
        '<td>' + (rec.channel || '-') + '</td>' +
        '<td>' + (rec.orderId || '-') + '</td>' +
        '<td>' + (rec.note || '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    box.innerHTML = html;
  }

  async function checkPrivKey() {
    const res = await fetch('/api/status');
    const data = await res.json();
    document.getElementById('privKeyWarn').classList.toggle('show', !data.hasPrivateKey);
  }

  checkPrivKey();
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
