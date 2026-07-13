import React, { useState, useEffect, useCallback } from 'react';
import './PublishScheduler.css';
import useLicenseLimits, { PREMIUM_ONLY_TOOLTIP } from '../hooks/useLicenseLimits';

// ── 유틸 ─────────────────────────────────────────────────────
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function firstDayOf(y, m)  { return new Date(y, m, 1).getDay(); } // 0=Sun
function fmtDate(y, m, d)  { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function toDateStr(iso)    { return iso ? iso.slice(0, 10) : ''; }
function toTimeStr(iso)    { return iso ? iso.slice(11, 16) : ''; }

const STATUS_LABEL = {
  scheduled:      { label: '예약', cls: 'badge-scheduled' },
  // (2026-07-03) 네이버 자체 예약 기능으로 등록 완료된 상태 — 우리 앱은 할 일을
  // 다 했고, 실제 발행은 네이버 서버가 예약 시각에 처리함(앱/PC 꺼져있어도 OK)
  reserved:       { label: '네이버 예약됨', cls: 'badge-scheduled' },
  publishing:     { label: '발행중', cls: 'badge-publishing' },
  published:      { label: '발행완료', cls: 'badge-published' },
  'pending_confirm': { label: '확인대기', cls: 'badge-publishing' },
  failed:         { label: '실패', cls: 'badge-failed' },
  cancelled:      { label: '취소', cls: 'badge-cancelled' },
  draft:          { label: '임시저장', cls: 'badge-draft' },
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

const SAFE_DEFAULTS = {
  maxDailyPosts: 3,
  intervalMin: 30,
  intervalMax: 120,
  similarityThreshold: 70,
  // 2026-07-14 신규: 프리미엄 등급의 하루 최대 발행 "무제한" 여부.
  // 스탠다드는 등급 자체가 10회 고정이라 이 값을 아예 보지 않는다.
  maxDailyPostsUnlimited: true,
};

// ── 저품질 위험 권장값 (2026-07-05 신규) ──────────────────────
// 완전자동 자동화 루프처럼 사람 개입 없이 계속 발행되는 상황을 염두에 두고
// 정한 소프트 가이드라인. 하드 블록이 아니라 안내만 하고, 저장 자체는
// 그대로 허용한다(사용자가 스스로 판단해 조정하도록 유도).
const SAFE_RECOMMENDED = {
  maxDailyPostsMax: 5,  // 이보다 많으면 경고
  intervalMinMin: 30,   // 이보다 짧으면 경고
};

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function PublishScheduler() {
  const { limits: tierLimits } = useLicenseLimits();
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(fmtDate(today.getFullYear(), today.getMonth(), today.getDate()));
  const [cancellingId, setCancellingId] = useState(null);
  const [showAllPublished, setShowAllPublished] = useState(false);
  const [showAllSelected,  setShowAllSelected]  = useState(false);
  const PUBLISHED_LIMIT = 5;
  const SELECTED_LIMIT  = 6;

  // 발행 안전 설정
  const [safeForm, setSafeForm] = useState(SAFE_DEFAULTS);
  const [safeSaving, setSafeSaving] = useState(false);
  const [safeSaved,  setSafeSaved]  = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.publish.getAll({ year, month: month + 1 });
      if (res.success) setPosts(res.posts);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  // 발행 안전 설정 로드
  useEffect(() => {
    window.electronAPI.settings.get().then(res => {
      if (res.success) setSafeForm({ ...SAFE_DEFAULTS, ...res.settings });
    });
  }, []);

  const setSafe = (key, value) => {
    setSafeForm(prev => ({ ...prev, [key]: value }));
    setSafeSaved(false);
  };

  const handleSafeSave = async () => {
    setSafeSaving(true);
    // 기존 설정 로드 후 안전 설정만 병합해 저장
    const res = await window.electronAPI.settings.get();
    const merged = { ...(res.success ? res.settings : {}), ...safeForm };
    await window.electronAPI.settings.set(merged);
    setSafeSaving(false);
    setSafeSaved(true);
    setTimeout(() => setSafeSaved(false), 2500);
  };

  // 저품질 우려 소프트 경고 (2026-07-05 신규) — 하드 블록 아님, 저장은 그대로 허용
  const safetyWarnings = [];
  // 2026-07-14: 프리미엄 "무제한" 선택 시에는 사용자가 의도적으로 상한을
  // 없앤 것이므로 이 소프트 경고를 띄우지 않는다(스탠다드는 애초에 10회
  // 고정이라 이 입력 자체를 건드릴 수 없어 경고가 뜰 일이 없다).
  if (!safeForm.maxDailyPostsUnlimited && Number(safeForm.maxDailyPosts) > SAFE_RECOMMENDED.maxDailyPostsMax) {
    safetyWarnings.push(`하루 최대 발행 횟수가 많습니다 — 저품질 우려로 ${SAFE_RECOMMENDED.maxDailyPostsMax}회 이하를 권장합니다.`);
  }
  if (Number(safeForm.intervalMin) < SAFE_RECOMMENDED.intervalMinMin) {
    safetyWarnings.push(`발행 간격이 짧습니다 — 저품질 우려로 최소 ${SAFE_RECOMMENDED.intervalMinMin}분 이상을 권장합니다.`);
  }

  // 날짜별 포스트 맵
  const postsByDate = {};
  posts.forEach(p => {
    const key = toDateStr(p.scheduled_at || p.created_at);
    if (!postsByDate[key]) postsByDate[key] = [];
    postsByDate[key].push(p);
  });

  const selectedPosts = postsByDate[selectedDate] || [];

  // 예약 취소
  const handleCancel = async (id) => {
    if (!window.confirm('예약을 취소하시겠습니까?')) return;
    setCancellingId(id);
    await window.electronAPI.publish.cancel(id);
    setCancellingId(null);
    loadPosts();
  };

  // 월 이동
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  // 캘린더 셀 생성
  const totalDays = daysInMonth(year, month);
  const startDay  = firstDayOf(year, month);
  const cells     = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = fmtDate(today.getFullYear(), today.getMonth(), today.getDate());

  const publishedPosts  = posts.filter(p => p.status === 'published')
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  // (2026-07-03) 'reserved' = 네이버 자체 예약 기능으로 이미 등록 완료된 상태.
  // 'scheduled'(우리 앱 스케줄러가 나중에 처리 예정)와 구분되지만, 목록에는
  // 함께 "예약대기"로 보여준다. 단, 취소 버튼은 'scheduled'에만 남겨둔다
  // (reserved는 이미 네이버 쪽에 등록이 끝나서 우리 앱에서 취소할 수 없음).
  const scheduledPosts  = posts.filter(p => p.status === 'scheduled' || p.status === 'reserved')
    .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));

  return (
    <div className="scheduler">
      <div className="page-header">
        <div>
          <h1>발행 스케줄러</h1>
          <p>예약된 발행 일정과 발행 이력을 확인합니다.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={loadPosts} disabled={loading}>
          {loading ? <span className="spinner-xs" /> : '↻'} 새로고침
        </button>
      </div>

      {/* ── 상단: 캘린더(좌) + 이번달현황·발행안전설정(우) ─── */}
      <div className="scheduler-layout">
        <div className="scheduler-left">
          <div className="card calendar-card">
            <div className="cal-header">
              <button className="cal-nav" onClick={prevMonth}>‹</button>
              <span className="cal-title">{year}년 {month + 1}월</span>
              <button className="cal-nav" onClick={nextMonth}>›</button>
            </div>

            <div className="cal-grid">
              {DAY_NAMES.map((d, i) => (
                <div key={d} className={`cal-day-name${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{d}</div>
              ))}
              {cells.map((d, i) => {
                if (!d) return <div key={`empty-${i}`} />;
                const dateStr  = fmtDate(year, month, d);
                const dayPosts = postsByDate[dateStr] || [];
                const isToday  = dateStr === todayStr;
                const isSel    = dateStr === selectedDate;
                const dayOfWeek = (startDay + d - 1) % 7;
                return (
                  <div
                    key={dateStr}
                    className={`cal-cell${isToday ? ' today' : ''}${isSel ? ' selected' : ''}${dayOfWeek === 0 ? ' sun' : dayOfWeek === 6 ? ' sat' : ''}`}
                    onClick={() => { setSelectedDate(dateStr); setShowAllSelected(false); }}
                  >
                    <span className="cal-day-num">{d}</span>
                    {dayPosts.length > 0 && (
                      <div className="cal-dots">
                        {dayPosts.slice(0, 3).map(p => (
                          <span key={p.id} className={`cal-dot cal-dot-${p.status}`} title={p.title} />
                        ))}
                        {dayPosts.length > 3 && <span className="cal-dot-more">+{dayPosts.length - 3}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="cal-legend">
              <span className="legend-item"><span className="cal-dot cal-dot-scheduled" />예약</span>
              <span className="legend-item"><span className="cal-dot cal-dot-published" />발행완료</span>
              <span className="legend-item"><span className="cal-dot cal-dot-failed" />실패</span>
            </div>
          </div>
        </div>

        {/* ── 우측 영역 ────────────────────────────────────── */}
        <div className="scheduler-right">

          {/* ── 상단 행: 이번 달 현황 + 발행 안전 설정 ──────── */}
          <div className="scheduler-top-row">
            <div className="card month-summary">
              <h3 className="summary-title">이번 달 현황</h3>
              <div className="summary-grid">
                <div className="summary-item">
                  <span className="summary-num" style={{ color: 'var(--success)' }}>
                    {publishedPosts.length}
                  </span>
                  <span className="summary-label">발행 완료</span>
                </div>
                <div className="summary-item">
                  <span className="summary-num" style={{ color: 'var(--accent)' }}>
                    {scheduledPosts.length}
                  </span>
                  <span className="summary-label">예약 대기</span>
                </div>
                <div className="summary-item">
                  <span className="summary-num" style={{ color: 'var(--danger)' }}>
                    {posts.filter(p => p.status === 'failed').length}
                  </span>
                  <span className="summary-label">실패</span>
                </div>
              </div>
            </div>

            <div className="card safe-card">
              <div className="safe-card-header">
                <h3 className="summary-title">발행 안전 설정</h3>
                <button
                  className={`btn btn-sm${safeSaved ? ' btn-saved' : ' btn-primary'}`}
                  onClick={handleSafeSave}
                  disabled={safeSaving}
                >
                  {safeSaving ? '저장 중…' : safeSaved ? '✓ 저장됨' : '저장'}
                </button>
              </div>
              <div className="safe-fields">
                {/* 상단 2열: 일일 최대 발행 | 중복 경고 기준 */}
                <div className="safe-row-2col">
                  <div className="safe-field-item">
                    <span className="sf-label">
                      일일 최대 발행
                      {!tierLimits.isPremium && <span className="premium-locked-badge premium-locked-badge-inline">🔒 프리미엄</span>}
                    </span>
                    <div className="safe-input-grp">
                      <input className={`sf-input${!tierLimits.isPremium ? ' premium-locked' : ''}`} type="number" min={1} max={20}
                        value={tierLimits.isPremium ? safeForm.maxDailyPosts : 10}
                        disabled={!tierLimits.isPremium || safeForm.maxDailyPostsUnlimited}
                        title={!tierLimits.isPremium ? '스탠다드 등급은 하루 최대 10회로 고정되며 직접 변경할 수 없습니다. 프리미엄으로 업그레이드하면 무제한 또는 직접 설정할 수 있습니다.' : undefined}
                        onChange={e => setSafe('maxDailyPosts', Number(e.target.value))} />
                      <span className="sf-unit">회</span>
                      {tierLimits.isPremium && (
                        <label className="sf-unlimited-toggle" style={{ display:'flex', alignItems:'center', gap:'4px', marginLeft:'8px', fontSize:'11px', cursor:'pointer' }}>
                          <input type="checkbox" checked={!!safeForm.maxDailyPostsUnlimited}
                            onChange={e => setSafe('maxDailyPostsUnlimited', e.target.checked)} />
                          무제한
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="safe-field-item">
                    <span className="sf-label">중복 경고 기준</span>
                    <div className="safe-input-grp">
                      <input className="sf-input" type="number" min={1} max={100}
                        value={safeForm.similarityThreshold}
                        onChange={e => setSafe('similarityThreshold', Number(e.target.value))} />
                      <span className="sf-unit">%</span>
                    </div>
                  </div>
                </div>
                {/* 하단 1열 full: 발행 간격 */}
                <div className="safe-field-item">
                  <span className="sf-label">발행 간격</span>
                  <div className="safe-input-grp">
                    <input className="sf-input" type="number" min={1}
                      value={safeForm.intervalMin}
                      onChange={e => setSafe('intervalMin', Number(e.target.value))} />
                    <span className="sf-tilde">~</span>
                    <input className="sf-input" type="number" min={1}
                      value={safeForm.intervalMax}
                      onChange={e => setSafe('intervalMax', Number(e.target.value))} />
                    <span className="sf-unit">분</span>
                  </div>
                </div>
              </div>
              {/* 저품질 우려 소프트 경고 (2026-07-05 신규) — 하드 블록 아님 */}
              {safetyWarnings.length > 0 && (
                <div className="safe-warning">
                  {safetyWarnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── 하단: 날짜별 포스트 + 발행완료/예약대기 (전체 너비) ── */}
      <div className="scheduler-bottom">

        {/* 날짜별 포스트 목록 */}
        <div className="date-panel-header">
          <span className="date-panel-title">{selectedDate.replace(/-/g, '. ')}</span>
          <span className="date-panel-count">{selectedPosts.length}건</span>
        </div>

        {selectedPosts.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">📅</div>
              <p>이 날짜에 작성된 글이 없습니다.</p>
              <p className="empty-sub">글 생성 화면에서 예약 발행을 등록해보세요.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="date-post-grid">
              {(showAllSelected ? selectedPosts : selectedPosts.slice(0, SELECTED_LIMIT)).map(post => {
                const st = STATUS_LABEL[post.status] || { label: post.status, cls: 'badge-draft' };
                return (
                  <div key={post.id} className="card post-item">
                    <div className="post-item-header">
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      <span className="post-item-time">
                        {post.scheduled_at ? toTimeStr(post.scheduled_at) : ''}
                      </span>
                    </div>
                    <p className="post-item-title">{post.title || '(제목 없음)'}</p>
                    <div className="post-item-meta">
                      {post.account_nickname && <span className="meta-chip">👤 {post.account_nickname}</span>}
                      {post.naver_id && <span className="meta-chip">@{post.naver_id}</span>}
                      {post.published_at && <span className="meta-chip">📅 발행 {toTimeStr(post.published_at)}</span>}
                    </div>
                    {post.error_msg && <p className="post-item-error">⚠️ {post.error_msg}</p>}
                    {post.post_url && (
                      <a className="post-item-link" href={post.post_url} target="_blank" rel="noreferrer">
                        블로그 바로가기 →
                      </a>
                    )}
                    {post.status === 'scheduled' && (
                      <button
                        className="btn btn-ghost btn-xs post-cancel-btn"
                        onClick={() => handleCancel(post.id)}
                        disabled={cancellingId === post.id}
                      >
                        {cancellingId === post.id ? '취소 중…' : '예약 취소'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedPosts.length > SELECTED_LIMIT && (
              <button
                className="btn btn-ghost btn-sm published-toggle-btn"
                onClick={() => setShowAllSelected(v => !v)}
              >
                {showAllSelected
                  ? '▲ 접기'
                  : `▼ 더보기 (${selectedPosts.length - SELECTED_LIMIT}건 더)`}
              </button>
            )}
          </>
        )}

        {/* 발행 완료 + 예약 대기 */}
        {(publishedPosts.length > 0 || scheduledPosts.length > 0) && (
          <div className="scheduler-bottom-row">
            {/* 발행 완료 */}
            <div className="queue-col">
              <h3 className="queue-title">✅ 발행 완료 ({publishedPosts.length}건)</h3>
              {publishedPosts.length === 0 ? (
                <div className="card queue-empty"><p>발행된 글이 없습니다.</p></div>
              ) : (
                <>
                  <div className="post-list">
                    {(showAllPublished ? publishedPosts : publishedPosts.slice(0, PUBLISHED_LIMIT)).map(post => (
                      <div key={post.id} className="card post-item post-item-compact">
                        <div className="post-item-header">
                          <span className="badge badge-published">발행완료</span>
                          <span className="post-item-time">
                            {post.published_at ? post.published_at.slice(0, 16).replace('T', ' ') : ''}
                          </span>
                        </div>
                        <p className="post-item-title">{post.title || '(제목 없음)'}</p>
                        {post.post_url && (
                          <a className="post-item-link" href={post.post_url} target="_blank" rel="noreferrer">
                            바로가기 →
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                  {publishedPosts.length > PUBLISHED_LIMIT && (
                    <button
                      className="btn btn-ghost btn-sm published-toggle-btn"
                      onClick={() => setShowAllPublished(v => !v)}
                    >
                      {showAllPublished
                        ? '▲ 접기'
                        : `▼ 더보기 (${publishedPosts.length - PUBLISHED_LIMIT}건 더)`}
                    </button>
                  )}
                </>
              )}
            </div>

              {/* 예약 대기 */}
              <div className="queue-col">
                <h3 className="queue-title">📋 예약 대기 ({scheduledPosts.length}건)</h3>
                {scheduledPosts.length === 0 ? (
                  <div className="card queue-empty"><p>예약된 글이 없습니다.</p></div>
                ) : (
                  <div className="post-list">
                    {scheduledPosts.map(post => (
                      <div key={post.id} className="card post-item post-item-compact">
                        <div className="post-item-header">
                          <span className="badge badge-scheduled">예약</span>
                          <span className="post-item-time">
                            {post.scheduled_at ? post.scheduled_at.slice(0, 16).replace('T', ' ') : ''}
                          </span>
                        </div>
                        <p className="post-item-title">{post.title || '(제목 없음)'}</p>
                        <button
                          className="btn btn-ghost btn-xs post-cancel-btn"
                          onClick={() => handleCancel(post.id)}
                          disabled={cancellingId === post.id}
                        >
                          {cancellingId === post.id ? '취소 중…' : '예약 취소'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
        )}
      </div>
    </div>
  );
}
