import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import './Research.css';
import useLicenseLimits, { PREMIUM_ONLY_TOOLTIP } from '../hooks/useLicenseLimits';

const INTERVAL_OPTIONS = [
  { value: 24, label: '매일' },
  { value: 6,  label: '6시간마다' },
  { value: 12, label: '12시간마다' },
  { value: -1, label: '기간 선택' },
];

// 2026-08-15 신규: "바로 글 생성" 모달의 톤 선택용 — PostCreate.jsx의
// TONE_OPTIONS(파일 내부 상수, export 안 됨)와 동일한 value/label만 복제
// (설명(desc)까지는 이 모달의 단순 select에는 필요 없어 생략).
const GOTO_TONE_OPTIONS = [
  { value: 'info',      label: '정보형' },
  { value: 'daily',     label: '일상형' },
  { value: 'review',    label: '리뷰형' },
  { value: 'emotional', label: '감성형' },
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
  const { limits: tierLimits } = useLicenseLimits();
  const navigate = useNavigate(); // 2026-08-15 신규: 바로 글 생성 이동용
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
  const [showGotoModal, setShowGotoModal] = useState(false); // 2026-08-15 신규: 바로 글 생성 — 키워드 선택 모달
  const [gotoTone, setGotoTone] = useState('info'); // 2026-08-15 신규: 모달에서 고르는 글 톤(기본 정보형)

  // ── 키워드 분석 상태 ──────────────────────────────────────
  const [analyzeInput, setAnalyzeInput]     = useState('');
  const [analyzeResults, setAnalyzeResults] = useState([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError]     = useState('');
  const [sortKey, setSortKey]   = useState(null);   // 정렬 기준 컬럼
  const [sortDir, setSortDir]   = useState('desc'); // 'desc' | 'asc'

  // ── 키워드 인텐트 분류 상태 (2026-08-19 신규) ────────────────
  // "키워드 분석" 결과의 연관 키워드 전체를 롱테일/정보형/거래형/탐색형
  // 으로 분류한 결과. "분석" 버튼 클릭 시 검색량 조회와 함께 실행됨.
  const [intentResults, setIntentResults] = useState({ longtail: [], informational: [], transactional: [], navigational: [] });
  const [intentLoading, setIntentLoading] = useState(false);

  // ── 에버그린 키워드 판별 상태 (2026-08-19 신규, 개발자 전용) ──
  // evergreenMap: 키워드 문자열 → 판정 결과({classification, method, cv, reason, monthsCount})
  // "등록된 키워드" 목록과 "키워드 분석" 표 양쪽에서 키워드 텍스트 기준으로 공유해서 씀.
  const isDevBuild = process.env.NODE_ENV === 'development';
  const [evergreenMap, setEvergreenMap] = useState({});
  const [evergreenLoadingKw, setEvergreenLoadingKw] = useState(new Set());

  // ── 트렌드 상태 ───────────────────────────────────────────
  const [trends, setTrends]           = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState('');
  const [trendsLoaded, setTrendsLoaded] = useState(false);

  // ── 데이터 로드 ───────────────────────────────────────────
  // 2026-08-19 신규(개발자 전용): 저장된 에버그린 판정 결과만 조회(API
  // 호출 없이 DB 캐시만 읽음) — 키워드 목록을 불러올 때마다 같이 채움.
  const loadEvergreenCached = useCallback(async (kwList) => {
    if (!isDevBuild || !kwList || !kwList.length) return;
    const res = await window.electronAPI.evergreen.getCached(kwList);
    if (res.success) setEvergreenMap(prev => ({ ...prev, ...res.results }));
  }, [isDevBuild]);

  const loadKeywords = useCallback(async () => {
    const res = await window.electronAPI.research.getKeywords();
    if (res.success) {
      setKeywords(res.data);
      loadEvergreenCached(res.data.map(k => k.keyword));
    }
  }, [loadEvergreenCached]);

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
      // 2026-08-19 신규(개발자 전용): 검색량 조회와 별개로 에버그린 판별도
      // 같이 실행 — 실패해도 검색량 결과 표시에는 영향 없음(fire-and-forget).
      if (isDevBuild) handleEvergreenAnalyze(kws);
      // 2026-08-19 신규(개발자 전용 — 사용자 요청으로 재지정, 검증 전까지
      // 배포판 제외): 연관 키워드 전체(검색량 결과의 keyword들)를 대상으로
      // 롱테일/정보형/거래형/탐색형 분류도 같이 실행.
      if (isDevBuild) {
        const relatedKws = [...new Set((res.data || []).map(r => r.keyword).filter(Boolean))];
        if (relatedKws.length) handleClassifyIntent(relatedKws);
        else setIntentResults({ longtail: [], informational: [], transactional: [], navigational: [] });
      }
    } else {
      setAnalyzeError(res.error || '오류가 발생했습니다.');
      setIntentResults({ longtail: [], informational: [], transactional: [], navigational: [] });
    }
  };

  // ── 키워드 인텐트 분류 실행 (2026-08-19 신규) ─────────────────
  // 규칙 기반 매칭을 main.js 쪽에서 먼저 적용하고, 패턴에 안 걸린
  // 키워드만 모아 AI에 단 1회(배치) 호출 — 결과만 받아 상태에 반영.
  const handleClassifyIntent = async (keywordsArr) => {
    const kws = (keywordsArr || []).filter(Boolean);
    if (!isDevBuild || !kws.length) return;
    setIntentLoading(true);
    const res = await window.electronAPI.research.classifyIntent(kws);
    setIntentLoading(false);
    if (res.success) {
      setIntentResults({
        longtail: res.longtail || [],
        informational: res.informational || [],
        transactional: res.transactional || [],
        navigational: res.navigational || [],
      });
    }
  };

  // ── 에버그린 키워드 판별 실행 (2026-08-19 신규, 개발자 전용) ──
  // keywordsArr에 담긴 키워드들을 실제로 데이터랩 API(+필요 시 AI 폴백)로
  // 판별해 evergreenMap을 갱신. "등록된 키워드"의 개별 판별 버튼과
  // "키워드 분석"의 분석 버튼 양쪽에서 재사용.
  const handleEvergreenAnalyze = async (keywordsArr) => {
    const kws = (keywordsArr || []).filter(Boolean);
    if (!isDevBuild || !kws.length) return;
    setEvergreenLoadingKw(prev => new Set([...prev, ...kws]));
    const res = await window.electronAPI.evergreen.analyze(kws);
    setEvergreenLoadingKw(prev => {
      const next = new Set(prev);
      kws.forEach(k => next.delete(k));
      return next;
    });
    if (res.success) {
      const map = {};
      for (const r of res.results || []) map[r.keyword] = r;
      setEvergreenMap(prev => ({ ...prev, ...map }));
    }
  };

  // 판정 결과 → 배지 JSX (없으면 null, 로딩 중이면 스피너)
  const renderEvergreenBadge = (keyword) => {
    if (!isDevBuild) return null;
    if (evergreenLoadingKw.has(keyword)) return <span className="eg-badge eg-loading"><span className="spinner-sm"/></span>;
    const r = evergreenMap[keyword];
    if (!r || !r.classification || r.classification === 'unknown') return null;
    // 2026-08-19 추가: 판정 방식(데이터랩 실측 vs AI 대체)을 배지에 바로
    // 노출 — 신규 API라 실제로 데이터랩이 성공했는지 AI로 조용히
    // 폴백됐는지 hover 없이 한눈에 구분하기 위함(개발자 전용 디버그용).
    // 2026-08-19 수정(사용자 요청): 키워드 분석 표에 컬럼이 늘어나며
    // 가로 스크롤이 생기던 문제 — 텍스트를 최대한 줄여 공간 절약.
    const methodTag = r.method === 'ai' ? 'AI' : 'DL';
    const title = r.method === 'ai'
      ? (r.reason || 'AI 판단')
      : `CV ${r.cv != null ? r.cv.toFixed(2) : '-'} · ${r.monthsCount ?? 0}개월 데이터`;
    const cls = r.classification === 'evergreen' ? 'eg-ever' : 'eg-season';
    const icon = r.classification === 'evergreen' ? '🌲 에버그린' : '☀️ 시즌성';
    return (
      <span className={`eg-badge ${cls}`} title={title}>
        {icon} <em className="eg-method">{methodTag}</em>
      </span>
    );
  };

  const fmtVol = (v) => {
    if (v === '<10' || v === 0) return v === '<10' ? '<10' : '0';
    if (v >= 10000) return (v / 10000).toFixed(1) + '만';
    if (v >= 1000) return (v / 1000).toFixed(1) + '천';
    return String(v);
  };

  // 2026-08-19 수정: 네이버 검색광고 API가 실제로 돌려주는 경쟁정도 값은
  // 영어('low'/'mid'/'high')가 아니라 한글 문자열("낮음"/"중간"/"높음")
  // 이라, 기존 영어 매칭 조건이 한 번도 매치되지 않아 항상 "-"만
  // 표시되던 버그(사용자 제보) — 실제 값 기준으로 매칭하도록 수정.
  const compLabel = (c) => {
    if (c === '낮음')  return { text: '낮음', cls: 'comp-low' };
    if (c === '중간')  return { text: '중간', cls: 'comp-mid' };
    if (c === '높음')  return { text: '높음', cls: 'comp-high' };
    return { text: '-', cls: '' };
  };

  // ── 컬럼 헤더 클릭 정렬 ────────────────────────────────────
  // 2026-08-19 수정: compLabel과 동일한 이유로 정렬 기준 키도 한글로 통일
  // (정렬 클릭 시 값이 매칭 안 돼 전부 0으로 취급되던 문제도 같이 해결됨).
  const COMP_ORDER = { '낮음': 1, '중간': 2, '높음': 3 };
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

  // 2026-07-29 신규(사용자 요청): 트렌드 패널이 "트렌드 불러오기" 버튼을
  // 직접 눌러야만 채워지는 방식이라 있는 줄 모르고 지나치기 쉬웠음 —
  // 이 화면(글감 수집)에 들어올 때마다 자동으로 한 번 불러오도록 변경.
  // loadTrends()가 끝나면 trendsLoaded가 true로 바뀌면서 버튼 라벨도
  // 자동으로 "🔄 새로고침"으로 바뀜(기존 로직 그대로, 별도 처리 불필요).
  // 2026-08-05 수정: 원래 있던 "// eslint-disable-next-line
  // react-hooks/exhaustive-deps" 주석이 일부 환경(Windows 빌드)에서
  // "규칙을 찾을 수 없음" 에러로 빌드 자체를 막는 문제가 있어 제거함.
  // loadTrends를 의존성 배열에 넣지 않아 콘솔 경고가 다시 뜰 수 있으나
  // 경고는 빌드를 막지 않고, 기능(진입 시 1회 자동 로드)은 동일함.
  // 2026-08-19 수정(사용자 요청): 다른 화면 갔다가 돌아올 때마다(이 컴포넌트
  // 재마운트) 매번 재스크래핑하던 문제 — 1시간 이내 캐시가 있으면 그걸 먼저
  // 써서 대기 없이 바로 보여주고, 없거나 만료됐을 때만 실시간 재조회.
  // "🔄 새로고침" 버튼은 이 캐시와 무관하게 항상 loadTrends()로 실시간 조회.
  useEffect(() => {
    (async () => {
      const cached = await window.electronAPI.research.getTrendsCached();
      if (cached.success) {
        setTrends(cached.data || []);
        setTrendsLoaded(true);
      } else {
        loadTrends();
      }
    })();
  }, []);

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

  // ── 바로 글 생성 (2026-08-15 신규) ──────────────────────────
  // 등록된 키워드가 1개면 곧바로, 2개 이상이면 모달에서 고른 키워드로
  // "글 생성" 화면(topic/keywords 자동 채움)으로 이동. ReviewQueue.jsx의
  // "글 생성으로 이동"(reviewPost state) 패턴을 그대로 재사용.
  const goToPostCreateWithKeyword = (keyword) => {
    setShowGotoModal(false);
    // 2026-08-15 수정(사용자 요청): 키워드 칸에 주제와 동일한 문구만
    // 채워지면 사용자가 결국 "키워드 자동 생성" 버튼을 또 눌러야 하는
    // 번거로움이 있어 — autoSuggestKeywords 플래그로 PostCreate.jsx가
    // 도착 직후 자동으로 키워드를 생성하도록 함(URL 가져오기 기능과 동일
    // 패턴). keywords는 생성 실패 시를 대비한 폴백으로 그대로 둠.
    // 2026-08-15 추가: 모달에서 고른 톤(gotoTone)과 autoGenerate 플래그도
    // 함께 전달 — 키워드 자동 생성이 끝나면 이어서 글 생성까지 자동으로
    // 진행되도록 함(URL 가져오기 기능과 동일한 흐름).
    navigate('/post-create', {
      state: {
        reviewPost: {
          topic: keyword,
          keywords: keyword,
          tone: gotoTone,
          autoSuggestKeywords: true,
          autoGenerate: true,
        },
      },
    });
  };
  // 2026-08-15 수정(사용자 요청): 키워드가 1개뿐이어도 톤을 고를 수 있어야
  // 하므로 더 이상 즉시 이동하지 않고 항상 모달을 띄움(문구만 1개/여러개
  // 경우로 분기 — 모달 렌더링 쪽에서 처리).
  const handleGotoPostCreate = () => {
    if (keywords.length === 0) return;
    setGotoTone('info');
    setShowGotoModal(true);
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
            className="btn btn-goto-postcreate"
            onClick={handleGotoPostCreate}
            disabled={keywords.length === 0}
            title="등록된 키워드로 글 생성 화면으로 이동"
          >
            ✍️ 바로 글 생성
          </button>
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
                  {renderEvergreenBadge(kw.keyword)}
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
                    {isDevBuild && (
                      <button
                        className="btn-sm btn-evergreen"
                        onClick={() => handleEvergreenAnalyze([kw.keyword])}
                        disabled={evergreenLoadingKw.has(kw.keyword)}
                        title="에버그린 키워드 판별(개발자 전용)"
                      >판별</button>
                    )}
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
                  setIntentResults({ longtail: [], informational: [], transactional: [], navigational: [] }); // 2026-08-19: 인텐트 분류 결과도 같이 초기화
                }}
              >×</button>
            )}
          </div>
          <button
            className={`btn btn-analyze${!tierLimits.keywordResearch ? ' premium-lock-host' : ''}`}
            onClick={handleAnalyze}
            disabled={!analyzeInput.trim() || analyzeLoading || !tierLimits.keywordResearch}
            title={!tierLimits.keywordResearch ? PREMIUM_ONLY_TOOLTIP : undefined}
          >
            {analyzeLoading ? <><span className="spinner-sm"/>조회 중…</> : '📊 분석'}
            {!tierLimits.keywordResearch && (
              <span className="premium-lock-overlay"><span className="premium-locked-badge">🔒 프리미엄</span></span>
            )}
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
                  {isDevBuild && <th>에버그린</th>}
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
                      {isDevBuild && <td>{renderEvergreenBadge(row.keyword) || <span className="eg-badge-empty">-</span>}</td>}
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

      {/* ── 키워드 인텐트 분류 섹션 (2026-08-19 신규) ──
          "키워드 분석" 결과의 연관 키워드를 롱테일/정보형/거래형/탐색형으로
          분류해 보여줌. 규칙 매칭 우선 + 미매칭분 AI 배치 호출(혼합 방식). */}
      {isDevBuild && (intentLoading || intentResults.longtail.length || intentResults.informational.length || intentResults.transactional.length || intentResults.navigational.length) ? (
        <div className="intent-section">
          <div className="intent-header">
            <span className="analyze-icon">🧭</span>
            <span className="analyze-title">키워드 유형 분류</span>
            <span className="analyze-sub">롱테일 · 정보형 · 거래형 · 탐색형 — 규칙 매칭 + AI 보완</span>
            {intentLoading && <span className="spinner-sm" style={{ marginLeft: 8 }}/>}
          </div>
          <div className="intent-grid">
            {[
              { key: 'longtail', label: '롱테일 키워드', icon: '🔗' },
              { key: 'informational', label: '정보형 키워드', icon: '📘' },
              { key: 'transactional', label: '거래형 키워드', icon: '🛒' },
              { key: 'navigational', label: '탐색형 키워드', icon: '🧭' },
            ].map(col => (
              <div className="intent-col" key={col.key}>
                <div className="intent-col-title">{col.icon} {col.label} <span className="intent-count">{intentResults[col.key].length}</span></div>
                <div className="intent-chip-list">
                  {intentResults[col.key].length === 0 && !intentLoading && (
                    <span className="intent-empty">-</span>
                  )}
                  {intentResults[col.key].map((kw, idx) => (
                    <button
                      type="button"
                      key={`${col.key}-${idx}`}
                      className="intent-chip"
                      title="이 키워드를 글감 수집에 등록"
                      onClick={() => handleAddTrendAsKeyword(kw)}
                    >{kw} <span className="intent-chip-plus">+</span></button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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

      {/* 2026-08-15 신규: 바로 글 생성 — 키워드 선택 + 톤 선택 모달
          (키워드 개수와 무관하게 항상 표시, 제목 문구만 분기) */}
      {showGotoModal && (
        <div className="modal-overlay" onClick={() => setShowGotoModal(false)}>
          <div className="modal-box goto-postcreate-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              {keywords.length === 1 ? '해당 키워드로 글을 생성할까요?' : '어떤 키워드로 글을 생성할까요?'}
            </div>
            <div className="modal-body">
              <div className="goto-kw-list">
                {keywords.map(kw => (
                  <button
                    key={kw.id}
                    type="button"
                    className="goto-kw-item"
                    onClick={() => goToPostCreateWithKeyword(kw.keyword)}
                  >
                    <span className="goto-kw-name">{kw.keyword}</span>
                    {kw.category && <span className="goto-kw-cat">{kw.category}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer goto-modal-footer">
              <select
                className="input goto-tone-select"
                value={gotoTone}
                onChange={e => setGotoTone(e.target.value)}
                title="글 톤 선택 — 선택한 키워드로 글 생성 시 이 톤이 적용됩니다"
              >
                {GOTO_TONE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost" onClick={() => setShowGotoModal(false)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
