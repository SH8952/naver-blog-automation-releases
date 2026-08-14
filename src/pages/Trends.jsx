import React, { useState, useEffect } from 'react';
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
  const applyResult = (res) => {
    const cats = res.searchInflow?.categories || [];
    const groups = res.genderAgeInflow?.groups || [];
    setPeriodLabel(res.periodLabel || '');
    setNaverId(res.naverId || '');
    setCategories(cats);
    setGenderAgeGroups(groups);
    setMainItems(res.mainInflow?.items || []);
    setMainPage(0);
    setSelectedCategory(cats[0]?.name || '');
    if (groups.length) {
      const first = parseGenderAgeName(groups[0].name);
      setSelectedGender(first.gender);
      setSelectedAge(first.age);
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
  const ageOptions    = Array.from(new Set(genderAgeParsed.map(g => g.age))).filter(Boolean);
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
                  <select
                    className="ca-select"
                    value={selectedCategory}
                    onChange={e => setSelectedCategory(e.target.value)}
                  >
                    {categories.map(cat => (
                      <option key={cat.name} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
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
                    <select
                      className="ca-select"
                      value={selectedGender}
                      onChange={e => setSelectedGender(e.target.value)}
                    >
                      {genderOptions.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <select
                      className="ca-select"
                      value={selectedAge}
                      onChange={e => setSelectedAge(e.target.value)}
                    >
                      {ageOptions.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
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
