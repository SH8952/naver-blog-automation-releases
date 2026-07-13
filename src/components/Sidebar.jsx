import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const NAV_ITEMS = [
  {
    to: '/',
    label: '대시보드',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    to: '/accounts',
    label: '계정 관리',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
  {
    to: '/research',
    label: '글감 수집',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    ),
  },
  {
    to: '/post-create',
    label: '글 생성',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    ),
  },
  {
    to: '/review-queue',
    label: '검수 대기',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
  },
  {
    to: '/scheduler',
    label: '발행 스케줄러',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="8" y1="14" x2="8" y2="14" strokeWidth="3" strokeLinecap="round"/>
        <line x1="12" y1="14" x2="12" y2="14" strokeWidth="3" strokeLinecap="round"/>
        <line x1="16" y1="14" x2="16" y2="14" strokeWidth="3" strokeLinecap="round"/>
        <line x1="8" y1="18" x2="8" y2="18" strokeWidth="3" strokeLinecap="round"/>
        <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    to: '/history',
    label: '발행 이력',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: '환경설정',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  // [개발용] 배포 시 삭제 — 전체 데이터(계정 제외) 초기화 버튼 상태.
  // 2026-07-05: 대시보드 헤더에 있던 걸 사이드바 최하단 구분선 위로 이동.
  // Sidebar는 모든 페이지에 공통으로 떠 있어서 Dashboard 전용 loadAll()을
  // 쓸 수 없으므로, 초기화 이후에는 window.location.reload()로 전체
  // 렌더러를 새로고침해 어떤 페이지에 있든 최신 데이터를 다시 불러오게 함.
  const [resetting, setResetting] = useState(false);
  // 2026-07-08: 하단 버전 표시가 "v1.0.0"으로 하드코딩되어 있어 실제
  // package.json 버전(패키징 시 electron-builder가 반영)과 어긋나던 문제
  // 수정 — main.js의 get-app-version IPC로 실제 앱 버전을 가져와 표시.
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then(setAppVersion).catch(() => {});
  }, []);

  const handleDevReset = async () => {
    if (!window.confirm('계정을 제외한 모든 데이터(발행 이력, 예약 등)를 초기화합니다.\n계속하시겠습니까?')) return;
    setResetting(true);
    await window.electronAPI.dev.reset();
    window.location.reload();
  };

  // [개발용] 배포 시 삭제 — 등급 강제 전환 토글(2026-07-14 신규).
  // 실제 라이선스 키를 매번 새로 발급/적용하지 않고도 스탠다드(ST)/
  // 프리미엄(PR) 화면을 즉시 오갈 수 있게 하는 개발 편의 기능. "개발"은
  // 오버라이드를 끄고 실제 라이선스 로직(키 없으면 스탠다드)으로 돌아간다.
  // main.js가 배포판(app.isPackaged)에서는 isDev=false라 이 값을 절대
  // 반영하지 않으므로, 실수로 켜진 채 배포돼도 아무 효과가 없다.
  const [devTierOverride, setDevTierOverride] = useState(null);
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      window.electronAPI?.dev?.getTierOverride?.().then(res => {
        if (res?.success) setDevTierOverride(res.override);
      }).catch(() => {});
    }
  }, []);

  const handleSetTierOverride = async (value) => {
    const res = await window.electronAPI.dev.setTierOverride(value);
    if (res?.success) {
      // 이미 열려있는 모든 페이지의 tierLimits(useLicenseLimits 훅)를
      // 한 번에 최신 상태로 반영하기 위해 전체 새로고침 — 기존 "초기화
      // [DEV]" 버튼과 동일한 방식.
      window.location.reload();
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">N</div>
        <span className="sidebar-logo-text">네이버 블로그 자동화</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span className="sidebar-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* [개발용] 배포판(패키징 빌드)에서는 숨김 — npm start 개발 모드에서만 표시.
          2026-07-14 신규: 등급 강제 전환 3분할 토글, 초기화 버튼 바로 위에 배치. */}
      {process.env.NODE_ENV === 'development' && (
        <div className="sidebar-dev-tier-toggle" title="개발 전용 — 실제 라이선스와 무관하게 등급 강제 전환(배포판에는 없음)">
          <button type="button"
            className={`sidebar-dev-tier-btn${devTierOverride === 'standard' ? ' active' : ''}`}
            onClick={() => handleSetTierOverride('standard')}>ST</button>
          <button type="button"
            className={`sidebar-dev-tier-btn${devTierOverride === 'premium' ? ' active' : ''}`}
            onClick={() => handleSetTierOverride('premium')}>PR</button>
          <button type="button"
            className={`sidebar-dev-tier-btn${!devTierOverride ? ' active' : ''}`}
            onClick={() => handleSetTierOverride(null)}>개발</button>
        </div>
      )}

      {/* [개발용] 배포판(패키징 빌드)에서는 숨김 — npm start 개발 모드에서만 표시 */}
      {process.env.NODE_ENV === 'development' && (
        <button
          type="button"
          className="sidebar-dev-reset-btn"
          disabled={resetting}
          onClick={handleDevReset}
        >
          {resetting ? '초기화 중…' : '🗑 초기화 [DEV]'}
        </button>
      )}

      <div className="sidebar-footer">{appVersion && `v${appVersion}`}</div>
    </aside>
  );
}
