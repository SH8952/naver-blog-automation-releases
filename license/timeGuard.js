// ────────────────────────────────────────────────────────────────────────
// license/timeGuard.js (2026-07-13 신규)
// 라이선스 만료일 검증 시 시스템 시계 조작(타임트래블)을 감지하기 위한
// 보조 모듈. 두 단계로 방어한다.
//   1) 온라인: 신뢰 가능한 외부 HTTPS 서버 응답의 Date 헤더로 "지금"을
//      확인한다(짧은 타임아웃, 실패 시 조용히 2단계로 폴백 — 네트워크가
//      없어도 앱 시작이 막히지 않는다).
//   2) 오프라인: 로컬(electron-store)에 저장해둔 "마지막으로 확인된
//      시각"보다 현재 시스템 시각이 더 과거면 시계를 되돌린 것으로 판단.
// 온라인 확인이 성공하면 그 시각을 만료일 비교에 사용하고, 실패하면
// 시스템 시각을 그대로 사용하되 역행 여부만 오프라인 방식으로 검사한다.
//
// 외부 라이브러리 없이 Node 내장 https 모듈만 사용.
// ────────────────────────────────────────────────────────────────────────

const https = require('https');

const TRUSTED_HOSTS = ['www.google.com', 'www.cloudflare.com'];
const TIMEOUT_MS = 1800;
const LAST_SEEN_STORE_KEY = 'settings._licenseLastSeenAt';
// 클럭 드리프트/서머타임 등으로 인한 오탐을 막기 위한 여유 시간
const TAMPER_TOLERANCE_MS = 5 * 60 * 1000;

// 2026-07-13: 앱 시작마다 이 조회가 걸리므로(라이선스 키가 있는 사용자만
// 해당), 여러 호스트를 순차로 재시도하면 최악의 경우 지연이 너무 길어짐
// (예전 버전은 최대 ~6초). 대신 모든 신뢰 호스트에 동시에 요청을 보내고
// 가장 먼저 응답한 것을 쓰며, 전체 대기 시간은 TIMEOUT_MS로 고정한다 —
// 네트워크가 없거나 모든 호스트가 막혀 있어도 이 시간 안에 반드시
// null로 폴백해 오프라인 검사로 넘어간다.
function fetchOnlineDate() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (date) => {
      if (settled) return;
      settled = true;
      resolve(date);
    };

    TRUSTED_HOSTS.forEach((host) => {
      let req;
      try {
        req = https.request(
          { host, path: '/', method: 'HEAD', timeout: TIMEOUT_MS },
          (res) => {
            const dateHeader = res.headers && res.headers.date;
            res.destroy();
            if (dateHeader) {
              const d = new Date(dateHeader);
              if (!isNaN(d.getTime())) finish(d);
            }
          }
        );
      } catch (e) {
        return;
      }
      req.on('timeout', () => req.destroy());
      req.on('error', () => {});
      req.end();
    });

    // 전체 안전장치 — 모든 호스트가 실패/지연되는 경우에도 이 시점엔
    // 반드시 오프라인 폴백으로 넘어간다.
    setTimeout(() => finish(null), TIMEOUT_MS + 300);
  });
}

// store: electron-store 인스턴스, expiresAt: 'YYYY-MM-DD' | null
// 반환: { tampered, effectiveExpired, trustedNow }
async function checkTimeIntegrity(store, expiresAt) {
  const nowSystem = new Date();

  // 1) 오프라인 역행 감지
  const lastSeenStr = store.get(LAST_SEEN_STORE_KEY, null);
  let tampered = false;
  if (lastSeenStr) {
    const lastSeen = new Date(lastSeenStr);
    if (!isNaN(lastSeen.getTime()) && nowSystem.getTime() < lastSeen.getTime() - TAMPER_TOLERANCE_MS) {
      tampered = true;
    }
  }

  // 2) 온라인 신뢰 시각 확보 시도(실패해도 조용히 폴백)
  let trustedNow = nowSystem;
  try {
    const onlineDate = await fetchOnlineDate();
    if (onlineDate) trustedNow = onlineDate;
  } catch (e) {
    // 무시 — 오프라인 폴백 유지
  }

  // 마지막 확인 시각 갱신은 조작이 감지되지 않았을 때만 수행한다.
  // (조작 상태에서도 계속 시각을 앞으로 밀어주면 다음 실행 때 방어가
  //  무력화되므로, 일단 한 번 조작이 잡히면 그 흔적을 유지한다.)
  if (!tampered) {
    try { store.set(LAST_SEEN_STORE_KEY, trustedNow.toISOString()); } catch (e) {}
  }

  let effectiveExpired = false;
  if (expiresAt) {
    const exp = new Date(`${expiresAt}T23:59:59`);
    effectiveExpired = trustedNow.getTime() > exp.getTime();
  }

  return { tampered, effectiveExpired, trustedNow };
}

module.exports = { checkTimeIntegrity };
