import { useState, useEffect, useCallback } from 'react';

// ── 등급별 사용 제한 훅 (2026-07-14 신규) ────────────────────────
// license:getLimits IPC를 페이지마다 반복해서 useEffect+useState로 감싸지
// 않도록 만든 공용 훅. main.js의 getTierLimits()와 동일한 필드 구조를
// 그대로 노출한다: { tier, isPremium, maxAccounts, automationLoop,
// reservation, thumbnail, keywordResearch, maxDailyPosts, devTierOverride }.
// maxDailyPosts는 프리미엄일 때 0/미설정이면 무제한(Infinity)으로 계산되어
// 내려온다 — 별도의 "무제한" 불리언 필드는 없음(2026-07-14 단순화).
//
// 주의: 이 훅의 값은 어디까지나 "버튼을 비활성화할지" 판단하는 UI 표시용
// 이다. 실제 차단(보안 경계)은 main.js의 각 IPC 핸들러 내부에서 별도로
// 다시 확인한다 — 렌더러 값은 개발자 도구 등으로 조작될 수 있기 때문.
const FALLBACK_LIMITS = {
  tier: 'standard', isPremium: false, maxAccounts: 1,
  automationLoop: false, reservation: false, thumbnail: false,
  keywordResearch: false, maxDailyPosts: 10,
};

export default function useLicenseLimits() {
  const [limits, setLimits] = useState(FALLBACK_LIMITS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await window.electronAPI.license.getLimits();
      if (res && res.limits) setLimits(res.limits);
    } catch {
      // 조회 자체가 실패해도 기본값(스탠다드)을 유지해 UI가 깨지지 않게 한다.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { limits, loading, reload };
}

// 비활성화된 프리미엄 전용 버튼/입력에 공통으로 사용할 안내 문구.
export const PREMIUM_ONLY_TOOLTIP = '프리미엄 전용 기능입니다. 프리미엄으로 업그레이드하면 이용할 수 있습니다.';
