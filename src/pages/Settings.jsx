import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Settings.css';

// ── 기본값 ────────────────────────────────────────────────────
const DEFAULTS = {
  geminiKey: '', groqKey: '', openaiKey: '', claudeKey: '', unsplashKey: '',
  naverApiId: '', naverApiSecret: '',
  searchAdCustomerId: '', searchAdApiKey: '', searchAdSecretKey: '',
  licenseKey: '',
  customThumbnail: true, thumbnailStyle: -1,
  postStyle: -1,
  editorFont: '바른히피',
  aiProvider: 'gemini',
  geminiModel: 'gemini-3.1-flash-lite',
  groqModel: 'meta-llama/llama-4-maverick-17b-128e-instruct',
  openaiModel: 'gpt-4o',
  claudeModel: 'claude-sonnet-4-6',
  sentenceStyle: 'auto', writingStyle: 'auto', personalExp: 'auto', tone: 'info',
  maxDailyPosts: 3, intervalMin: 30, intervalMax: 120, similarityThreshold: 70,
};

// ── 자동화 루프 기본값 (2026-07-05 신규) ─────────────────────
const LOOP_DEFAULTS = {
  accountMode: 'single',
  singleAccountId: null,
  cycleMode: 'count',
  cycleCount: 3,
  cycleDurationHours: 4,
  keywordExhaustion: 'refill',
  pcShutdownOnExhaustion: false,
};

// ── 네이버 블로그 공식 카테고리 전체 목록 (2026-07-06 신규) ─────
// 자동화 루프가 계정별로 실제 발행할 네이버 블로그 카테고리를 미리
// 지정해둘 수 있도록, 그 계정의 블로그에 아직 만들어져 있지 않은
// 카테고리라도 선택할 수 있게 네이버가 제공하는 공식 분류 전체를
// 그대로 준비해둔다(사용자가 어떤 주제로 블로그를 운영할지 미리
// 알 수 없기 때문). 실제로는 해당 네이버 블로그에 같은 이름의
// 카테고리가 미리 만들어져 있어야 발행 시 정상 매칭된다.
const NAVER_CATEGORY_GROUPS = [
  { group: '엔터테인먼트·예술', items: ['문학·책', '영화', '미술·디자인', '공연·전시', '음악', '드라마', '스타·연예인', '만화·애니', '방송'] },
  { group: '생활·노하우·쇼핑', items: ['일상·생각', '육아·결혼', '반려동물', '좋은글·이미지', '패션·미용', '인테리어·DIY', '요리·레시피', '상품리뷰', '원예·재배'] },
  { group: '취미·여가·여행', items: ['게임', '스포츠', '사진', '자동차', '취미', '국내여행', '세계여행', '맛집'] },
  { group: '지식·동향', items: ['IT·컴퓨터', '사회·정치', '건강·의학', '비즈니스·경제', '어학·외국어', '교육·학문'] },
];

// ── 네이버 카테고리 커스텀 드롭다운 (2026-07-06 신규) ────────────
// 네이티브 <select><optgroup>은 항상 세로 목록으로만 렌더링되어
// 네이버 실제 화면처럼 큰 타이틀 기준 가로 배치를 만들 수 없어서,
// 버튼 + 커스텀 패널(라디오 버튼 없이 클릭 가능한 항목) 방식으로
// 직접 구현한다. 패널은 document.body에 포털로 렌더링해 리스트의
// overflow:auto에 잘리지 않도록 함.
// 패널 고정 너비(내용에 맞춰 좌우 여백이 동일하도록 딱 맞춘 값) — 버튼
// 폭과 무관하게 항상 이 크기로 고정. 사이드바(--sidebar-width, 200px)
// 영역은 절대 침범하지 않도록 좌측 위치를 이 값 기준으로 clamp함.
const NAVER_CAT_PANEL_WIDTH = 560; // 2026-07-06: 컬럼별 가로폭이 너무 넓다는 피드백으로 700→560 축소
const SIDEBAR_MIN_LEFT = 216; // 사이드바 너비(200px) + 여유 16px

// 2026-07-06 신규: 계정당 다중 배정/네이버 카테고리 쌍(+추가/-삭제) 기능을
// 파일럿으로 노출할 계정 목록. skysmoga로 시작해 skysmogs66도 함께 확인
// 요청받아 추가함 — 다른 계정은 기존 단일 쌍 UI 그대로 유지.
const PILOT_NAVER_IDS = ['skysmoga', 'skysmogs66'];

function NaverCategoryPicker({ value, realNameMap, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: NAVER_CAT_PANEL_WIDTH });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // 2026-07-06: 패널을 고정폭(NAVER_CAT_PANEL_WIDTH)으로 두고, 버튼
  // 위치를 기준으로 좌측 좌표만 계산한다. (1) 오른쪽 경계 — 창 전체가
  // 아니라 버튼을 감싸는 카드(.card)의 우측 테두리를 넘지 않도록(카드
  // 밖으로 살짝 삐져나오는 문제 수정), (2) 왼쪽으로는 사이드바
  // (SIDEBAR_MIN_LEFT) 영역을 침범하지 않도록 항상 clamp.
  useEffect(() => {
    if (!open) return;
    const updateCoords = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      const cardEl = btnRef.current.closest('.card');
      const rightBoundary = cardEl
        ? cardEl.getBoundingClientRect().right - 8
        : window.innerWidth - 8;
      const maxAllowedWidth = Math.max(200, rightBoundary - SIDEBAR_MIN_LEFT);
      const width = Math.min(NAVER_CAT_PANEL_WIDTH, maxAllowedWidth);
      let left = r.left;
      // 오른쪽 경계(카드 우측 테두리)를 넘으면 그 안쪽에 맞춰 왼쪽으로 당김
      if (left + width > rightBoundary) {
        left = rightBoundary - width;
      }
      // 사이드바 영역 침범 방지
      if (left < SIDEBAR_MIN_LEFT) {
        left = SIDEBAR_MIN_LEFT;
      }
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
  }, [open]);

  const realName = value ? realNameMap[value] : null;
  const displayLabel = value ? (realName ? `${value} - ${realName}` : value) : (placeholder || '지정 안 함');

  const panel = open ? createPortal(
    <div className="naver-cat-panel" ref={panelRef} style={{
      top: coords.top,
      left: coords.left,
      width: coords.width,
    }}>
      <div
        className={`naver-cat-panel-clear${!value ? ' selected' : ''}`}
        onClick={() => { onChange(''); setOpen(false); }}
      >지정 안 함</div>
      <div className="naver-cat-panel-columns">
        {NAVER_CATEGORY_GROUPS.map(g => (
          <div key={g.group} className="naver-cat-panel-column">
            <div className="naver-cat-panel-title">{g.group}</div>
            {g.items.map(item => {
              const real = realNameMap[item];
              const isSelected = value === item;
              return (
                <div
                  key={item}
                  className={`naver-cat-panel-item${isSelected ? ' selected' : ''}`}
                  onClick={() => { onChange(item); setOpen(false); }}
                >
                  {item}{real ? <span className="naver-cat-panel-real"> - {real}</span> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="naver-cat-picker">
      <button type="button" ref={btnRef} className="naver-cat-picker-btn" onClick={() => setOpen(o => !o)}>
        <span className="naver-cat-picker-label">{displayLabel}</span>
        <span className="naver-cat-picker-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {panel}
    </div>
  );
}

// ── 아이콘 ────────────────────────────────────────────────────
const EyeIcon = ({ open }) => open ? (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function Settings() {
  const [activeTab, setActiveTab] = useState('api');
  const [form, setForm] = useState(DEFAULTS);
  const [showGemini, setShowGemini]         = useState(false);
  const [showGroq, setShowGroq]             = useState(false);
  const [showOpenai, setShowOpenai]         = useState(false);
  const [showClaude, setShowClaude]         = useState(false);
  const [showUnsplash, setShowUnsplash]     = useState(false);
  const [showNaverSecret, setShowNaverSecret]   = useState(false);
  const [showAdApiKey, setShowAdApiKey]         = useState(false);
  const [showAdSecretKey, setShowAdSecretKey]   = useState(false);
  const [searchAdStatus, setSearchAdStatus]     = useState(null);
  const [geminiStatus, setGeminiStatus]     = useState(null);
  const [groqStatus, setGroqStatus]         = useState(null);
  const [openaiStatus, setOpenaiStatus]     = useState(null);
  const [claudeStatus, setClaudeStatus]     = useState(null);
  const [unsplashStatus, setUnsplashStatus] = useState(null);
  const [naverApiStatus, setNaverApiStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // 오류 로그
  const [logContent, setLogContent]   = useState('');
  const [logPath, setLogPath]         = useState('');
  const [logVisible, setLogVisible]   = useState(false);
  const [logClearing, setLogClearing] = useState(false);
  const [logCopyToast, setLogCopyToast] = useState(false);
  // 2026-07-13 신규: 배포 버전은 사이드바 개발자 전용 초기화 버튼이 숨겨져
  // 있어 데이터를 초기화할 방법이 없다는 요청으로, 시스템 탭에 전체 초기화를
  // 노출. 로그 초기화(handleClearLog)와는 별개 — 계정 제외 전체 데이터(발행
  // 이력/예약/검수 대기 등, dev:reset과 동일 범위) 초기화.
  const [fullResetting, setFullResetting] = useState(false);

  // 자동화 루프 전용 로그 (2026-07-05 신규)
  const [loopLogContent, setLoopLogContent]   = useState('');
  const [loopLogPath, setLoopLogPath]         = useState('');
  const [loopLogVisible, setLoopLogVisible]   = useState(false);
  const [loopLogClearing, setLoopLogClearing] = useState(false);
  const [loopLogCopyToast, setLoopLogCopyToast] = useState(false);

  // 라이선스 (2026-07-04 신규)
  const [licenseStatus, setLicenseStatus] = useState(null); // { hasKey, valid, expired, tier, maxDevices, expiresAt, daysRemaining, licenseId }
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [licenseMsg, setLicenseMsg]       = useState(null); // { type: 'ok'|'error', text }

  // 자동화 루프 (2026-07-05 신규)
  const [loopForm, setLoopForm]     = useState(LOOP_DEFAULTS);
  const [loopAccounts, setLoopAccounts] = useState([]); // 계정 목록 (id, nickname, naver_id, loop_enabled, loop_category)

  // 계정별 카테고리 배정 (2026-07-05 신규, Method 2)
  const [loopCategories, setLoopCategories] = useState([]); // 등록된 키워드의 카테고리 목록(중복제거)

  // 2026-07-06 신규: 계정별 "실제 카테고리 불러오기" 진행 상태
  const [catTopicLoading, setCatTopicLoading] = useState({}); // { [accountId]: boolean }
  const [catTopicMsg, setCatTopicMsg] = useState({}); // { [accountId]: string } — 결과 메시지(토스트, 3초 후 자동 소멸)
  const [catTopicMap, setCatTopicMap] = useState({}); // { [accountId]: { 표준주제분류: 실제카테고리명 } }

  // 2026-07-06 신규: 다계정 순차 발행 모드 — 계정별로 흩어져 있던
  // "실제 카테고리" 버튼을 헤더의 버튼 하나로 통합. 루프에 포함된
  // (체크된) 계정만 순서대로 처리(사용자 확인: 발행 대상만 불러오는
  // 것이 효율적).
  const [multiCatTopicLoading, setMultiCatTopicLoading] = useState(false);
  const [multiCatTopicProgress, setMultiCatTopicProgress] = useState('');

  // 2026-07-06 신규: "계정 모두 보기" — 해제 시 체크(포함)된 계정만
  // 목록에 표시해 공간을 줄임(화면 표시 전용 필터, loop_enabled 값 자체나
  // 자동화 실행 대상에는 영향 없음 — 그건 이미 loop_enabled로 별도 제어됨).
  // 기본값은 사용자 요청에 따라 꺼짐(해제) 상태로 시작.
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  // 2026-07-06 신규: 계정별 추가 배정/네이버 카테고리 쌍 (파일럿 — 지금은
  // skysmoga 계정에서만 UI로 추가/삭제 가능. 최대 4개 추가(기본 1 + 최대
  // 5쌍), 자동화 루프는 이 쌍들을 라운드로빈으로 순회한다(main.js 처리).
  const [categoryPairs, setCategoryPairs] = useState({}); // { [accountId]: [{id, loop_category, naver_category}] }
  const [pairActionMsg, setPairActionMsg] = useState({}); // { [accountId]: string } — 최대개수 초과 등 오류 토스트

  const loadCategoryPairsForAccount = async (accountId) => {
    const res = await window.electronAPI.account.getCategoryPairs(accountId);
    if (res.success) setCategoryPairs(prev => ({ ...prev, [accountId]: res.pairs || [] }));
  };

  const handleAddCategoryPair = async (accountId) => {
    const res = await window.electronAPI.account.addCategoryPair(accountId);
    if (res.success) {
      loadCategoryPairsForAccount(accountId);
    } else {
      setPairActionMsg(prev => ({ ...prev, [accountId]: res.error || '추가 실패' }));
      setTimeout(() => setPairActionMsg(prev => ({ ...prev, [accountId]: '' })), 3000);
    }
  };

  const handleRemoveCategoryPair = async (accountId, pairId) => {
    await window.electronAPI.account.removeCategoryPair(pairId);
    loadCategoryPairsForAccount(accountId);
  };

  const handleSetPairCategory = async (accountId, pairId, category) => {
    setCategoryPairs(prev => ({
      ...prev,
      [accountId]: (prev[accountId] || []).map(p => p.id === pairId ? { ...p, loop_category: category } : p),
    }));
    await window.electronAPI.account.setCategoryPairCategory(pairId, category);
  };

  const handleSelectStandardCategoryForPair = async (accountId, pairId, standardName) => {
    const map = catTopicMap[accountId] || {};
    const realName = standardName ? (map[standardName] || standardName) : '';
    setCategoryPairs(prev => ({
      ...prev,
      [accountId]: (prev[accountId] || []).map(p => p.id === pairId ? { ...p, naver_category: realName } : p),
    }));
    await window.electronAPI.account.setCategoryPairNaverCategory(pairId, realName);
  };

  // 표준 주제분류 select에 표시할 값을 계산: 저장된 naver_category(실제
  // 카테고리명)가 매핑표의 어느 표준 항목과 일치하는지 역추적. 매핑표가
  // 아직 없거나 일치하는 게 없으면 저장된 값을 그대로 사용(과거에 표준
  // 명칭 그대로 저장된 경우와의 호환).
  const getNaverCategorySelectValue = (accountId, storedValue) => {
    if (!storedValue) return '';
    const map = catTopicMap[accountId] || {};
    const standardKey = Object.keys(map).find(k => map[k] === storedValue);
    return standardKey || storedValue;
  };

  // 2026-07-06 신규: 1계정 발행 모드에서 선택된 계정 — "발행 계정 선택"
  // 타이틀 옆에 "실제 카테고리 불러오기" 버튼을 배치하려면 헤더 영역과
  // 본문 영역 양쪽에서 같은 계정 정보가 필요해서 공용 변수로 계산해둠.
  const singleAcc = (loopForm.accountMode === 'single' && loopForm.singleAccountId != null)
    ? loopAccounts.find(a => a.id === loopForm.singleAccountId)
    : null;

  const loadLoopAccounts = () => {
    window.electronAPI.account.getAll().then(res => {
      if (res.success) {
        setLoopAccounts(res.accounts || []);
        // 2026-07-06: 파일럿 계정들(PILOT_NAVER_IDS)의 추가 카테고리 쌍을 함께 로드
        (res.accounts || []).filter(a => PILOT_NAVER_IDS.includes(a.naver_id))
          .forEach(a => loadCategoryPairsForAccount(a.id));
      }
    });
  };

  const loadLoopCategories = () => {
    window.electronAPI.research.getCategories().then(res => {
      if (res.success) setLoopCategories(res.categories || []);
    });
  };

  const handleSetAccountCategory = async (accountId, category) => {
    setLoopAccounts(prev => prev.map(a => a.id === accountId ? { ...a, loop_category: category } : a));
    await window.electronAPI.account.setLoopCategory(accountId, category);
  };

  // 2026-07-06: 계정별 네이버 블로그 발행 카테고리 (loop_category와 별개)
  const handleSetAccountNaverCategory = async (accountId, category) => {
    setLoopAccounts(prev => prev.map(a => a.id === accountId ? { ...a, naver_category: category } : a));
    await window.electronAPI.account.setNaverCategory(accountId, category);
  };

  // 2026-07-06: 계정의 실제 블로그 카테고리 ↔ 주제분류 매칭표를 불러와
  // catTopicMap에 저장. 32개 표준 카테고리 옆에 실제 카테고리명을
  // 노출하고, 선택 시 실제 카테고리명을 naver_category로 저장하는 데 사용.
  const handleFetchCategoryTopics = async (accountId) => {
    setCatTopicLoading(prev => ({ ...prev, [accountId]: true }));
    const res = await window.electronAPI.blog.getCategoryTopics(accountId);
    setCatTopicLoading(prev => ({ ...prev, [accountId]: false }));
    let msg;
    if (res.success) {
      setCatTopicMap(prev => ({ ...prev, [accountId]: res.mapping || {} }));
      const count = Object.keys(res.mapping || {}).length;
      msg = count > 0 ? `실제 카테고리 ${count}개 매칭 완료` : '주제분류가 설정된 카테고리가 없습니다';
    } else {
      msg = `불러오기 실패 — ${res.error || '오류 로그(CATTOPIC) 확인'}`;
    }
    setCatTopicMsg(prev => ({ ...prev, [accountId]: msg }));
    setTimeout(() => {
      setCatTopicMsg(prev => ({ ...prev, [accountId]: '' }));
    }, 3000);
  };

  // 2026-07-06 신규: 다계정 순차 발행 헤더의 통합 버튼 — 루프에 포함된
  // (체크된, loop_enabled=true) 계정만 대상으로 handleFetchCategoryTopics를
  // 순서대로(동시 아님) 호출. 계정마다 카테고리 수에 따라 수십 초씩 걸릴
  // 수 있어 진행 상황(n/총)을 표시.
  const handleFetchCategoryTopicsForIncluded = async () => {
    const targets = loopAccounts.filter(a => a.loop_enabled);
    if (targets.length === 0) {
      setMultiCatTopicProgress('포함된(체크된) 계정이 없습니다');
      setTimeout(() => setMultiCatTopicProgress(''), 3000);
      return;
    }
    setMultiCatTopicLoading(true);
    for (let i = 0; i < targets.length; i++) {
      const acc = targets[i];
      setMultiCatTopicProgress(`(${i + 1}/${targets.length}) ${acc.nickname || acc.naver_id} 처리 중…`);
      await handleFetchCategoryTopics(acc.id);
    }
    setMultiCatTopicLoading(false);
    setMultiCatTopicProgress(`완료 — 총 ${targets.length}개 계정 처리됨`);
    setTimeout(() => setMultiCatTopicProgress(''), 4000);
  };

  // 표준 주제분류를 선택했을 때, 그 계정의 실제 카테고리명이 매칭되어
  // 있으면 실제 카테고리명을 저장하고(사용자 확인 완료: "실제 계정
  // 카테고리명 저장"), 매칭이 없으면 표준 명칭 그대로 저장한다(해당
  // 이름의 카테고리가 그 블로그에 미리 만들어져 있어야 발행 시 매칭됨).
  const handleSelectStandardCategory = (accountId, standardName) => {
    if (!standardName) { handleSetAccountNaverCategory(accountId, ''); return; }
    const map = catTopicMap[accountId] || {};
    const realName = map[standardName];
    handleSetAccountNaverCategory(accountId, realName || standardName);
  };

  useEffect(() => {
    window.electronAPI.settings.get().then(res => {
      if (res.success) setForm({ ...DEFAULTS, ...res.settings });
    });
    window.electronAPI.license.get().then(res => {
      if (res.success) setLicenseStatus(res.status);
    });
    window.electronAPI.automationLoop.getSettings().then(res => {
      if (res.success) setLoopForm({ ...LOOP_DEFAULTS, ...res.settings });
    });
    loadLoopAccounts();
    loadLoopCategories();
  }, []);

  const setLoop = (key, value) => {
    setLoopForm(prev => ({ ...prev, [key]: value }));
    // 2026-07-05: 자동화 루프 전용 저장 버튼을 없애고 우측 상단 "설정 저장"
    // 버튼으로 통합하면서, loopForm 변경 시에도 그 버튼의 저장됨 표시(saved)를
    // 무효화해야 "저장 안 된 변경사항이 있다"는 걸 정확히 알 수 있음.
    setSaved(false);
  };

  const handleToggleLoopAccount = async (accountId, enabled) => {
    setLoopAccounts(prev => prev.map(a => a.id === accountId ? { ...a, loop_enabled: enabled ? 1 : 0 } : a));
    await window.electronAPI.account.setLoopEnabled(accountId, enabled);
  };

  const set = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await window.electronAPI.settings.set(form);
    // 2026-07-05: 자동화 루프 탭 하단에 따로 있던 "자동화 루프 설정 저장"
    // 버튼을 없애고 이 버튼으로 통합 — 우측 상단 버튼만 눌러도 일반 설정과
    // 자동화 루프 설정이 함께 저장되도록 함(따로 저장 안 해서 자동화 루프
    // 변경사항이 누락되는 오해 방지).
    const loopRes = await window.electronAPI.automationLoop.setSettings(loopForm);
    if (loopRes.success) setLoopForm(loopRes.settings);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // 2026-07-13 신규: 계정을 제외한 전체 데이터 초기화 — Sidebar.jsx의
  // 개발자 전용 handleDevReset과 동일한 IPC(dev:reset)를 사용. 배포
  // 버전에서는 그 버튼이 숨겨져 있어 여기(시스템 탭)에서 노출.
  const handleFullReset = async () => {
    if (!window.confirm('계정을 제외한 모든 데이터(발행 이력, 예약 등)를 초기화합니다.\n계속하시겠습니까?')) return;
    setFullResetting(true);
    await window.electronAPI.dev.reset();
    window.location.reload();
  };

  const handleShowLog = async () => {
    const res = await window.electronAPI.app.readLog();
    if (res.success) { setLogContent(res.content || '(로그 없음)'); setLogPath(res.path || ''); }
    else             { setLogContent(`로그 읽기 오류: ${res.error}`); }
    setLogVisible(true);
  };
  const handleClearLog = async () => {
    setLogClearing(true);
    await window.electronAPI.app.clearLog();
    setLogContent('(로그가 초기화되었습니다)');
    setLogClearing(false);
  };
  const handleOpenLog = () => window.electronAPI.app.openLog();

  // 자동화 루프 전용 로그 핸들러 (2026-07-05 신규)
  const handleShowLoopLog = async () => {
    const res = await window.electronAPI.app.readLoopLog();
    if (res.success) { setLoopLogContent(res.content || '(로그 없음)'); setLoopLogPath(res.path || ''); }
    else             { setLoopLogContent(`로그 읽기 오류: ${res.error}`); }
    setLoopLogVisible(true);
  };
  const handleClearLoopLog = async () => {
    setLoopLogClearing(true);
    await window.electronAPI.app.clearLoopLog();
    setLoopLogContent('(로그가 초기화되었습니다)');
    setLoopLogClearing(false);
  };
  const handleOpenLoopLog = () => window.electronAPI.app.openLoopLog();

  const handleApplyLicense = async () => {
    setLicenseSaving(true);
    setLicenseMsg(null);
    const res = await window.electronAPI.license.set(form.licenseKey);
    setLicenseSaving(false);
    if (res.success) {
      setLicenseStatus(res.status);
      if (!form.licenseKey.trim()) {
        setLicenseMsg({ type: 'ok', text: '라이선스가 해제되어 스탠다드로 동작합니다.' });
      } else if (res.status.expired) {
        setLicenseMsg({ type: 'error', text: '라이선스 기간이 만료되었습니다. 갱신이 필요합니다.' });
      } else {
        setLicenseMsg({ type: 'ok', text: '라이선스가 적용되었습니다.' });
      }
    } else {
      setLicenseMsg({ type: 'error', text: res.error || '라이선스 적용에 실패했습니다.' });
    }
  };

  const testGemini = async () => {
    setGeminiStatus('testing');
    const res = await window.electronAPI.settings.testGemini(form.geminiKey);
    setGeminiStatus(res.ok ? 'ok' : 'error');
  };
  const testGroq = async () => {
    setGroqStatus('testing');
    const res = await window.electronAPI.settings.testGroq(form.groqKey);
    setGroqStatus(res.ok ? 'ok' : 'error');
  };
  const testOpenai = async () => {
    setOpenaiStatus('testing');
    const res = await window.electronAPI.settings.testOpenai(form.openaiKey);
    setOpenaiStatus(res.ok ? 'ok' : 'error');
  };
  const testClaude = async () => {
    setClaudeStatus('testing');
    const res = await window.electronAPI.settings.testClaude(form.claudeKey);
    setClaudeStatus(res.ok ? 'ok' : 'error');
  };
  const testUnsplash = async () => {
    setUnsplashStatus('testing');
    const res = await window.electronAPI.settings.testUnsplash(form.unsplashKey);
    setUnsplashStatus(res.ok ? 'ok' : 'error');
  };
  const testNaverApi = async () => {
    setNaverApiStatus('testing');
    const res = await window.electronAPI.settings.testNaverApi(form.naverApiId, form.naverApiSecret);
    setNaverApiStatus(res.ok ? 'ok' : 'error');
  };
  const testSearchAd = async () => {
    setSearchAdStatus('testing');
    const res = await window.electronAPI.settings.testSearchAd(
      form.searchAdCustomerId, form.searchAdApiKey, form.searchAdSecretKey
    );
    setSearchAdStatus(res.ok ? 'ok' : 'error');
  };

  return (
    <div className={`settings${activeTab === 'loop' ? ' settings-loop-active' : ''}${activeTab === 'post' ? ' settings-post-active' : ''}${activeTab === 'api' ? ' settings-api-active' : ''}`}>
      <div className="page-header settings-header">
        <div>
          <h1>환경설정</h1>
          <p>API 키, AI 모델, 썸네일 설정을 관리합니다.</p>
        </div>
        <button
          className={`btn btn-primary${saved ? ' btn-saved' : ''}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중…' : saved ? '✓ 저장됨' : '설정 저장'}
        </button>
      </div>

      {/* ── 탭 버튼 ───────────────────────────────────────────── */}
      <div className="settings-tabs">
        <button className={`settings-tab${activeTab === 'api' ? ' active' : ''}`} onClick={() => setActiveTab('api')}>API 설정</button>
        <button className={`settings-tab${activeTab === 'post' ? ' active' : ''}`} onClick={() => setActiveTab('post')}>글 설정</button>
        <button className={`settings-tab${activeTab === 'loop' ? ' active' : ''}`} onClick={() => setActiveTab('loop')}>자동화 루프</button>
        <button className={`settings-tab${activeTab === 'system' ? ' active' : ''}`} onClick={() => setActiveTab('system')}>시스템</button>
      </div>

      {/* ── API 설정 ──────────────────────────────────────────── */}
      {/* 2026-07-08: 다른 탭(글 설정/자동화 루프)과 동일하게 카드 자체
          overflow가 아니라 페이지 바깥쪽 .main-inner가 스크롤을 담당하도록
          통일 — Windows에서 카드별 개별 스크롤이 다른 탭과 다르게 보이던
          문제 수정. */}
      {activeTab === 'api' && <div className="settings-tab-content api-tab-scroll">
      <div className="card settings-section">

        {/* 제공자 탭 */}
        <div className="form-group">
          <label>AI 제공자</label>
          <div className="provider-tabs">
            <button className={`provider-tab${form.aiProvider === 'claude' ? ' active' : ''}`} onClick={() => set('aiProvider', 'claude')}>
              <span className="provider-tab-name">Claude</span>
              <span className="provider-tab-hint">유료 (최고품질)</span>
            </button>
            <button className={`provider-tab${form.aiProvider === 'gemini' ? ' active' : ''}`} onClick={() => set('aiProvider', 'gemini')}>
              <span className="provider-tab-name">Gemini</span>
              <span className="provider-tab-hint">무료 1,500/일</span>
            </button>
            <button className={`provider-tab${form.aiProvider === 'openai' ? ' active' : ''}`} onClick={() => set('aiProvider', 'openai')}>
              <span className="provider-tab-name">OpenAI</span>
              <span className="provider-tab-hint">유료 (고품질)</span>
            </button>
            <button className={`provider-tab${form.aiProvider === 'groq' ? ' active' : ''}`} onClick={() => set('aiProvider', 'groq')}>
              <span className="provider-tab-name">Groq</span>
              <span className="provider-tab-hint">무료 최대 14,400/일</span>
            </button>
          </div>
        </div>

        {/* ── Gemini ── */}
        {form.aiProvider === 'gemini' && (<>
          <div className="form-group">
            <label>Gemini API 키
              <a className="label-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer"> 발급 →</a>
            </label>
            <div className="api-key-row">
              <div className="input-with-toggle">
                <input className="input" type={showGemini ? 'text' : 'password'} placeholder="AIzaSy…"
                  value={form.geminiKey}
                  onChange={e => { set('geminiKey', e.target.value); setGeminiStatus(null); }} />
                <button className="toggle-eye" onClick={() => setShowGemini(v => !v)}><EyeIcon open={showGemini} /></button>
              </div>
              <button className="btn btn-ghost" onClick={testGemini} disabled={!form.geminiKey || geminiStatus === 'testing'}>
                {geminiStatus === 'testing' ? '확인 중…' : '테스트'}
              </button>
              {geminiStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
              {geminiStatus === 'error' && <span className="api-status error">✗ 오류</span>}
            </div>
          </div>
          <div className="form-group">
            <label>Gemini 모델</label>
            <select className="input" value={form.geminiModel} onChange={e => set('geminiModel', e.target.value)}>
              <option value="gemini-3.5-flash">Gemini 3.5 Flash — 최신 고품질 (무료)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite — 절약·빠름 (무료)</option>
              <option value="gemini-3.1-flash">Gemini 3.1 Flash — 균형 (무료)</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash — 구버전 (유료 전환)</option>
            </select>
          </div>
        </>)}

        {/* ── Groq ── */}
        {form.aiProvider === 'groq' && (<>
          <div className="form-group">
            <label>Groq API 키
              <a className="label-link" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">발급 →</a>
            </label>
            <div className="api-key-row">
              <div className="input-with-toggle">
                <input className="input" type={showGroq ? 'text' : 'password'} placeholder="gsk_…"
                  value={form.groqKey}
                  onChange={e => { set('groqKey', e.target.value); setGroqStatus(null); }} />
                <button className="toggle-eye" onClick={() => setShowGroq(v => !v)}><EyeIcon open={showGroq} /></button>
              </div>
              <button className="btn btn-ghost" onClick={testGroq} disabled={!form.groqKey || groqStatus === 'testing'}>
                {groqStatus === 'testing' ? '확인 중…' : '테스트'}
              </button>
              {groqStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
              {groqStatus === 'error' && <span className="api-status error">✗ 오류</span>}
            </div>
          </div>
          <div className="form-group">
            <label>Groq 모델</label>
            <select className="input" value={form.groqModel} onChange={e => set('groqModel', e.target.value)}>
              <option value="meta-llama/llama-4-maverick-17b-128e-instruct">Llama 4 Maverick 17B — 최신 최고품질</option>
              <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B — 최신 균형 (빠름)</option>
              <option value="llama-3.3-70b-versatile">Llama 3.3 70B — 안정적 고품질 (1,000 RPD)</option>
              <option value="llama-3.1-70b-versatile">Llama 3.1 70B — 구버전</option>
            </select>
          </div>
        </>)}

        {/* ── OpenAI ── */}
        {form.aiProvider === 'openai' && (<>
          <div className="form-group">
            <label>OpenAI API 키
              <a className="label-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">발급 →</a>
            </label>
            <div className="api-key-row">
              <div className="input-with-toggle">
                <input className="input" type={showOpenai ? 'text' : 'password'} placeholder="sk-…"
                  value={form.openaiKey}
                  onChange={e => { set('openaiKey', e.target.value); setOpenaiStatus(null); }} />
                <button className="toggle-eye" onClick={() => setShowOpenai(v => !v)}><EyeIcon open={showOpenai} /></button>
              </div>
              <button className="btn btn-ghost" onClick={testOpenai} disabled={!form.openaiKey || openaiStatus === 'testing'}>
                {openaiStatus === 'testing' ? '확인 중…' : '테스트'}
              </button>
              {openaiStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
              {openaiStatus === 'error' && <span className="api-status error">✗ 오류</span>}
            </div>
            <p style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'5px'}}>
              유료 서비스입니다. platform.openai.com에서 크레딧 충전 후 사용하세요.
            </p>
          </div>
          <div className="form-group">
            <label>OpenAI 모델</label>
            <select className="input" value={form.openaiModel} onChange={e => set('openaiModel', e.target.value)}>
              <option value="gpt-4o">GPT-4o — 최신 고품질 (한국어 우수)</option>
              <option value="gpt-4o-mini">GPT-4o Mini — 빠름·저렴</option>
              <option value="gpt-4-turbo">GPT-4 Turbo — 구버전 고품질</option>
            </select>
          </div>
        </>)}

        {/* ── Claude ── */}
        {form.aiProvider === 'claude' && (<>
          <div className="form-group">
            <label>Claude API 키 (Anthropic)
              <a className="label-link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">발급 →</a>
            </label>
            <div className="api-key-row">
              <div className="input-with-toggle">
                <input className="input" type={showClaude ? 'text' : 'password'} placeholder="sk-ant-…"
                  value={form.claudeKey}
                  onChange={e => { set('claudeKey', e.target.value); setClaudeStatus(null); }} />
                <button className="toggle-eye" onClick={() => setShowClaude(v => !v)}><EyeIcon open={showClaude} /></button>
              </div>
              <button className="btn btn-ghost" onClick={testClaude} disabled={!form.claudeKey || claudeStatus === 'testing'}>
                {claudeStatus === 'testing' ? '확인 중…' : '테스트'}
              </button>
              {claudeStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
              {claudeStatus === 'error' && <span className="api-status error">✗ 오류</span>}
            </div>
            <p style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'5px'}}>
              유료 서비스입니다. console.anthropic.com에서 크레딧 충전 후 사용하세요.
            </p>
          </div>
          <div className="form-group">
            <label>Claude 모델</label>
            <select className="input" value={form.claudeModel} onChange={e => set('claudeModel', e.target.value)}>
              <option value="claude-opus-4-8">Claude Opus 4 — 최고품질 (느림·고비용)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4 — 균형 (권장)</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4 — 빠름·저렴</option>
            </select>
          </div>
        </>)}

        {/* ── 구분선 ── */}
        <hr className="api-divider" />

        {/* ── Unsplash ── */}
        <div className="form-group">
          <label>Unsplash Access Key</label>
          <div className="api-key-row">
            <div className="input-with-toggle">
              <input className="input" type={showUnsplash ? 'text' : 'password'} placeholder="Client-ID…"
                value={form.unsplashKey}
                onChange={e => { set('unsplashKey', e.target.value); setUnsplashStatus(null); }} />
              <button className="toggle-eye" onClick={() => setShowUnsplash(v => !v)}><EyeIcon open={showUnsplash} /></button>
            </div>
            <button className="btn btn-ghost" onClick={testUnsplash}
              disabled={!form.unsplashKey || unsplashStatus === 'testing'}>
              {unsplashStatus === 'testing' ? '확인 중…' : '테스트'}
            </button>
            {unsplashStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
            {unsplashStatus === 'error' && <span className="api-status error">✗ 오류</span>}
          </div>
        </div>

        {/* ── 구분선 ── */}
        <hr className="api-divider" />

        {/* ── Naver Open API (글감 수집용) ── */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>네이버 Open API <span style={{fontWeight:400, color:'var(--text-secondary)', fontSize:'12px'}}>— 글감 수집 안정성 향상 (선택)</span></label>
          <div style={{ display:'flex', gap:'8px', marginBottom:'6px', alignItems:'center' }}>
            <input className="input" type="text" placeholder="Client-ID"
              value={form.naverApiId}
              onChange={e => { set('naverApiId', e.target.value); setNaverApiStatus(null); }}
              style={{ flex:1 }} />
          </div>
          <div className="api-key-row">
            <div className="input-with-toggle" style={{ flex:1 }}>
              <input className="input" type={showNaverSecret ? 'text' : 'password'} placeholder="Client-Secret"
                value={form.naverApiSecret}
                onChange={e => { set('naverApiSecret', e.target.value); setNaverApiStatus(null); }} />
              <button className="toggle-eye" onClick={() => setShowNaverSecret(v => !v)}><EyeIcon open={showNaverSecret} /></button>
            </div>
            <button className="btn btn-ghost" onClick={testNaverApi}
              disabled={!form.naverApiId || !form.naverApiSecret || naverApiStatus === 'testing'}>
              {naverApiStatus === 'testing' ? '확인 중…' : '테스트'}
            </button>
            {naverApiStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
            {naverApiStatus === 'error' && <span className="api-status error">✗ 오류</span>}
          </div>
          <p style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'5px',lineHeight:'1.5'}}>
            🔑 <a href="https://developers.naver.com/apps/#/register" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>developers.naver.com</a> 에서 앱 등록 → 블로그 검색 API 선택 → Client-ID/Secret 발급 (무료·하루 25,000건)
          </p>
        </div>

        {/* ── 구분선 ── */}
        <hr className="api-divider" />

        {/* ── 네이버 검색광고 API (키워드 분석용) ── */}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>네이버 검색광고 API <span style={{fontWeight:400, color:'var(--text-secondary)', fontSize:'12px'}}>— 키워드 검색량 · 경쟁도 조회</span></label>
          <div style={{ display:'flex', gap:'8px', marginBottom:'6px' }}>
            <input className="input" type="text" placeholder="고객 ID (숫자)"
              value={form.searchAdCustomerId}
              onChange={e => { set('searchAdCustomerId', e.target.value); setSearchAdStatus(null); }}
              style={{ flex:1 }} />
          </div>
          <div style={{ display:'flex', gap:'8px', marginBottom:'6px', alignItems:'center' }}>
            <div className="input-with-toggle" style={{ flex:1 }}>
              <input className="input" type={showAdApiKey ? 'text' : 'password'} placeholder="API 접근 라이선스"
                value={form.searchAdApiKey}
                onChange={e => { set('searchAdApiKey', e.target.value); setSearchAdStatus(null); }} />
              <button className="toggle-eye" onClick={() => setShowAdApiKey(v => !v)}><EyeIcon open={showAdApiKey} /></button>
            </div>
          </div>
          <div className="api-key-row">
            <div className="input-with-toggle" style={{ flex:1 }}>
              <input className="input" type={showAdSecretKey ? 'text' : 'password'} placeholder="비밀 키"
                value={form.searchAdSecretKey}
                onChange={e => { set('searchAdSecretKey', e.target.value); setSearchAdStatus(null); }} />
              <button className="toggle-eye" onClick={() => setShowAdSecretKey(v => !v)}><EyeIcon open={showAdSecretKey} /></button>
            </div>
            <button className="btn btn-ghost" onClick={testSearchAd}
              disabled={!form.searchAdCustomerId || !form.searchAdApiKey || !form.searchAdSecretKey || searchAdStatus === 'testing'}>
              {searchAdStatus === 'testing' ? '확인 중…' : '테스트'}
            </button>
            {searchAdStatus === 'ok'    && <span className="api-status ok">✓ 연결됨</span>}
            {searchAdStatus === 'error' && <span className="api-status error">✗ 오류</span>}
          </div>
          <p style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'5px',lineHeight:'1.5'}}>
            🔑 <a href="https://searchad.naver.com" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>searchad.naver.com</a> 로그인 → 좌측 도구 → SA API 사용 관리 → 고객 ID · API Key · Secret 발급 (무료)
          </p>
        </div>
      </div>
      </div>}

      {/* ── 글 설정 탭 ────────────────────────────────────────── */}
      {activeTab === 'post' && <div className="settings-tab-content post-tab-scroll">

      {/* ── 썸네일 설정 ─────────────────────────────────────────── */}
      <div className="card settings-section">
        <h2 className="settings-section-title">썸네일 자동 생성</h2>
        <div className="settings-grid">
          <div className="form-group" style={{ gridColumn:'1/-1' }}>
            <label style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer' }}>
              <input type="checkbox" checked={form.customThumbnail !== false}
                onChange={e => set('customThumbnail', e.target.checked)}
                style={{ width:'16px', height:'16px', accentColor:'var(--accent)' }} />
              <span>발행 시 커스텀 썸네일 자동 생성</span>
              <span style={{ fontWeight:400, fontSize:'12px', color:'var(--text-secondary)' }}>
                — 게시글 제목을 디자인 배경에 삽입한 이미지를 첫 번째로 삽입
              </span>
            </label>
          </div>
          {form.customThumbnail !== false && (
            <div className="form-group" style={{ gridColumn:'1/-1' }}>
              <label>썸네일 스타일</label>
              <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px' }}>
                {[
                  { idx:-1, label:'🎲 랜덤', bg:'linear-gradient(135deg,#1a1a2e,#16213e)', color:'#fff' },
                  { idx:0,  label:'초록',   bg:'linear-gradient(135deg,#0f5c2e,#03c75a)',  color:'#fff' },
                  { idx:1,  label:'블루',   bg:'linear-gradient(135deg,#0d1b4b,#2563eb)',  color:'#fff' },
                  { idx:2,  label:'오렌지', bg:'linear-gradient(135deg,#7c2d00,#f97316)',  color:'#fff' },
                  { idx:3,  label:'퍼플',   bg:'linear-gradient(135deg,#1e0a3c,#7c3aed)',  color:'#fff' },
                  { idx:4,  label:'민트',   bg:'linear-gradient(135deg,#0f172a,#0f4c3a)',  color:'#6ee7b7' },
                  { idx:5,  label:'레드',   bg:'linear-gradient(135deg,#4a0f2a,#e11d48)',  color:'#fff' },
                ].map(({ idx, label, bg, color }) => {
                  const selected = (form.thumbnailStyle ?? -1) === idx;
                  return (
                    <button key={idx} onClick={() => set('thumbnailStyle', idx)}
                      style={{
                        background: bg, color, border: selected ? '2px solid var(--accent)' : '2px solid transparent',
                        borderRadius:'8px', padding:'8px 14px', fontSize:'12px', fontWeight:600,
                        cursor:'pointer', boxShadow: selected ? '0 0 0 2px rgba(3,199,90,0.4)' : 'none',
                        transition:'all .15s',
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize:'11px', color:'var(--text-secondary)', marginTop:'8px', lineHeight:1.6 }}>
                외부 API 불필요 · 540×540px PNG 자동 생성 · 발행 창에서 첫 번째 이미지로 삽입됩니다
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── 본문 서식 스타일 (2026-07-07 신규) ─────────────────── */}
      <div className="card settings-section">
        <h2 className="settings-section-title">본문 서식 스타일</h2>
        <div className="settings-grid">
          <div className="form-group" style={{ gridColumn:'1/-1' }}>
            <label>대분류·중분류·소분류 색상 및 아이콘 조합</label>
            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px' }}>
              {[
                { idx:-1, label:'🎲 랜덤',   bg:'linear-gradient(135deg,#1a1a2e,#16213e)', color:'#fff' },
                { idx:0,  label:'✅ 그린',   bg:'linear-gradient(135deg,#0f5c2e,#03c75a)',  color:'#fff' },
                { idx:1,  label:'📘 블루',   bg:'linear-gradient(135deg,#0d1b4b,#2563eb)',  color:'#fff' },
                { idx:2,  label:'🔥 오렌지', bg:'linear-gradient(135deg,#7c2d00,#f97316)',  color:'#fff' },
                { idx:3,  label:'💜 퍼플',   bg:'linear-gradient(135deg,#1e0a3c,#7c3aed)',  color:'#fff' },
                { idx:4,  label:'🌿 민트',   bg:'linear-gradient(135deg,#0f172a,#0f4c3a)',  color:'#6ee7b7' },
              ].map(({ idx, label, bg, color }) => {
                const selected = (form.postStyle ?? -1) === idx;
                return (
                  <button key={idx} onClick={() => set('postStyle', idx)}
                    style={{
                      background: bg, color, border: selected ? '2px solid var(--accent)' : '2px solid transparent',
                      borderRadius:'8px', padding:'8px 14px', fontSize:'12px', fontWeight:600,
                      cursor:'pointer', boxShadow: selected ? '0 0 0 2px rgba(3,199,90,0.4)' : 'none',
                      transition:'all .15s',
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize:'11px', color:'var(--text-secondary)', marginTop:'8px', lineHeight:1.6 }}>
              발행 글의 제목 박스 색상·아이콘 조합입니다 · 랜덤 선택 시 매 발행마다 5가지 중 하나가 자동으로 적용되어 계정마다 다른 느낌을 줍니다
            </p>
          </div>
        </div>
      </div>

      {/* ── 에디터 폰트 ──────────────────────────────────────── */}
      <div className="card settings-section">
        <h2 className="settings-section-title">에디터 폰트</h2>
        <div className="settings-grid">
          <div className="form-group" style={{ gridColumn:'1/-1' }}>
            <label>발행 시 적용할 폰트</label>
            <select className="input" value={form.editorFont ?? '바른히피'} onChange={e => set('editorFont', e.target.value)}>
              <option value="">적용 안 함</option>
              <option value="기본서체">기본서체</option>
              <option value="나눔고딕">나눔고딕</option>
              <option value="나눔명조">나눔명조</option>
              <option value="나눔바른고딕">나눔바른고딕</option>
              <option value="나눔스퀘어">나눔스퀘어</option>
              <option value="마루부리">마루부리</option>
              <option value="다시시작해">다시시작해</option>
              <option value="바른히피">바른히피</option>
              <option value="우리딸손글씨">우리딸손글씨</option>
            </select>
            <p style={{ fontSize:'11px', color:'var(--text-secondary)', marginTop:'6px' }}>
              글 발행 시 에디터 전체 텍스트에 선택한 폰트를 자동 적용합니다
            </p>
          </div>
        </div>
      </div>

      {/* ── AI / 인간화 설정 ──────────────────────────────────── */}
      <div className="card settings-section">
        <h2 className="settings-section-title">AI / 인간화 기본값</h2>
        <div className="settings-grid">
          <div className="form-group">
            <label>문장 길이 스타일</label>
            <select className="input" value={form.sentenceStyle} onChange={e => set('sentenceStyle', e.target.value)}>
              <option value="auto">자동 (랜덤 변화)</option>
              <option value="short">짧은 문장 위주</option>
              <option value="long">긴 문장 위주</option>
            </select>
          </div>
          <div className="form-group">
            <label>문체 스타일</label>
            <select className="input" value={form.writingStyle} onChange={e => set('writingStyle', e.target.value)}>
              <option value="auto">자동 (구어체+문어체 혼합)</option>
              <option value="colloquial">구어체 위주</option>
              <option value="formal">문어체 위주</option>
            </select>
          </div>
          <div className="form-group">
            <label>개인 경험담 삽입</label>
            <select className="input" value={form.personalExp} onChange={e => set('personalExp', e.target.value)}>
              <option value="auto">자동 삽입 (권장)</option>
              <option value="many">많이 삽입</option>
              <option value="few">적게 삽입</option>
              <option value="none">삽입 안 함</option>
            </select>
          </div>
          <div className="form-group">
            <label>기본 글 톤</label>
            <select className="input" value={form.tone} onChange={e => set('tone', e.target.value)}>
              <option value="info">정보형</option>
              <option value="daily">일상형</option>
              <option value="review">리뷰형</option>
              <option value="emotional">감성형</option>
            </select>
          </div>
        </div>
      </div>

      </div>}

      {/* ── 자동화 루프 탭 (2026-07-05 신규, 설계 협의 완료 후 구현) ── */}
      {/* 2026-07-06: 이 탭만 세로 스크롤 허용(loop-tab-scroll) — 발행 계정
          선택 섹션이 길어져도(예: 카테고리 드롭다운 확장) 하단의 "키워드
          소진 시 동작" 등이 잘리지 않고 스크롤로 보이도록 함 */}
      {activeTab === 'loop' && <div className="settings-tab-content loop-tab-scroll">

      <div className="card settings-section">
        <div className="settings-section-title-row">
          <h2 className="settings-section-title">발행 계정 선택</h2>
          {singleAcc && (
            <div className="loop-cattopic-header-action">
              {catTopicMsg[singleAcc.id] && <span className="loop-cattopic-header-msg">{catTopicMsg[singleAcc.id]}</span>}
              <button type="button" className="btn btn-ghost btn-xs"
                disabled={!!catTopicLoading[singleAcc.id]}
                onClick={() => handleFetchCategoryTopics(singleAcc.id)}>
                {catTopicLoading[singleAcc.id] ? '불러오는 중…' : '🔄 실제 카테고리 불러오기'}
              </button>
            </div>
          )}
          {/* 2026-07-06 신규: 다계정 순차 발행 — 계정별로 흩어져 있던
              "실제 카테고리" 버튼을 여기 헤더 버튼 하나로 통합. 루프에
              포함된(체크된) 계정만 순서대로 처리(사용자 확인 완료). */}
          {loopForm.accountMode === 'multi' && (
            <div className="loop-cattopic-header-action">
              {multiCatTopicProgress && <span className="loop-cattopic-header-msg">{multiCatTopicProgress}</span>}
              <button type="button" className="btn btn-ghost btn-xs"
                disabled={multiCatTopicLoading}
                onClick={handleFetchCategoryTopicsForIncluded}>
                {multiCatTopicLoading ? '불러오는 중…' : '🔄 실제 카테고리 불러오기'}
              </button>
            </div>
          )}
        </div>
        <div className="form-group">
          <div className="loop-radio-row">
            <label className="loop-radio">
              <input type="radio" name="accountMode" checked={loopForm.accountMode === 'single'}
                onChange={() => setLoop('accountMode', 'single')} />
              1계정 발행
            </label>
            <label className="loop-radio">
              <input type="radio" name="accountMode" checked={loopForm.accountMode === 'multi'}
                onChange={() => setLoop('accountMode', 'multi')} />
              다계정 순차 발행
            </label>
            {/* 2026-07-06 신규: 체크 해제된(제외된) 계정을 목록에서 숨겨
                공간을 줄임 — 화면 표시 전용, 기본값 꺼짐(체크된 계정만
                표시). loop_enabled 값이나 자동화 실행 대상에는 영향 없음. */}
            {loopForm.accountMode === 'multi' && (
              <label className="loop-radio loop-show-all-toggle">
                <input type="checkbox" checked={showAllAccounts}
                  onChange={e => setShowAllAccounts(e.target.checked)} />
                계정 모두 보기
              </label>
            )}
          </div>
        </div>

        {loopForm.accountMode === 'single' ? (
          <div className="form-group">
            <div className="loop-single-grid">
              <div className="loop-single-grid-cell">
                <label>사용할 계정</label>
                <select className="input loop-single-account-select" value={loopForm.singleAccountId ?? ''}
                  onChange={e => setLoop('singleAccountId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">선택 안 함</option>
                  {loopAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.nickname || a.naver_id}{a.status === 'expired' ? ' (만료됨)' : ''}</option>
                  ))}
                </select>
              </div>
              {singleAcc && (
                <div className="loop-single-grid-cell">
                  <label>배정 카테고리</label>
                  <select className="input loop-category-select" value={singleAcc.loop_category || ''}
                    onChange={e => handleSetAccountCategory(singleAcc.id, e.target.value)}>
                    <option value="">전체 (제한 없음)</option>
                    {loopCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              {singleAcc && <div className="loop-single-grid-cell" />}
              {singleAcc && (
                <div className="loop-single-grid-cell">
                  <label>네이버 카테고리</label>
                  <NaverCategoryPicker
                    value={getNaverCategorySelectValue(singleAcc.id, singleAcc.naver_category)}
                    realNameMap={catTopicMap[singleAcc.id] || {}}
                    onChange={(std) => handleSelectStandardCategory(singleAcc.id, std)}
                    placeholder="지정 안 함 (블로그 기본/최근 선택값 유지)"
                  />
                </div>
              )}
            </div>
            {singleAcc && (
              <div className="loop-single-desc-block">
                <p className="loop-field-desc">배정 카테고리 — 지정 시 이 카테고리의 글감만 사용, 소진되면 같은 카테고리에서 자동 보충</p>
                <p className="loop-field-desc">네이버 카테고리 (발행 대상) — 완전자동 발행 시 이 카테고리로 발행. "🔄 실제 카테고리 불러오기"로 실제 블로그 카테고리명을 먼저 확인하세요</p>
              </div>
            )}
          </div>
        ) : (
          <div className="form-group">
            <label>루프에 포함할 계정 <span style={{fontWeight:400, fontSize:'12px', color:'var(--text-secondary)'}}>— 특정 계정만 쉬게 하고 싶을 때 체크 해제. 첫 번째 드롭다운은 글감 카테고리 필터, 두 번째 드롭다운은 완전자동 발행 시 실제 네이버 블로그 카테고리 지정</span></label>
            <div className="loop-account-list">
              {loopAccounts.length === 0 && <p className="loop-empty-hint">등록된 계정이 없습니다.</p>}
              {(showAllAccounts ? loopAccounts : loopAccounts.filter(a => a.loop_enabled)).map(a => {
                // 2026-07-06 신규: 계정당 여러 개의 "배정 카테고리 + 네이버
                // 카테고리" 쌍 지원 — 현재는 PILOT_NAVER_IDS(skysmoga,
                // skysmogs66)에 한해서만 UI로 추가/삭제 가능(파일럿). 다른
                // 계정은 기존과 완전히 동일.
                const isPilot = PILOT_NAVER_IDS.includes(a.naver_id);
                const pairs = isPilot ? (categoryPairs[a.id] || []) : [];
                const canAddMore = pairs.length < 4;
                // 2026-07-06: 추가된 쌍이 있으면(hasExtra) 계정 블록 전체를
                // 하나의 배경 박스로 감싸 "이 계정의 칸이 아래로 확장된"
                // 느낌을 줌(사용자 확인 완료) — 쌍이 없으면 기존과 동일하게
                // 기본 행 자체가 개별 박스로 보임.
                const hasExtra = isPilot && pairs.length > 0;
                return (
                  <div key={a.id} className={`loop-account-block${hasExtra ? ' loop-account-block-grouped' : ''}`}>
                    <div className="loop-account-row">
                      <label>
                        <input type="checkbox" checked={!!a.loop_enabled}
                          onChange={e => handleToggleLoopAccount(a.id, e.target.checked)} />
                        <span>{a.nickname || a.naver_id}</span>
                        {a.status === 'expired' && <span className="loop-account-expired">만료됨</span>}
                      </label>
                      <select className="input loop-category-select" value={a.loop_category || ''}
                        onChange={e => handleSetAccountCategory(a.id, e.target.value)}>
                        <option value="">전체 (제한 없음)</option>
                        {loopCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <NaverCategoryPicker
                        value={getNaverCategorySelectValue(a.id, a.naver_category)}
                        realNameMap={catTopicMap[a.id] || {}}
                        onChange={(std) => handleSelectStandardCategory(a.id, std)}
                        placeholder="네이버 카테고리 지정 안 함"
                      />
                      {isPilot && (
                        <button type="button" className="loop-pair-add-btn"
                          disabled={!canAddMore}
                          onClick={() => handleAddCategoryPair(a.id)}>
                          + 추가
                        </button>
                      )}
                    </div>
                    {isPilot && pairActionMsg[a.id] && (
                      <p className="loop-pair-msg">{pairActionMsg[a.id]}</p>
                    )}
                    {isPilot && pairs.map(p => (
                      <div key={p.id} className="loop-account-row loop-account-row-extra">
                        <span className="loop-pair-indent" />
                        <select className="input loop-category-select" value={p.loop_category || ''}
                          onChange={e => handleSetPairCategory(a.id, p.id, e.target.value)}>
                          <option value="">전체 (제한 없음)</option>
                          {loopCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <NaverCategoryPicker
                          value={getNaverCategorySelectValue(a.id, p.naver_category)}
                          realNameMap={catTopicMap[a.id] || {}}
                          onChange={(std) => handleSelectStandardCategoryForPair(a.id, p.id, std)}
                          placeholder="네이버 카테고리 지정 안 함"
                        />
                        <button type="button" className="loop-pair-remove-btn"
                          onClick={() => handleRemoveCategoryPair(a.id, p.id)}>
                          − 삭제
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card settings-section">
        <h2 className="settings-section-title">실행 주기</h2>
        <p style={{fontSize:'11px', color:'var(--text-secondary)', marginTop:'-4px', marginBottom:'10px', lineHeight:1.6}}>
          앱 실행 후 모드를 선택하고 "시작"을 누른 시점부터 계산됩니다. 계정당 발행 간격은
          발행 스케줄러의 "발행 안전 설정"(최소 간격)과 저품질 방지를 위한 최소 30분 강제 딜레이 중 더 큰 값을 따릅니다.
        </p>
        <div className="form-group">
          <div className="loop-radio-row">
            <label className="loop-radio">
              <input type="radio" name="cycleMode" checked={loopForm.cycleMode === 'count'}
                onChange={() => setLoop('cycleMode', 'count')} />
              실행 횟수로 지정
            </label>
            <label className="loop-radio">
              <input type="radio" name="cycleMode" checked={loopForm.cycleMode === 'duration'}
                onChange={() => setLoop('cycleMode', 'duration')} />
              실행 시간으로 지정
            </label>
          </div>
        </div>
        {loopForm.cycleMode === 'count' ? (
          <div className="form-group">
            <label>총 실행 사이클 수 <span style={{fontWeight:400,fontSize:'12px',color:'var(--text-secondary)'}}>— 1사이클 = 등록 계정 전체 1회씩 발행</span></label>
            {/* 2026-07-06: 발행 스케줄러의 "일일 최대 발행" 입력칸(.sf-input,
                width 60px + text-align:center)과 동일한 크기/정렬로 통일.
                숫자 스핀 버튼(위/아래 화살표)이 박스 우측 공간을 차지해
                text-align:center가 그 화살표를 제외한 영역 기준으로 중앙
                정렬되어 시각적으로 왼쪽에 치우쳐 보이던 문제 수정 —
                .sf-input과 동일하게 스핀 버튼을 숨겨 전체 박스 너비 기준
                으로 정확히 중앙정렬되도록 함 (cycle-count-input 클래스,
                CSS는 Settings.css 참고). */}
            <input className="input cycle-count-input" type="number" min="1" max="20" style={{width:'60px', textAlign:'center'}}
              value={loopForm.cycleCount}
              onChange={e => setLoop('cycleCount', Math.max(1, Number(e.target.value) || 1))} />
          </div>
        ) : (
          <div className="form-group">
            <label>총 실행 시간 (시간)</label>
            <input className="input" type="number" min="1" max="48" style={{maxWidth:'120px'}}
              value={loopForm.cycleDurationHours}
              onChange={e => setLoop('cycleDurationHours', Math.max(1, Number(e.target.value) || 1))} />
          </div>
        )}
      </div>

      <div className="card settings-section">
        <h2 className="settings-section-title">키워드 소진 시 동작</h2>
        <div className="form-group">
          <div className="loop-radio-row">
            <label className="loop-radio">
              <input type="radio" name="keywordExhaustion" checked={loopForm.keywordExhaustion === 'refill'}
                onChange={() => setLoop('keywordExhaustion', 'refill')} />
              트렌드 자동 보충 (등록된 활성 키워드로 재수집)
            </label>
            <label className="loop-radio">
              <input type="radio" name="keywordExhaustion" checked={loopForm.keywordExhaustion === 'notify'}
                onChange={() => setLoop('keywordExhaustion', 'notify')} />
              중단 + 알림
            </label>
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer' }}>
            <input type="checkbox" checked={!!loopForm.pcShutdownOnExhaustion}
              onChange={e => setLoop('pcShutdownOnExhaustion', e.target.checked)}
              style={{ width:'16px', height:'16px', accentColor:'var(--accent)' }} />
            <span>완전자동에서 키워드가 끝까지 소진되면 PC 자동 종료</span>
          </label>
          <p style={{fontSize:'11px', color:'var(--text-secondary)', marginTop:'6px', lineHeight:1.6}}>
            60초 카운트다운 후 종료되며, 대시보드에서 카운트다운 중 언제든 취소할 수 있습니다.
          </p>
        </div>
      </div>

      </div>}

      {/* ── 시스템 탭 — 라이선스 (2026-07-04 신규) ───────────────── */}
      {activeTab === 'system' && <div className="card settings-section">
        <h2 className="settings-section-title">라이선스</h2>
        <div className="form-group">
          <label>라이선스 키</label>
          <div className="license-input-row">
            <input
              type="text"
              className="input"
              value={form.licenseKey}
              onChange={e => set('licenseKey', e.target.value)}
              placeholder="구매하신 라이선스 키를 붙여넣으세요 (미입력 시 스탠다드로 동작)"
            />
            <button className="btn btn-ghost btn-sm" onClick={handleApplyLicense} disabled={licenseSaving}>
              {licenseSaving ? '적용 중…' : '적용'}
            </button>
          </div>
          {licenseMsg && (
            <div className={`license-msg license-msg-${licenseMsg.type}`}>{licenseMsg.text}</div>
          )}
        </div>

        <div className="license-status">
          <div className="license-status-row">
            <span className="license-status-label">현재 등급</span>
            <span className={`license-badge license-badge-${licenseStatus?.tier === 'premium' ? 'premium' : 'standard'}`}>
              {licenseStatus?.tier === 'premium' ? '프리미엄' : '스탠다드'}
            </span>
          </div>
          {licenseStatus?.hasKey && (<>
            <div className="license-status-row">
              <span className="license-status-label">최대 사용 기기 수</span>
              <span>{licenseStatus.maxDevices || 1}대</span>
            </div>
            <div className="license-status-row">
              <span className="license-status-label">만료일</span>
              <span>
                {licenseStatus.expiresAt || '무제한'}
                {licenseStatus.expiresAt && (
                  licenseStatus.expired
                    ? <span className="license-expired"> · 만료됨</span>
                    : (licenseStatus.daysRemaining != null && <span className="license-dday"> · D-{licenseStatus.daysRemaining}</span>)
                )}
              </span>
            </div>
            {licenseStatus.licenseId && (
              <div className="license-status-row">
                <span className="license-status-label">라이선스 번호</span>
                <span>{licenseStatus.licenseId}</span>
              </div>
            )}
          </>)}
        </div>
      </div>}

      {/* ── 시스템 탭 — 오류 로그 ─────────────────────────────── */}
      {activeTab === 'system' && <div className="card settings-section">
        <h2 className="settings-section-title">시스템</h2>
        <div className="log-toolbar">
          <button className="btn btn-ghost btn-sm" onClick={handleShowLog}>📋 오류 로그 보기</button>
          {/* 자동화 루프 전용 로그 (2026-07-05 신규) — 오류 로그와 별도로 LOOP 컨텍스트만 모아서 기록됨.
              2026-07-05 수정: 사용자 요청으로 "오류 로그 보기"와 "파일로 열기" 사이로 위치 이동. */}
          <button className="btn btn-ghost btn-sm" onClick={handleShowLoopLog}>🔁 자동화 루프 로그 보기</button>
          <button className="btn btn-ghost btn-sm" onClick={handleOpenLog}>↗ 파일로 열기</button>
          <button className="btn btn-ghost btn-sm log-clear-btn" onClick={handleFullReset} disabled={fullResetting} title="계정을 제외한 발행 이력·예약 등 전체 데이터를 초기화합니다">
            {fullResetting ? '초기화 중…' : '🗑 전체 초기화'}
          </button>
        </div>
        {logPath && <div className="log-path-hint">{logPath}</div>}
      </div>}

      {/* ── 자동화 루프 로그 팝업 모달 (2026-07-05 신규) ─────────── */}
      {loopLogVisible && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setLoopLogVisible(false); }}>
          <div className="log-modal">
            <div className="log-modal-header">
              <span className="log-modal-title">자동화 루프 로그</span>
              <div className="log-modal-actions">
                <button className="btn btn-ghost btn-xs" onClick={handleOpenLoopLog}>↗ 파일로 열기</button>
                <button className="btn btn-ghost btn-xs log-clear-btn" onClick={handleClearLoopLog} disabled={loopLogClearing}>
                  {loopLogClearing ? '초기화 중…' : '🗑 초기화'}
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => setLoopLogVisible(false)}>✕ 닫기</button>
              </div>
            </div>
            {loopLogPath && <div className="log-modal-path">{loopLogPath}</div>}
            <pre
              className="log-modal-content"
              onMouseUp={() => {
                const selected = window.getSelection()?.toString();
                if (selected && selected.length > 0) {
                  navigator.clipboard.writeText(selected).then(() => {
                    setLoopLogCopyToast(true);
                    setTimeout(() => setLoopLogCopyToast(false), 1500);
                  });
                }
              }}
            >{loopLogContent || '(로그 없음)'}</pre>
            {loopLogCopyToast && <div className="log-copy-toast">✓ 복사됨</div>}
          </div>
        </div>
      )}

      {/* ── 오류 로그 팝업 모달 ────────────────────────────────── */}
      {logVisible && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setLogVisible(false); }}>
          <div className="log-modal">
            <div className="log-modal-header">
              <span className="log-modal-title">오류 로그</span>
              <div className="log-modal-actions">
                <button className="btn btn-ghost btn-xs" onClick={handleOpenLog}>↗ 파일로 열기</button>
                <button className="btn btn-ghost btn-xs log-clear-btn" onClick={handleClearLog} disabled={logClearing}>
                  {logClearing ? '초기화 중…' : '🗑 초기화'}
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => setLogVisible(false)}>✕ 닫기</button>
              </div>
            </div>
            {logPath && <div className="log-modal-path">{logPath}</div>}
            <pre
              className="log-modal-content"
              onMouseUp={() => {
                const selected = window.getSelection()?.toString();
                if (selected && selected.length > 0) {
                  navigator.clipboard.writeText(selected).then(() => {
                    setLogCopyToast(true);
                    setTimeout(() => setLogCopyToast(false), 1500);
                  });
                }
              }}
            >{logContent || '(로그 없음)'}</pre>
            {logCopyToast && <div className="log-copy-toast">✓ 복사됨</div>}
          </div>
        </div>
      )}

    </div>
  );
}
