import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Trends.css';

// 2026-08-14 신규: 네이버 블로그 관리자용 "크리에이터 어드바이저"
// (creator-advisor.naver.com) 트렌드 탭을 이 앱으로 가져오는 기능. 4개
// 탭 중 사용자가 확정한 "검색 유입 트렌드"·"메인 유입 트렌드" 두 항목만
// 우선 구현(주제별 비교/주제별 트렌드는 보류). 비공식 스크래핑이라
// 네이버 페이지 구조가 바뀌면 깨질 수 있음 — 사전에 사용자와 합의된
// 리스크. 최초 로그인 계정(가장 오래된 계정) 기준으로 고정.
// 2026-08-14 재설계: 검색 유입 트렌드를 "주제별"(왼쪽, 카테고리 드롭다운) +
// "성별,연령별"(오른쪽, 성별+연령대 드롭다운) 두 패널로 재구성(사용자 요청 —
// 카드를 다 늘어놓는 대신 드롭다운으로 하나씩 골라 보는 방식).

// "60세- 남자", "20대 여자"처럼 뒤에 성별이 붙은 그룹명을 연령대/성별로
// 분리 — 크리에이터 어드바이저가 실제로 어떤 연령 구간 문자열을 쓰는지
// 하드코딩하지 않고, 받아온 그룹명에서 그대로 파싱해 드롭다운을 만든다.
function parseGenderAgeName(name) {
  const m = /^(.*?)\s*(남자|여자)\s*$/.exec(name || '');
  if (m) return { age: m[1].trim(), gender: m[2] };
  return { age: (name || '').trim(), gender: '' };
}

// 2026-08-19 신규: "주제별"/"성별,연령별" 드롭다운을 네이티브 <select>에서
// 커스텀 드롭다운으로 교체. 원인 — Chromium은 select를 열 때 현재 선택된
// 옵션을 클릭 지점에 맞추려고 목록을 위로 밀어올리는데, 주제별 목록이
// 30개 안팎이라 랜덤 기본값([[keyword-intent-classify-2026-08-19]]와
// 무관, 같은 날 추가한 다른 수정 — 초기 선택값 랜덤화)이 목록 뒤쪽 항목일
// 때 드롭다운이 창 위로 넘쳐 보이는 버그가 사용자 리포트로 확인됨. 포털
// 기반 커스텀 드롭다운은 항상 버튼 바로 아래(top: 버튼 bottom+4)에 고정
// 렌더링되므로 선택된 항목 위치와 무관하게 항상 아래로 열림 — Settings.jsx
// 의 NaverCategoryPicker/ThumbDesignPicker와 동일한 포지셔닝 패턴 재사용.
// 2026-08-19 추가: 주제별 목록이 30개라 세로로 쭉 늘어놓으면 스크롤이
// 길어짐 — 사용자 요청으로 항목이 많을 때(임계값 초과 시)만 2열 그리드로
// 표시(15개씩 두 열). 성별/연령별처럼 항목이 적은 드롭다운은 지금처럼
// 세로 한 줄 그대로 유지.
const FILTER_MULTI_COL_THRESHOLD = 12;
const FILTER_MULTI_COL_WIDTH = 340;
const FILTER_SIDEBAR_MIN_LEFT = 216; // 사이드바 폭(200px)+여유 16px — Settings.jsx SIDEBAR_MIN_LEFT와 동일 값

function FilterDropdown({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 160 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const twoCol = options.length > FILTER_MULTI_COL_THRESHOLD;

  useEffect(() => {
    if (!open) return;
    const updateCoords = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      if (!twoCol) {
        setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
        return;
      }
      // 2열 그리드일 땐 버튼 폭보다 넓게(고정 340px) 펼치되, 카드 우측
      // 경계와 사이드바 영역을 넘지 않도록 ThumbDesignPicker와 동일하게
      // clamp.
      const cardEl = btnRef.current.closest('.card');
      const rightBoundary = cardEl
        ? cardEl.getBoundingClientRect().right - 8
        : window.innerWidth - 8;
      const maxAllowedWidth = Math.max(220, rightBoundary - FILTER_SIDEBAR_MIN_LEFT);
      const width = Math.min(Math.max(FILTER_MULTI_COL_WIDTH, r.width), maxAllowedWidth);
      let left = r.left;
      if (left + width > rightBoundary) left = rightBoundary - width;
      if (left < FILTER_SIDEBAR_MIN_LEFT) left = FILTER_SIDEBAR_MIN_LEFT;
      setCoords({ top: r.bottom + 4, left, width });
    };
    updateCoords();
    const handleOutside = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', updateCoords, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', updateCoords, true);
    };
  }, [open, twoCol]);

  // grid-auto-flow:column이 항목을 첫 열부터 위→아래로 채우게 하려면
  // 행 개수를 명시해야 함(안 그러면 가로로 먼저 채워짐) — 30개면
  // Math.ceil(30/2)=15행, 즉 "15개씩 두 열"이 정확히 맞아떨어짐.
  const gridRows = twoCol ? Math.ceil(options.length / 2) : null;

  const panel = open ? createPortal(
    <div
      className={`ca-filter-panel${twoCol ? ' ca-filter-panel-grid' : ''}`}
      ref={panelRef}
      style={{
        top: coords.top, left: coords.left, width: coords.width,
        ...(twoCol ? { gridTemplateRows: `repeat(${gridRows}, auto)` } : {}),
      }}
    >
      {options.map(opt => (
        <div
          key={opt}
          className={`ca-filter-panel-item${value === opt ? ' selected' : ''}`}
          onClick={() => { onChange(opt); setOpen(false); }}
        >{opt}</div>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div className="ca-filter-dropdown">
      <button type="button" ref={btnRef} className="ca-select ca-filter-btn" onClick={() => setOpen(o => !o)}>
        <span className="ca-filter-btn-label">{value || placeholder || '선택'}</span>
        <span className="ca-filter-btn-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {panel}
    </div>
  );
}

export default function Trends() {
  const [loading, setLoading]         = useState(false);
  const [loaded, setLoaded]           = useState(false);
  const [error, setError]             = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [naverId, setNaverId]         = useState('');
  const [categories, setCategories]   = useState([]);
  const [genderAgeGroups, setGenderAgeGroups] = useState([]);
  const [mainItems, setMainItems]     = useState([]);
  const [addedKeywords, setAddedKeywords] = useState({}); // { [keyword]: true }
  const [addingKeyword, setAddingKeyword] = useState('');

  // 좌측(주제별) 드롭다운 선택값
  const [selectedCategory, setSelectedCategory] = useState('');
  // 우측(성별,연령별) 드롭다운 선택값 — 성별/연령대 각각 별도 드롭다운
  const [selectedGender, setSelectedGender] = useState('');
  const [selectedAge, setSelectedAge]       = useState('');

  // 2026-08-14 신규(사용자 요청): 메인 유입 트렌드 1~20위를 한 번에 나열하지
  // 않고 5개씩 페이지 넘김으로 보기.
  const MAIN_PAGE_SIZE = 5;
  const [mainPage, setMainPage] = useState(0);

  // 조회 결과(res)를 화면 상태에 반영 — 실시간 조회/캐시 조회 양쪽에서 공유
  // 2026-08-19 수정(사용자 요청): 주제별/성별,연령별 드롭다운의 초기 선택값이
  // 항상 배열의 첫 번째 항목(주제별은 늘 "맛집")으로 고정돼 있어 매번 똑같이
  // 보이던 문제 — 인기 트렌드 화면에 진입/새로고침할 때마다 무작위 인덱스로
  // 뽑아 시작 카테고리・성별,연령대가 매번 달라지도록 변경.
  const applyResult = (res) => {
    const cats = res.searchInflow?.categories || [];
    const groups = res.genderAgeInflow?.groups || [];
    setPeriodLabel(res.periodLabel || '');
    setNaverId(res.naverId || '');
    setCategories(cats);
    setGenderAgeGroups(groups);
    setMainItems(res.mainInflow?.items || []);
    setMainPage(0);
    const randomCat = cats.length ? cats[Math.floor(Math.random() * cats.length)] : null;
    setSelectedCategory(randomCat?.name || '');
    if (groups.length) {
      const randomGroup = groups[Math.floor(Math.random() * groups.length)];
      const parsed = parseGenderAgeName(randomGroup.name);
      setSelectedGender(parsed.gender);
      setSelectedAge(parsed.age);
    } else {
      setSelectedGender('');
      setSelectedAge('');
    }
    setLoaded(true);
  };

  const handleLoad = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.electronAPI.trends.getCreatorAdvisor();
      if (res.success) {
        applyResult(res);
      } else {
        setError(res.error || '트렌드를 불러오지 못했습니다.');
      }
    } catch (e) {
      setError(e.message || '트렌드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 2026-08-14 신규(사용자 요청): 트렌드 페이지 진입 시 자동으로 불러오되,
  // 앱 시작 시 백그라운드로 미리 가져와 둔 캐시(trends:getCached)가 있으면
  // 그걸 먼저 써서 대기 없이 바로 보여주고, 캐시가 아직 없으면 기존처럼
  // 실시간 조회(handleLoad)로 폴백한다. eslint-disable 주석은 일부 Windows
  // 빌드에서 빌드를 막는 문제가 있었던 전례가 있어 의도적으로 넣지 않음.
  useEffect(() => {
    (async () => {
      try {
        const cached = await window.electronAPI.trends.getCached();
        if (cached && cached.success) {
          applyResult(cached);
          return;
        }
      } catch { /* 캐시 조회 실패는 무시하고 실시간 조회로 폴백 */ }
      handleLoad();
    })();
  }, []);

  // 2026-08-20 신규(개발자 전용, 사용자 요청): "+" 등록과 동시에 에버그린
  // 판별도 자동 실행 — Research.jsx의 handleAddTrendAsKeyword(트렌드 칩/
  // 인텐트 칩/연관 검색어 칩/키워드 분석표 "+ 등록")에는 이미 있던 동작인데,
  // 이 "인기 트렌드"(크리에이터 어드바이저) 페이지의 "+" 버튼은 완전히
  // 별도의 handleAddKeyword 함수를 써서 빠져 있었음(사용자가 실사용 중
  // 배지가 안 뜨는 것으로 발견). evergreen:analyze는 결과를 DB에 바로
  // 저장하므로, 여기서 배지 UI를 직접 그리지 않아도 이후 글감 수집
  // 화면의 "등록된 키워드" 목록에서 자동으로 배지가 나타난다.
  const isDevBuild = process.env.NODE_ENV === 'development';

  const handleAddKeyword = async (keyword, categoryName) => {
    if (addedKeywords[keyword] || addingKeyword) return;
    setAddingKeyword(keyword);
    try {
      const res = await window.electronAPI.research.addKeyword({
        keyword,
        category: categoryName || '',
        intervalHours: 24,
        dateFrom: null,
        dateTo: null,
      });
      if (res.success) {
        setAddedKeywords(prev => ({ ...prev, [keyword]: true }));
        if (isDevBuild) window.electronAPI.evergreen.analyze([keyword]);
      } else if (res.error && res.error.includes('이미 등록')) {
        // 이미 글감 수집에 있는 키워드 — 사용자 입장에서는 성공과 동일하게 보여줌
        setAddedKeywords(prev => ({ ...prev, [keyword]: true }));
      }
    } finally {
      setAddingKeyword('');
    }
  };

  const renderBadge = (item) => {
    if (item.direction === 'new') return <span className="ca-badge ca-new">NEW</span>;
    if (!item.rank || item.rank === '-') return <span className="ca-badge ca-flat">-</span>;
    if (item.direction === 'up')   return <span className="ca-badge ca-up">▲ {item.rank}</span>;
    if (item.direction === 'down') return <span className="ca-badge ca-down">▼ {item.rank}</span>;
    return <span className="ca-badge ca-flat">{item.rank}</span>;
  };

  const renderKwList = (items, groupLabel) => (
    <ul className="ca-kw-list">
      {items.map((it, i) => (
        <li key={i} className="ca-kw-item">
          <span className="ca-kw-text" title={it.keyword}>{it.keyword}</span>
          {renderBadge(it)}
          <button
            className="ca-add-btn"
            disabled={!!addedKeywords[it.keyword] || addingKeyword === it.keyword}
            onClick={() => handleAddKeyword(it.keyword, groupLabel)}
            title="이 키워드를 글감 수집에 등록"
          >
            {addedKeywords[it.keyword] ? '✓' : addingKeyword === it.keyword ? '…' : '+'}
          </button>
        </li>
      ))}
    </ul>
  );

  const mainTotalPages = Math.max(1, Math.ceil(mainItems.length / MAIN_PAGE_SIZE));
  const mainPageItems  = mainItems.slice(mainPage * MAIN_PAGE_SIZE, mainPage * MAIN_PAGE_SIZE + MAIN_PAGE_SIZE);

  const selectedCategoryData = categories.find(c => c.name === selectedCategory) || null;

  const genderAgeParsed = genderAgeGroups.map(g => ({ ...g, ...parseGenderAgeName(g.name) }));
  const genderOptions = Array.from(new Set(genderAgeParsed.map(g => g.gender))).filter(Boolean);
  // 2026-08-20 수정(사용자 리포트): 연령대 드롭다운이 크리에이터 어드바이저
  // API가 준 순서를 그대로 써서(정렬 로직 없음) 뒤죽박죽으로 보이던 버그.
  // "30-34세"/"60세-"/"0-12세"처럼 형식이 제각각이라 문자열 정렬로는
  // 안 되고, 앞쪽 숫자만 뽑아 오름차순 정렬해야 함 — "60세-"처럼 끝이
  // 열린 항목은 가장 큰 값으로 취급해 맨 뒤로 보냄.
  const ageOptions = Array.from(new Set(genderAgeParsed.map(g => g.age)))
    .filter(Boolean)
    .sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      const openEndedA = /-\s*$/.test(a); // "60세-"처럼 끝이 "-"로 열린 형태
      const openEndedB = /-\s*$/.test(b);
      const valA = Number.isNaN(numA) ? Infinity : (openEndedA ? numA + 1000 : numA);
      const valB = Number.isNaN(numB) ? Infinity : (openEndedB ? numB + 1000 : numB);
      return valA - valB;
    });
  const selectedGroup = genderAgeParsed.find(g => g.gender === selectedGender && g.age === selectedAge) || null;

  return (
    <div className="trends-page">
      <div className="page-header">
        <div>
          <h1>인기 트렌드</h1>
          <p>
            네이버 블로그 관리자용 크리에이터 어드바이저 데이터를 가져옵니다
            {naverId ? ` — ${naverId} 계정 기준` : ''}
            {periodLabel ? ` · ${periodLabel}` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleLoad} disabled={loading}>
          {loading
            ? <><span className="spinner-sm" /> 불러오는 중…(최대 1~2분)</>
            : loaded ? '🔄 새로고침' : '📊 트렌드 불러오기'}
        </button>
      </div>

      {error && <div className="ca-error">{error}</div>}

      {!loaded && !loading && !error && (
        <div className="empty-state">
          잠시 후 트렌드를 자동으로 불러옵니다. 안 뜨면 새로고침 버튼을 눌러주세요.
        </div>
      )}

      {loaded && !loading && !error && categories.length === 0 && genderAgeGroups.length === 0 && mainItems.length === 0 && (
        <div className="empty-state">
          데이터를 가져왔지만 항목이 없습니다. 잠시 후 새로고침을 눌러주세요.
        </div>
      )}

      {loaded && (categories.length > 0 || genderAgeGroups.length > 0) && (
        <div className="card ca-section">
          <div className="ca-section-title">검색 유입 트렌드</div>
          <div className="ca-section-sub">주제 또는 성별·연령대를 선택하면 최근 유입이 많았던 검색 키워드가 보입니다</div>
          <div className="ca-dual-panel">
            <div className="ca-panel-col">
              <div className="ca-panel-controls">
                <div className="ca-panel-label">주제별</div>
                {categories.length > 0 && (
                  <FilterDropdown
                    value={selectedCategory}
                    options={categories.map(cat => cat.name)}
                    onChange={setSelectedCategory}
                  />
                )}
              </div>
              <div className="ca-panel">
                {categories.length > 0 ? (
                  selectedCategoryData
                    ? renderKwList(selectedCategoryData.items, selectedCategoryData.name)
                    : <div className="ca-panel-empty">카테고리를 선택해주세요.</div>
                ) : (
                  <div className="ca-panel-empty">데이터가 없습니다.</div>
                )}
              </div>
            </div>

            <div className="ca-panel-col">
              <div className="ca-panel-controls">
                <div className="ca-panel-label">성별·연령별</div>
                {genderAgeGroups.length > 0 && (
                  <div className="ca-select-row">
                    <FilterDropdown
                      value={selectedGender}
                      options={genderOptions}
                      onChange={setSelectedGender}
                    />
                    <FilterDropdown
                      value={selectedAge}
                      options={ageOptions}
                      onChange={setSelectedAge}
                    />
                  </div>
                )}
              </div>
              <div className="ca-panel">
                {genderAgeGroups.length > 0 ? (
                  selectedGroup
                    ? renderKwList(selectedGroup.items, selectedGroup.name)
                    : <div className="ca-panel-empty">성별·연령대를 선택해주세요.</div>
                ) : (
                  <div className="ca-panel-empty">데이터가 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {loaded && mainItems.length > 0 && (
        <div className="card ca-section">
          <div className="ca-section-title">메인 유입 트렌드</div>
          <div className="ca-section-sub">네이버 메인에서 많이 유입된 블로그 게시글 순위</div>
          <ul className="ca-main-list">
            {mainPageItems.map((it, i) => (
              <li key={i} className="ca-main-item">
                <span className="ca-main-rank">{it.rank || (mainPage * MAIN_PAGE_SIZE + i + 1)}</span>
                {it.url ? (
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="ca-main-title">
                    {it.title}
                  </a>
                ) : (
                  <span className="ca-main-title">{it.title}</span>
                )}
              </li>
            ))}
          </ul>
          {mainTotalPages > 1 && (
            <div className="ca-pagination">
              <button
                className="ca-page-btn"
                onClick={() => setMainPage(p => Math.max(0, p - 1))}
                disabled={mainPage === 0}
              >‹</button>
              {Array.from({ length: mainTotalPages }, (_, i) => (
                <button
                  key={i}
                  className={`ca-page-btn${i === mainPage ? ' active' : ''}`}
                  onClick={() => setMainPage(i)}
                >{i + 1}</button>
              ))}
              <button
                className="ca-page-btn"
                onClick={() => setMainPage(p => Math.min(mainTotalPages - 1, p + 1))}
                disabled={mainPage === mainTotalPages - 1}
              >›</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
