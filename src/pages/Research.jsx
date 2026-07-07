import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './Research.css';

const INTERVAL_OPTIONS = [
  { value: 24, label: '매일' },
  { value: 6,  label: '6시간마다' },
  { value: 12, label: '12시간마다' },
  { value: -1, label: '기간 선택' },
];

// ── 날짜 범위 달력 컴포넌트 ──────────────────────────────────────
function DateRangePicker({ dateFrom, dateTo, onChange, onClose }) {
  const today     = new Date();
  const pad       = n => String(n).padStart(2, '0');
  const toStr     = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayStr  = toStr(today);

  const initYear  = dateFrom ? parseInt(dateFrom.slice(0,4)) : today.getFullYear();
  const initMonth = dateFrom ? parseInt(dateFrom.slice(5,7))-1 : today.getMonth();
  const [vYear,  setVYear]  = useState(initYear);
  const [vMonth, setVMonth] = useState(initMonth);
  const [hover,  setHover]  = useState(null);

  const prevM = () => vMonth === 0 ? (setVYear(y=>y-1), setVMonth(11)) : setVMonth(m=>m-1);
  const nextM = () => vMonth === 11? (setVYear(y=>y+1), setVMonth(0))  : setVMonth(m=>m+1);

  const handleClick = (str) => {
    if (!dateFrom || (dateFrom && dateTo)) {
      // 시작일 새로 선택
      onChange(str, null);
    } else {
      // 종료일 선택
      if (str < dateFrom) { onChange(str, null); }           // 시작일보다 앞 → 재선택
      else if (str === dateFrom) { onChange(null, null); }   // 동일 → 초기화
      else { onChange(dateFrom, str); onClose(); }            // 범위 확정 → 팝업 닫기
    }
  };

  const getClass = (str) => {
    const effEnd = dateTo || hover;
    const lo = dateFrom && effEnd ? [dateFrom, effEnd].sort()[0] : null;
    const hi = dateFrom && effEnd ? [dateFrom, effEnd].sort()[1] : null;
    return [
      'cal-day',
      str === dateFrom && !dateTo ? 'cal-start cal-end' : '',
      str === dateFrom && dateTo  ? 'cal-start' : '',
      str === dateTo              ? 'cal-end'   : '',
      lo && hi && str > lo && str < hi ? 'cal-in' : '',
      str === todayStr            ? 'cal-today' : '',
    ].filter(Boolean).join(' ');
  };

  const firstDay    = new Date(vYear, vMonth, 1).getDay();
  const daysInMonth = new Date(vYear, vMonth+1, 0).getDate();
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const DAYS   = ['일','월','화','수','목','금','토'];

  const fmtLabel = (s) => s ? s.replace(/-/g, '.') : '';

  return (
    <div className="cal-popup" onClick={e => e.stopPropagation()}>
      {/* 월 네비게이션 */}
      <div className="cal-head">
        <button className="cal-nav" onClick={prevM}>‹</button>
        <span className="cal-title">{vYear}년 {MONTHS[vMonth]}</span>
        <button className="cal-nav" onClick={nextM}>›</button>
      </div>

      {/* 달력 그리드 */}
      <div className="cal-grid">
        {DAYS.map(d => <span key={d} className="cal-dow">{d}</span>)}
        {Array.from({length: firstDay}, (_, i) => <span key={`b${i}`} />)}
        {Array.from({length: daysInMonth}, (_, i) => {
          const d   = i + 1;
          const str = `${vYear}-${pad(vMonth+1)}-${pad(d)}`;
          return (
            <button
              key={str}
              className={getClass(str)}
              onClick={() => handleClick(str)}
              onMouseEnter={() => setHover(str)}
              onMouseLeave={() => setHover(null)}
            >{d}</button>
          );
        })}
      </div>

      {/* 하단: 선택 표시 + 버튼 */}
      <div className="cal-foot">
        <span className="cal-sel-txt">
          {!dateFrom
            ? '시작일을 선택하세요'
            : !dateTo
              ? `${fmtLabel(dateFrom)} ~ 종료일 선택`
              : `${fmtLabel(dateFrom)} ~ ${fmtLabel(dateTo)}`}
        </span>
        <div className="cal-foot-btns">
          <button className="cal-btn-clear" onClick={() => onChange(null, null)}>초기화</button>
          {dateFrom && dateTo &&
            <button className="cal-btn-apply" onClick={onClose}>확인</button>}
        </div>
      </div>

    </div>
  );
}

export default function Research() {
  // ── 키워드 상태 ───────────────────────────────────────────
  const [keywords, setKeywords]       = useState([]);
  const [kwInput, setKwInput]         = useState('');
  const [kwCategory, setKwCategory]   = useState('');
  const [kwInterval, setKwInterval]   = useState(24);
  const [kwLoading, setKwLoading]     = useState(false);

  // ── 기간 선택 달력 상태 ───────────────────────────────────
  const [calFrom,    setCalFrom]    = useState(null);   // 'YYYY-MM-DD'
  const [calTo,      setCalTo]      = useState(null);   // 'YYYY-MM-DD'
  const [showCal,    setShowCal]    = useState(false);
  const calWrapRef = useRef(null); // 달력 바깥 클릭 감지용 (overlay로 대체됨)

  // ── 글감 상태 ─────────────────────────────────────────────
  const [items, setItems]             = useState([]);
  const [filterKw, setFilterKw]       = useState('all');
  const [collectingId, setCollectingId] = useState(null); // 수집 중인 키워드 id
  const [collectingAll, setCollectingAll] = useState(false);
  const [collectingNow, setCollectingNow] = useState(false);
  const [statusMsg, setStatusMsg]     = useState('');

  // ── 키워드 분석 상태 ──────────────────────────────────────
  const [analyzeInput, setAnalyzeInput]     = useState('');
  const [analyzeResults, setAnalyzeResults] = useState([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError]     = useState('');
  const [sortKey, setSortKey]   = useState(null);   // 정렬 기준 컬럼
  const [sortDir, setSortDir]   = useState('desc'); // 'desc' | 'asc'

  // ── 트렌드 상태 ───────────────────────────────────────────
  const [trends, setTrends]           = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState('');
  const [trendsLoaded, setTrendsLoaded] = useState(false);

  // ── 데이터 로드 ───────────────────────────────────────────
  const loadKeywords = useCallback(async () => {
    const res = await window.electronAPI.research.getKeywords();
    if (res.success) setKeywords(res.data);
  }, []);

  const loadItems = useCallback(async (kwId = 'all') => {
    const res = await window.electronAPI.research.getItems(kwId === 'all' ? null : kwId);
    if (res.success) setItems(res.data);
  }, []);

  useEffect(() => {
    loadKeywords();
    loadItems();
  }, [loadKeywords, loadItems]);

  // 달력 바깥 클릭 시 닫기
  useEffect(() => {
    if (!showCal) return;
    const handleOutside = (e) => {
      if (calWrapRef.current && !calWrapRef.current.contains(e.target)) {
        setShowCal(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showCal]);

  // ── 키워드 추가 ───────────────────────────────────────────
  const handleAddKeyword = async () => {
    const kw = kwInput.trim();
    if (!kw) return;
    if (kwInterval === -1 && (!calFrom || !calTo)) {
      showStatus('기간을 선택해주세요 (시작일 ~ 종료일)');
      setShowCal(true);
      return;
    }
    setKwLoading(true);
    const res = await window.electronAPI.research.addKeyword({
      keyword: kw,
      category: kwCategory.trim(),
      intervalHours: kwInterval,
      dateFrom: kwInterval === -1 ? calFrom : null,
      dateTo:   kwInterval === -1 ? calTo   : null,
    });
    setKwLoading(false);
    if (res.success) {
      setKwInput('');
      // 2026-07-06: 카테고리는 사용자가 직접 지우기 전까지 유지 —
      // 같은 카테고리로 여러 키워드를 연속 등록하는 경우가 많아
      // 매번 다시 입력하지 않도록 함 (setKwCategory('') 제거).
      setKwInterval(24);
      setCalFrom(null);
      setCalTo(null);
      setShowCal(false);
      await loadKeywords();
      showStatus('키워드가 추가되었습니다.');
    } else {
      showStatus(`오류: ${res.error}`);
    }
  };

  // ── 키워드 삭제 ───────────────────────────────────────────
  const handleDeleteKeyword = async (id) => {
    if (!window.confirm('이 키워드와 수집된 글감을 모두 삭제할까요?')) return;
    await window.electronAPI.research.deleteKeyword(id);
    if (filterKw === String(id)) setFilterKw('all');
    await loadKeywords();
    await loadItems(filterKw === String(id) ? 'all' : filterKw);
    showStatus('삭제되었습니다.');
  };

  // ── 키워드 분석 (네이버 검색광고 API) ───────────────────────
  const handleAnalyze = async () => {
    const kws = analyzeInput.split(',').map(k => k.trim()).filter(Boolean);
    if (!kws.length) return;
    if (kws.length > 5) { setAnalyzeError('한 번에 최대 5개까지 조회 가능합니다.'); return; }
    setAnalyzeLoading(true);
    setAnalyzeError('');
    setAnalyzeResults([]);
    const res = await window.electronAPI.research.analyzeKeyword(kws);
    setAnalyzeLoading(false);
    if (res.success) {
      setAnalyzeResults(res.data || []);
      if (!res.data?.length) setAnalyzeError('조회 결과가 없습니다.');
    } else {
      setAnalyzeError(res.error || '오류가 발생했습니다.');
    }
  };

  const fmtVol = (v) => {
    if (v === '<10' || v === 0) return v === '<10' ? '<10' : '0';
    if (v >= 10000) return (v / 10000).toFixed(1) + '만';
    if (v >= 1000) return (v / 1000).toFixed(1) + '천';
    return String(v);
  };

  const compLabel = (c) => {
    if (c === 'low')  return { text: '낮음', cls: 'comp-low' };
    if (c === 'mid')  return { text: '중간', cls: 'comp-mid' };
    if (c === 'high') return { text: '높음', cls: 'comp-high' };
    return { text: '-', cls: '' };
  };

  // ── 컬럼 헤더 클릭 정렬 ────────────────────────────────────
  const COMP_ORDER = { low: 1, mid: 2, high: 3 };
  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc'); // 처음 클릭은 내림차순
    }
  };
  const sortedResults = useMemo(() => {
    if (!sortKey || analyzeResults.length === 0) return analyzeResults;
    return [...analyzeResults].sort((a, b) => {
      const va = sortKey === 'compIdx'
        ? (COMP_ORDER[a.compIdx] ?? 0)
        : (Number(a[sortKey]) || 0);
      const vb = sortKey === 'compIdx'
        ? (COMP_ORDER[b.compIdx] ?? 0)
        : (Number(b[sortKey]) || 0);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  }, [analyzeResults, sortKey, sortDir]);
  // 정렬 아이콘 반환 헬퍼
  const sortIcon = (key) => {
    if (sortKey !== key) return <span className="sort-icon sort-idle">⇅</span>;
    return <span className="sort-icon sort-active">{sortDir === 'desc' ? '▼' : '▲'}</span>;
  };

  // ── 트렌드 로드 ──────────────────────────────────────────
  const loadTrends = async () => {
    setTrendsLoading(true);
    setTrendsError('');
    const res = await window.electronAPI.research.getTrends();
    setTrendsLoading(false);
    setTrendsLoaded(true);
    if (res.success) {
      setTrends(res.data || []);
    } else {
      setTrendsError('트렌드를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.');
    }
  };

  // 트렌드/키워드 분석 결과를 등록된 키워드로 추가
  // 2026-07-06: category를 빈 문자열로 고정하고 있어서, "글감 수집"의
  // 배정 카테고리 입력값(kwCategory)이 설정돼 있어도 키워드 분석/트렌드
  // 쪽 "+ 등록" 버튼으로 추가하면 카테고리가 전혀 저장되지 않던 버그 수정
  // — 직접 추가(handleAddKeyword)와 동일하게 kwCategory를 사용하도록 함.
  const handleAddTrendAsKeyword = async (keyword) => {
    const res = await window.electronAPI.research.addKeyword({
      keyword,
      category: kwCategory.trim(),
      intervalHours: 24,
      dateFrom: null,
      dateTo: null,
    });
    if (res.success) {
      await loadKeywords();
      showStatus(`"${keyword}" 키워드로 등록되었습니다.`);
    }
  };

  // ── 키워드 전체 삭제 ─────────────────────────────────────
  const handleDeleteAllKeywords = async () => {
    if (keywords.length === 0) return;
    if (!window.confirm(`등록된 키워드 ${keywords.length}개와 수집된 글감을 모두 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    await window.electronAPI.research.deleteAllKeywords();
    setFilterKw('all');
    await loadKeywords();
    await loadItems('all');
    showStatus('모든 키워드와 글감이 삭제되었습니다.');
  };

  // ── 활성/비활성 토글 ──────────────────────────────────────
  const handleToggleActive = async (id, current) => {
    await window.electronAPI.research.toggleActive(id, !current);
    await loadKeywords();
  };

  // ── 단일 키워드 수집 ──────────────────────────────────────
  const handleCollect = async (id) => {
    setCollectingId(id);
    showStatus('수집 중…');
    const res = await window.electronAPI.research.collect(id);
    setCollectingId(null);
    if (res.success) {
      showStatus(`✓ ${res.count}개 글감 수집 완료`);
      await loadKeywords();
      await loadItems(filterKw);
    } else {
      showStatus(`⚠️ ${res.error}`);
    }
  };

  // ── 전체 수집 (인터벌이 지난 키워드만) ──────────────────────
  const handleCollectAll = async () => {
    const now = Date.now();
    const due = keywords.filter(k => {
      if (!k.active) return false;
      const lastMs = k.last_collected_at ? new Date(k.last_collected_at).getTime() : 0;
      return now - lastMs >= k.interval_hours * 3600000;
    });
    if (!due.length) { showStatus('수집 시간이 된 키워드가 없습니다.'); return; }
    setCollectingAll(true);
    showStatus('전체 수집 중…');
    let total = 0;
    // (2026-07-05 추가) 이전에는 실패한 키워드를 그냥 무시하고 항상 "완료"만
    // 표시했음 — 실제로 오류가 나도 사용자가 알 방법이 없었음. 이제 실패 건은
    // 따로 모아서 알림에 함께 표시.
    const errors = [];
    for (const kw of due) {
      const res = await window.electronAPI.research.collect(kw.id);
      if (res.success) total += res.count;
      else errors.push(`${kw.keyword}: ${res.error}`);
    }
    setCollectingAll(false);
    if (errors.length) {
      showStatus(`⚠️ ${total}개 신규 (실패 ${errors.length}건 — ${errors[0]})`);
    } else {
      showStatus(`✓ ${due.length}개 키워드 → ${total}개 글감 수집 완료`);
    }
    await loadKeywords();
    await loadItems(filterKw);
  };

  // ── 즉시 수집 (인터벌 무시, 모든 활성 키워드) ──────────────
  const handleCollectNow = async () => {
    const active = keywords.filter(k => k.active);
    if (!active.length) { showStatus('활성화된 키워드가 없습니다.'); return; }
    setCollectingNow(true);
    showStatus('즉시 수집 중…');
    let total = 0;
    // (2026-07-05 추가) handleCollectAll과 동일한 이유로 실패 건을 모아서 표시.
    const errors = [];
    for (const kw of active) {
      const res = await window.electronAPI.research.collect(kw.id);
      if (res.success) total += res.count;
      else errors.push(`${kw.keyword}: ${res.error}`);
    }
    setCollectingNow(false);
    if (errors.length) {
      showStatus(`⚠️ ${total}개 신규 글감 (실패 ${errors.length}건 — ${errors[0]})`);
    } else {
      showStatus(`✓ 즉시 수집 완료 — ${total}개 신규 글감`);
    }
    await loadKeywords();
    await loadItems(filterKw);
  };

  // ── 글감 필터 변경 ────────────────────────────────────────
  const handleFilterChange = async (val) => {
    setFilterKw(val);
    await loadItems(val === 'all' ? null : val);
  };

  // ── 글감 삭제 ─────────────────────────────────────────────
  const handleDeleteItem = async (id) => {
    await window.electronAPI.research.deleteItem(id);
    await loadItems(filterKw === 'all' ? null : filterKw);
  };

  // ── 글감 사용 여부 토글 ───────────────────────────────────
  const handleToggleUsed = async (id, current) => {
    await window.electronAPI.research.toggleUsed(id, !current);
    setItems(prev => prev.map(it => it.id === id ? { ...it, used: current ? 0 : 1 } : it));
  };

  const showStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  const fmtTime = (iso) => {
    if (!iso) return '미수집';
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d) / 60000);
    if (diff < 1)   return '방금';
    if (diff < 60)  return `${diff}분 전`;
    if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;
    return `${Math.floor(diff / 1440)}일 전`;
  };

  return (
    <div className="research-page">
      {/* 헤더 (2026-07-05: 다른 화면과 동일한 page-header 구조로 통일) */}
      <div className="page-header">
        <div className="research-header-left">
          <div className="research-title-row">
            <h1>글감 수집</h1>
            {statusMsg && <span className={`research-status ${statusMsg.startsWith('⚠️') ? 'err' : 'ok'}`}>{statusMsg}</span>}
          </div>
          <p>키워드를 등록하고 실시간 트렌드를 확인해 블로그 글감을 자동으로 수집합니다.</p>
        </div>
        <div className="research-header-right">
          <button
            className="btn btn-collect-now"
            onClick={handleCollectNow}
            disabled={collectingNow || collectingAll || keywords.filter(k=>k.active).length === 0}
            title="인터벌 무시 — 모든 활성 키워드를 지금 바로 수집"
          >
            {collectingNow ? <><span className="spinner-sm"/>수집 중…</> : '⚡ 즉시 수집'}
          </button>
          <button
            className="btn btn-collect-all"
            onClick={handleCollectAll}
            disabled={collectingAll || collectingNow || keywords.filter(k=>k.active).length === 0}
            title="수집 시간이 된 키워드만 수집"
          >
            {collectingAll ? <><span className="spinner-sm"/>수집 중…</> : '🔄 전체 수집'}
          </button>
        </div>
      </div>

      {/* 키워드 입력 폼 */}
      <div className="research-form">
        <div className="research-kw-wrap">
          <input
            className="input research-kw-input"
            placeholder="수집 키워드 (예: 강남 맛집)"
            value={kwInput}
            onChange={e => setKwInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !kwLoading) {
                handleAddKeyword();
              }
            }}
          />
          {kwInput && (
            <button
              type="button"
              className="research-cat-clear-btn"
              title="키워드 지우기"
              onClick={() => setKwInput('')}
            >×</button>
          )}
        </div>
        <div className="research-cat-wrap">
          <input
            className="input research-cat-input"
            placeholder="카테고리 (자동화 루프)"
            value={kwCategory}
            onChange={e => setKwCategory(e.target.value)}
          />
          {kwCategory && (
            <button
              type="button"
              className="research-cat-clear-btn"
              title="카테고리 지우기"
              onClick={() => setKwCategory('')}
            >×</button>
          )}
        </div>
        <select
          className="input research-interval-select"
          value={kwInterval}
          onChange={e => {
            const v = Number(e.target.value);
            setKwInterval(v);
            if (v === -1) setShowCal(true);
            else { setShowCal(false); setCalFrom(null); setCalTo(null); }
          }}
        >
          {INTERVAL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {showCal && kwInterval === -1 && (
          <>
            <div className="cal-overlay" onClick={() => setShowCal(false)} />
            <DateRangePicker
              dateFrom={calFrom}
              dateTo={calTo}
              onChange={(f, t) => { setCalFrom(f); setCalTo(t); }}
              onClose={() => setShowCal(false)}
            />
          </>
        )}
        <button
          type="button"
          className="btn btn-add-kw"
          onClick={handleAddKeyword}
          disabled={!kwInput.trim() || kwLoading}
        >
          {kwLoading ? <span className="spinner-sm"/> : '+ 추가'}
        </button>
      </div>

      {/* 본문 2열 레이아웃 */}
      <div className="research-body">
        {/* 왼쪽: 키워드 목록 */}
        <div className="research-panel kw-panel">
          <div className="panel-label-row">
            <span className="panel-section-title">등록된 키워드 <em>({keywords.length})</em></span>
            {keywords.length > 0 && (
              <button
                className="btn-sm btn-del-all"
                onClick={handleDeleteAllKeywords}
                title="등록된 키워드와 수집된 글감을 모두 삭제합니다"
              >전체삭제</button>
            )}
          </div>
          <div className="kw-list">
            {keywords.length === 0 && (
              <div className="empty-msg">키워드를 추가하면 자동으로 글감을 수집합니다.</div>
            )}
            {keywords.map(kw => (
              <div key={kw.id} className={`kw-item ${!kw.active ? 'kw-inactive' : ''}`}>
                <div className="kw-item-top">
                  <button
                    className={`kw-active-dot ${kw.active ? 'active' : ''}`}
                    title={kw.active ? '클릭하여 비활성화' : '클릭하여 활성화'}
                    onClick={() => handleToggleActive(kw.id, kw.active)}
                  />
                  <span className="kw-name">{kw.keyword}</span>
                  {kw.category && <span className="kw-cat">{kw.category}</span>}
                  <span className="kw-interval">
                    {kw.interval_hours === -1 && kw.date_from && kw.date_to
                      ? `${kw.date_from.slice(5).replace('-','.')}~${kw.date_to.slice(5).replace('-','.')}`
                      : INTERVAL_OPTIONS.find(o=>o.value===kw.interval_hours)?.label || `${kw.interval_hours}h`}
                  </span>
                </div>
                <div className="kw-item-bot">
                  <span className="kw-last">마지막 수집: {fmtTime(kw.last_collected_at)}</span>
                  <div className="kw-actions">
                    <button
                      className="btn-sm btn-collect"
                      onClick={() => handleCollect(kw.id)}
                      disabled={!!collectingId || collectingAll}
                    >
                      {collectingId === kw.id ? <span className="spinner-sm"/> : '수집'}
                    </button>
                    <button
                      className="btn-sm btn-del"
                      onClick={() => handleDeleteKeyword(kw.id)}
                    >삭제</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 오른쪽: 수집된 글감 */}
        <div className="research-panel items-panel">
          <div className="panel-label-row">
            <span className="panel-section-title">수집된 글감 <em>({items.length})</em></span>
            <select
              className="input items-filter-select"
              value={filterKw}
              onChange={e => handleFilterChange(e.target.value)}
            >
              <option value="all">전체 키워드</option>
              {keywords.map(kw => (
                <option key={kw.id} value={String(kw.id)}>{kw.keyword}</option>
              ))}
            </select>
          </div>
          <div className="items-list">
            {items.length === 0 && (
              <div className="empty-msg">수집된 글감이 없습니다.<br/>키워드를 등록하고 수집 버튼을 눌러보세요.</div>
            )}
            {items.map(item => (
              <div key={item.id} className={`item-card ${item.used ? 'item-used' : ''}`}>
                <div className="item-card-top">
                  <span className="item-kw-badge">{item.keyword_text}</span>
                  <span className={`item-src-badge item-src-${item.source || 'naver'}`}>
                    {item.source === 'google' ? '🔍 구글' : 'N 네이버'}
                  </span>
                  <div className="item-actions">
                    <button
                      className={`btn-sm ${item.used ? 'btn-used' : 'btn-unused'}`}
                      onClick={() => handleToggleUsed(item.id, item.used)}
                      title={item.used ? '미사용으로 변경' : '사용됨으로 표시'}
                    >{item.used ? '✓ 사용됨' : '미사용'}</button>
                    <button className="btn-sm btn-del" onClick={() => handleDeleteItem(item.id)}>✕</button>
                  </div>
                </div>
                <a
                  className="item-title"
                  href={item.url}
                  onClick={e => { e.preventDefault(); window.electronAPI && window.open && window.open(item.url); }}
                  title={item.url}
                >
                  {item.title || '(제목 없음)'}
                </a>
                {item.summary && <p className="item-summary">{item.summary}</p>}
                <span className="item-date">{fmtTime(item.collected_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 하단 스크롤 영역 (키워드 분석 + 트렌드) ── */}
      <div className="research-bottom-scroll">

      {/* ── 키워드 분석 섹션 (CORE 05) ── */}
      <div className="analyze-section">
        <div className="analyze-header">
          <div className="analyze-title-wrap">
            <span className="analyze-icon">🔍</span>
            <span className="analyze-title">키워드 분석</span>
            <span className="analyze-sub">검색량 · 경쟁도 조회 — 네이버 검색광고 API</span>
          </div>
        </div>

        <div className="analyze-input-row">
          <div className="analyze-kw-wrap">
            <input
              className="input analyze-kw-input"
              placeholder="키워드 입력 (쉼표로 최대 5개, 예: 강남 맛집, 홍대 카페)"
              value={analyzeInput}
              onChange={e => setAnalyzeInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !analyzeLoading) handleAnalyze();
              }}
            />
            {analyzeInput && (
              <button
                type="button"
                className="research-cat-clear-btn"
                title="키워드 지우기"
                onClick={() => {
                  setAnalyzeInput('');
                  setAnalyzeResults([]); // 2026-07-06: 입력 지우면 펼쳐진 분석 결과도 원상태로 복귀
                }}
              >×</button>
            )}
          </div>
          <button
            className="btn btn-analyze"
            onClick={handleAnalyze}
            disabled={!analyzeInput.trim() || analyzeLoading}
          >
            {analyzeLoading ? <><span className="spinner-sm"/>조회 중…</> : '📊 분석'}
          </button>
        </div>

        {analyzeError && <div className="analyze-error">{analyzeError}</div>}

        {analyzeResults.length > 0 && (
          <div className="analyze-table-wrap">
            <table className="analyze-table">
              <thead>
                <tr>
                  <th>키워드</th>
                  <th className="th-sortable" onClick={() => handleSort('pcMonthly')}>
                    PC 검색량{sortIcon('pcMonthly')}
                  </th>
                  <th className="th-sortable" onClick={() => handleSort('mobileMonthly')}>
                    모바일 검색량{sortIcon('mobileMonthly')}
                  </th>
                  <th className="th-sortable" onClick={() => handleSort('total')}>
                    월 총 검색량{sortIcon('total')}
                  </th>
                  <th className="th-sortable" onClick={() => handleSort('compIdx')}>
                    경쟁도{sortIcon('compIdx')}
                  </th>
                  <th className="th-sortable" onClick={() => handleSort('plAvgDepth')}>
                    평균 순위{sortIcon('plAvgDepth')}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((row, i) => {
                  const comp = compLabel(row.compIdx);
                  return (
                    <tr key={i}>
                      <td className="analyze-kw-cell">{row.keyword}</td>
                      <td className="analyze-num">{fmtVol(row.pcMonthly)}</td>
                      <td className="analyze-num">{fmtVol(row.mobileMonthly)}</td>
                      <td className="analyze-num analyze-total">{fmtVol(row.total)}</td>
                      <td><span className={`comp-badge ${comp.cls}`}>{comp.text}</span></td>
                      <td className="analyze-num">{row.plAvgDepth || '-'}</td>
                      <td>
                        <button
                          className="btn-sm btn-collect"
                          onClick={() => handleAddTrendAsKeyword(row.keyword)}
                          title="이 키워드를 글감 수집에 등록"
                        >+ 등록</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 트렌드 키워드 섹션 ── */}
      <div className="trends-section">
        <div className="trends-header">
          <div className="trends-title-wrap">
            <span className="trends-icon">📈</span>
            <span className="trends-title">실시간 트렌드 키워드</span>
            <span className="trends-sub">Google 한국 급상승 검색어</span>
          </div>
          <button
            className="btn-trends-load"
            onClick={loadTrends}
            disabled={trendsLoading}
          >
            {trendsLoading
              ? <><span className="spinner-sm" /> 불러오는 중…</>
              : trendsLoaded ? '🔄 새로고침' : '📊 트렌드 불러오기'}
          </button>
        </div>

        {trendsError && (
          <div className="trends-error">{trendsError}</div>
        )}

        {!trendsLoaded && !trendsLoading && !trendsError && (
          <div className="trends-empty">
            버튼을 눌러 현재 한국에서 가장 많이 검색되는 키워드를 확인하세요.
          </div>
        )}

        {trendsLoaded && !trendsLoading && !trendsError && trends.length === 0 && (
          <div className="trends-empty">
            트렌드 데이터를 가져왔지만 항목이 없습니다.<br/>
            잠시 후 새로고침을 눌러주세요.
          </div>
        )}

        {trends.length > 0 && (
          <div className="trends-grid">
            {trends.map((t, i) => (
              <div key={i} className="trend-chip">
                <span className="trend-rank">{i + 1}</span>
                <div className="trend-info">
                  <div className="trend-kw-row">
                    <span className="trend-kw">{t.keyword}</span>
                    <span className="trend-traffic">{t.traffic ? `${t.traffic} 검색` : '-'}</span>
                  </div>
                  {t.news && <span className="trend-news" title={t.news}>📰 {t.news}</span>}
                </div>
                <button
                  className="trend-add-btn"
                  onClick={() => handleAddTrendAsKeyword(t.keyword)}
                  title="이 키워드를 글감 수집에 등록"
                >+ 등록</button>
              </div>
            ))}
          </div>
        )}
      </div>

      </div>{/* /research-bottom-scroll */}
    </div>
  );
}
