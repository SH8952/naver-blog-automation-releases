import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

// ── 7일 바차트 컴포넌트 ──────────────────────────────────────
function TrendChart({ data }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.count), 1);

  // SVG 좌표 (viewBox = 0 0 280 100)
  const W = 280, H = 100;
  const padL = 22, padR = 8, padT = 14, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = (chartW / data.length) * 0.5;
  const gap   = chartW / data.length;

  // Y 그리드라인 (0, max/2, max)
  const gridVals = [0, Math.round(maxVal / 2), maxVal].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" aria-label="7일 발행 트렌드">
      {/* 그리드라인 */}
      {gridVals.map(v => {
        const y = padT + chartH - (v / maxVal) * chartH;
        return (
          <g key={v}>
            <line x1={padL} y1={y} x2={W - padR} y2={y}
              stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3" />
            <text x={padL - 3} y={y + 1} textAnchor="end" fontSize={6}
              fill="var(--text-muted)">{v}</text>
          </g>
        );
      })}

      {/* 바 */}
      {data.map((d, i) => {
        const barH = Math.max((d.count / maxVal) * chartH, d.count > 0 ? 2 : 0);
        const cx   = padL + gap * i + gap / 2;
        const x    = cx - barW / 2;
        const y    = padT + chartH - barH;
        const isToday = i === data.length - 1;

        return (
          <g key={d.date}>
            <rect
              x={x} y={y} width={barW} height={barH}
              rx={2}
              fill={isToday ? 'var(--accent)' : 'rgba(79,216,110,0.45)'}
            />
            {/* 값 레이블 (0이 아닐 때만) */}
            {d.count > 0 && (
              <text x={cx} y={y - 2} textAnchor="middle" fontSize={6}
                fill={isToday ? 'var(--accent)' : 'var(--text-secondary)'}>
                {d.count}
              </text>
            )}
            {/* 날짜 레이블 */}
            <text x={cx} y={H - padB + 9} textAnchor="middle" fontSize={6.5}
              fill={isToday ? 'var(--accent)' : 'var(--text-muted)'}>
              {d.dayName}
            </text>
            <text x={cx} y={H - padB + 18} textAnchor="middle" fontSize={5.5}
              fill="var(--text-muted)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 계정별 수평 바 차트 ───────────────────────────────────────
function AccountChart({ data }) {
  if (!data || data.length === 0) return null;
  const maxVal = Math.max(...data.map(d => d.published || 0), 1);

  const COLORS = [
    'var(--accent)', 'var(--success)', 'var(--info)',
    'var(--warning)', '#a78bfa', '#f472b6',
  ];

  return (
    <div className="account-chart">
      {data.map((acc, i) => {
        const name = acc.nickname || acc.naver_id || '알 수 없음';
        const pct  = Math.round(((acc.published || 0) / maxVal) * 100);
        return (
          <div key={i} className="acc-row">
            <span className="acc-name" title={name}>{name}</span>
            <div className="acc-bar-wrap">
              <div
                className="acc-bar"
                style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }}
              />
            </div>
            <span className="acc-count">{acc.published || 0}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── 빠른 이동 버튼 ────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: '글 생성하기', icon: '✦', path: '/post-create', accent: true },
  { label: '계정 관리',   icon: '👤', path: '/accounts' },
  { label: '스케줄러',    icon: '📅', path: '/scheduler' },
  { label: '환경설정',    icon: '⚙️', path: '/settings' },
];

// ── 자동화 루프: 모드 로테이션 버튼 (2026-07-05 신규) ─────────
// 클릭할 때마다 수동 → 완전자동 → 반자동 → 수동 순으로 순환.
// "수동"은 루프 꺼짐(기존과 동일한 수동 운영) 상태를 의미한다.
const LOOP_MODE_ORDER = ['manual', 'auto', 'semi'];
const LOOP_MODE_LABEL = { manual: '수동', auto: '완전자동', semi: '반자동' };
const LOOP_STEP_LABEL = {
  idle: '대기 중', collecting: '글감 수집 중', generating: '글 생성 중',
  publishing: '발행 중', waiting: '다음 발행 대기 중',
};

// ── 메인 대시보드 ─────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const [stats,    setStats]    = useState(null);
  const [recent,   setRecent]   = useState([]);
  const [trend,    setTrend]    = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);

  // ── 자동화 루프 제어 (2026-07-05 신규) ────────────────────
  const [loopMode, setLoopMode]         = useState('manual'); // 'manual' | 'auto' | 'semi'
  const [loopStatus, setLoopStatus]     = useState(null);      // main 프로세스 실행 상태
  const [loopBusy, setLoopBusy]         = useState(false);     // 시작/중지 요청 진행 중
  const [loopError, setLoopError]       = useState('');

  const refreshLoopStatus = useCallback(async () => {
    try {
      const res = await window.electronAPI.automationLoop.getStatus();
      if (res.success) setLoopStatus(res.state);
    } catch { /* 상태 표시용 폴링이므로 실패는 무시 */ }
  }, []);

  useEffect(() => {
    refreshLoopStatus();
    // 종료 카운트다운이 떠 있을 때는 1초마다, 평소엔 5초마다 갱신
    const tick = () => {
      refreshLoopStatus();
    };
    const intervalMs = loopStatus?.shutdown?.active ? 1000 : 5000;
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [refreshLoopStatus, loopStatus?.shutdown?.active]);

  const cycleLoopMode = () => {
    if (loopStatus?.running) return; // 실행 중에는 모드 변경 불가 (먼저 중지 필요)
    const idx = LOOP_MODE_ORDER.indexOf(loopMode);
    setLoopMode(LOOP_MODE_ORDER[(idx + 1) % LOOP_MODE_ORDER.length]);
    setLoopError('');
  };

  const handleLoopStartStop = async () => {
    setLoopError('');
    if (loopStatus?.running) {
      setLoopBusy(true);
      await window.electronAPI.automationLoop.stop();
      await refreshLoopStatus();
      setLoopBusy(false);
      return;
    }
    if (loopMode === 'manual') return;
    setLoopBusy(true);
    const res = await window.electronAPI.automationLoop.start(loopMode);
    setLoopBusy(false);
    if (!res.success) { setLoopError(res.error || '자동화 루프를 시작할 수 없습니다.'); return; }
    await refreshLoopStatus();
  };

  const handleCancelShutdown = async () => {
    await window.electronAPI.automationLoop.cancelShutdown();
    await refreshLoopStatus();
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [statsRes, trendRes, accRes] = await Promise.all([
      window.electronAPI.dashboard.getStats(),
      window.electronAPI.dashboard.getTrend(),
      window.electronAPI.dashboard.getAccountStats(),
    ]);
    if (statsRes.success) { setStats(statsRes.stats); setRecent(statsRes.recent || []); }
    if (trendRes.success)  setTrend(trendRes.trend || []);
    if (accRes.success)    setAccounts(accRes.accounts || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const statCards = [
    { label: '오늘 발행',    value: stats?.todayPublished  ?? 0, unit: '건', color: 'var(--accent)' },
    { label: '이번 주 발행', value: stats?.weekPublished   ?? 0, unit: '건', color: 'var(--success)' },
    { label: '전체 발행',    value: stats?.totalPublished  ?? 0, unit: '건', color: 'var(--info)' },
    { label: '등록 계정',    value: stats?.totalAccounts   ?? 0, unit: '개', color: 'var(--warning)' },
  ];

  function fmtDt(iso) { return iso ? iso.slice(0, 16).replace('T', ' ') : ''; }

  const hasTrendData   = trend.some(d => d.count > 0);
  const hasAccountData = accounts.some(a => (a.published || 0) > 0);

  return (
    <div className="dashboard">
      {/* 헤더 */}
      <div className="page-header">
        <div>
          <h1>대시보드</h1>
          <p>
            블로그 자동화 현황을 한눈에 확인하세요.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {stats?.scheduled > 0 && (
            <div className="scheduled-badge" onClick={() => navigate('/scheduler')} title="스케줄러 보기">
              🕐 예약 대기 {stats.scheduled}건
            </div>
          )}

          <button className="btn btn-ghost btn-sm" onClick={loadAll} disabled={loading}>
            {loading ? '…' : '↻ 새로고침'}
          </button>

          {/* 자동화 루프: 모드 선택 + 시작/중지 (2026-07-05 신규) */}
          <div className="loop-controls">
            <button
              className={`loop-mode-btn loop-mode-${loopMode}`}
              onClick={cycleLoopMode}
              disabled={loopStatus?.running}
              title="클릭할 때마다 수동 → 완전자동 → 반자동 순으로 전환됩니다"
            >
              {LOOP_MODE_LABEL[loopMode]}
            </button>
            <button
              className={`loop-startstop-btn${loopStatus?.running ? ' running' : ''}`}
              onClick={handleLoopStartStop}
              disabled={loopBusy || (!loopStatus?.running && loopMode === 'manual')}
            >
              {loopBusy ? '…' : loopStatus?.running ? '■ 중지' : '▶ 시작'}
            </button>
          </div>
        </div>
      </div>

      {/* 자동화 루프 오류 메시지 */}
      {loopError && <div className="loop-error-banner">⚠ {loopError}</div>}

      {/* 자동화 루프 실행 상태 배너 */}
      {loopStatus?.running && (
        <div className="loop-status-banner">
          <span className="loop-status-dot" />
          <span className="loop-status-mode">{loopStatus.mode === 'auto' ? '완전자동' : '반자동'} 실행 중</span>
          <span className="loop-status-sep">·</span>
          <span>{LOOP_STEP_LABEL[loopStatus.currentStep] || loopStatus.currentStep || '대기 중'}</span>
          {loopStatus.currentAccountName && (
            <><span className="loop-status-sep">·</span><span>👤 {loopStatus.currentAccountName}</span></>
          )}
          <span className="loop-status-sep">·</span>
          <span>사이클 {(loopStatus.cycleIndex ?? 0) + 1}{loopStatus.totalCycles ? ` / ${loopStatus.totalCycles}` : ''}</span>
          <span className="loop-status-sep">·</span>
          <span>이번 사이클 {loopStatus.processedCount ?? 0} / {loopStatus.totalAccounts ?? 0}계정 처리</span>
          {loopStatus.currentStep === 'waiting' && loopStatus.nextRunAt && (
            <>
              <span className="loop-status-sep">·</span>
              <span>다음 발행 예정: {new Date(loopStatus.nextRunAt).toTimeString().slice(0,5)}</span>
            </>
          )}
        </div>
      )}

      {/* PC 종료 카운트다운 (완전자동 + 키워드 소진 시) */}
      {loopStatus?.shutdown?.active && (
        <div className="loop-shutdown-banner">
          <span>⏻ 등록된 글감을 모두 사용했습니다. {loopStatus.shutdown.secondsLeft}초 후 PC가 종료됩니다.</span>
          <button className="btn btn-sm" onClick={handleCancelShutdown}>취소</button>
        </div>
      )}

      {/* 통계 카드 4개 */}
      <div className="dashboard-stats">
        {statCards.map(stat => (
          <div className="stat-card card" key={stat.label}>
            {loading
              ? <div className="stat-skeleton" />
              : <div className="stat-value" style={{ color: stat.color }}>
                  {stat.value}<span className="stat-unit">{stat.unit}</span>
                </div>
            }
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* 차트 영역 */}
      <div className="dashboard-charts">
        {/* 7일 트렌드 */}
        <div className="card chart-card">
          <div className="chart-header">
            <h2 className="section-title" style={{ marginBottom: 0 }}>7일 발행 트렌드</h2>
            <span className="chart-sub">최근 7일 기준</span>
          </div>
          {loading ? (
            <div className="chart-skeleton" />
          ) : hasTrendData ? (
            <TrendChart data={trend} />
          ) : (
            <div className="chart-empty">📊 발행 데이터가 없습니다.</div>
          )}
        </div>

        {/* 계정별 현황 */}
        <div className="card chart-card">
          <div className="chart-header">
            <h2 className="section-title" style={{ marginBottom: 0 }}>계정별 발행 현황</h2>
          </div>
          {loading ? (
            <div className="chart-skeleton" />
          ) : hasAccountData ? (
            <AccountChart data={accounts.filter(a => (a.published || 0) > 0)} />
          ) : accounts.length === 0 ? (
            <div className="chart-empty">👤 등록된 계정이 없습니다.</div>
          ) : (
            <div className="chart-empty">📭 아직 발행된 글이 없습니다.</div>
          )}
        </div>
      </div>

      {/* 최근 발행 글 + 빠른 이동 */}
      <div className="dashboard-bottom">
        {/* 최근 발행 글 */}
        <div className="card dashboard-recent">
          <h2 className="section-title">최근 발행 글</h2>
          {loading ? (
            <div className="loading-rows">
              {[1,2,3].map(i => <div key={i} className="loading-row" />)}
            </div>
          ) : recent.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <p>아직 발행된 글이 없습니다.</p>
              <p className="empty-sub">글 생성 화면에서 첫 번째 포스팅을 시작해보세요!</p>
            </div>
          ) : (
            <div className="recent-list">
              {recent.map((p, i) => (
                <div key={i} className="recent-item">
                  <div className="recent-item-left">
                    <p className="recent-title">{p.title}</p>
                    <span className="recent-meta">
                      {p.account_nickname && <span>👤 {p.account_nickname}</span>}
                      {p.published_at && <span>· {fmtDt(p.published_at)}</span>}
                    </span>
                  </div>
                  {p.post_url && (
                    <a className="recent-link" href={p.post_url} target="_blank" rel="noreferrer">바로가기 →</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 빠른 이동 */}
        <div className="card dashboard-quickactions">
          <h2 className="section-title">빠른 이동</h2>
          <div className="quick-actions">
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.path}
                className={`quick-action-btn${a.accent ? ' quick-action-primary' : ''}`}
                onClick={() => navigate(a.path)}
              >
                <span className="qa-icon">{a.icon}</span>
                <span className="qa-label">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
