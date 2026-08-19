import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PostCreate.css';
import useLicenseLimits, { PREMIUM_ONLY_TOOLTIP } from '../hooks/useLicenseLimits';

// ── 기본값 ────────────────────────────────────────────────────
const TONE_OPTIONS = [
  { value: 'info',      label: '정보형',  desc: '객관적 정보 중심, "~입니다", 수치·데이터 포함' },
  { value: 'daily',     label: '일상형',  desc: '친근한 말투, 일기·후기 형식' },
  { value: 'review',    label: '리뷰형',  desc: '장단점 분석, 별점·총평 포함' },
  { value: 'emotional', label: '감성형',  desc: '감정 표현 풍부, 분위기·느낌 위주' },
];
const STYLE_OPTIONS = [
  { value: 'auto',       label: '자동 혼합',   desc: '구어체+문어체 자연스럽게 혼합 (권장)' },
  { value: 'colloquial', label: '구어체 위주',  desc: '"~했어요", "~인데요" 일상 말투' },
  { value: 'formal',     label: '문어체 위주',  desc: '"~합니다", "~됩니다" 격식체' },
];
const EXP_OPTIONS = [
  { value: 'auto', label: '자동 삽입', desc: '"저는 써보니까..." 등 자연스럽게 삽입 (권장)' },
  { value: 'many', label: '많이 삽입', desc: '경험담 비중 높임 — 리뷰형 글에 적합' },
  { value: 'few',  label: '적게 삽입', desc: '경험담 최소화 — 정보형 글에 적합' },
  { value: 'none', label: '삽입 안 함', desc: '경험담 없이 순수 정보 중심' },
];
const SENTENCE_OPTIONS = [
  { value: 'auto',  label: '자동',       desc: 'AI가 짧은·긴 문장을 자연스럽게 혼합 (권장)' },
  { value: 'short', label: '짧은 문장',  desc: '템포감 있고 읽기 쉬운 스타일' },
  { value: 'long',  label: '긴 문장',    desc: '상세하고 전문적인 스타일' },
];

// ── 커스텀 드롭다운 컴포넌트 ─────────────────────────────────
function DescSelect({ options, value, onChange, align = 'left', disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find(o => o.value === value) || options[0];

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="desc-select" ref={ref}>
      <button
        type="button"
        className="desc-select-trigger input"
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        disabled={disabled}
      >
        <span className="desc-select-label">{selected.label}</span>
        <span className="desc-select-arrow">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className={`desc-select-menu${align === 'right' ? ' align-right' : ''}`}>
          {options.map(o => (
            <div
              key={o.value}
              className={`desc-select-item${o.value === value ? ' active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="desc-select-item-label">{o.label}</span>
              <span className="desc-select-item-desc">{o.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 2026-07-07: 이미지 3장 → 5장으로 확대 (대주제 전환 지점마다 배치)
// 2026-08-04: 5장 → 10장으로 재확대(제미나이 SEO 리포트의 "항상 5장 고정=
// 기계적 패턴" 지적 반영). 앞 5개(도입부~마무리)는 기존과 동일하게 항상
// 삽입되고, 뒤 5개("+" 표시)는 발행마다 1~5개만 무작위(또는 더블클릭으로
// 사용자가 직접 고른 지점)로 보너스 삽입된다 — 기존 5곳의 삽입 위치·순서는
// 변경하지 않음([[image-slot-expansion-2026-08-04]] 참고).
const IMG_POSITIONS = ['도입부', '대주제1', '중간전환', '대주제2', '마무리', '도입부+', '대주제1+', '중간전환+', '대주제2+', '마무리+'];
const emptyImages = () => IMG_POSITIONS.map(pos => ({ position: pos, id: null, url: null, thumb: null, alt: '', photographer: '', loading: false }));

// ── 아이콘 ────────────────────────────────────────────────────
const RefreshIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);
const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

// ── 글자수 계산 ───────────────────────────────────────────────
function countChars(text) {
  return text ? text.replace(/\s/g, '').length : 0;
}

// ── 키워드 밀도 계산 ──────────────────────────────────────────
// AI가 "여행사진" → "여행 사진을"처럼 글자 사이에 공백을 넣어 사용하므로
// 각 글자 사이에 \s* (선택적 공백)를 허용하여 매칭
function calcDensity(text, keywords) {
  if (!text || !keywords.length) return [];
  const lower = text.toLowerCase();
  const noSpaceLen = lower.replace(/\s/g, '').length; // 밀도 기준: 공백 제외 길이
  return keywords.map(kw => {
    const k = kw.trim().toLowerCase();
    if (!k) return null;
    // 각 글자 사이에 \s* 삽입 → "여행사진"이 "여행 사진" 형태도 카운팅
    const flexPattern = k
      .split('')
      .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s*');
    const count = (lower.match(new RegExp(flexPattern, 'g')) || []).length;
    const density = noSpaceLen > 0 ? ((k.length * count) / noSpaceLen * 100).toFixed(1) : '0.0';
    return { kw, count, density };
  }).filter(Boolean);
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function PostCreate() {
  const { limits: tierLimits } = useLicenseLimits();
  const { pathname, state } = useLocation();
  // 2026-07-07: 파일 내 기존 코드(요금 한도 오류 카드)에서 navigate('/settings')를
  // 이미 참조하고 있었으나 useNavigate가 import/선언돼 있지 않아 클릭 시
  // 런타임 오류가 나던 잠재 버그였음 — 이번 작업 중 확인되어 함께 수정.
  const navigate = useNavigate();

  // 입력값
  const [topic, setTopic]       = useState('');
  const [keywords, setKeywords] = useState('');
  const [tone, setTone]         = useState('info');
  // 2026-08-07 신규: 톤을 "리뷰형"으로 바꾸면 제품명 입력 모달을 띄워
  // 사용자가 특정 상품명을 지정할 수 있게 함 — 입력하면 쿠팡 제휴 상품
  // 검색 시 글 제목 대신 이 제품명을 우선 사용(더 정확한 상품 매칭 목적).
  const [reviewProductName, setReviewProductName] = useState('');
  // 2026-08-09 신규: "관련 사이트"를 실제로 게시글에 삽입할지 여부(기본 해제).
  // AI가 3개를 생성해 보여주는 것과는 별개로, 사용자가 확인 후 체크해야만
  // 미리보기/발행 결과에 반영된다.
  const [insertLinks, setInsertLinks] = useState(false);
  const [showReviewProductModal, setShowReviewProductModal] = useState(false);
  const [reviewProductInput, setReviewProductInput] = useState('');
  const [writingStyle, setWritingStyle] = useState('auto');
  const [personalExp, setPersonalExp]   = useState('auto');
  const [sentenceStyle, setSentenceStyle] = useState('auto');
  const [targetMin, setTargetMin] = useState(2000);
  const [targetMax, setTargetMax] = useState(3000);
  const [accountId, setAccountId] = useState('');

  // 계정 목록
  const [accounts, setAccounts] = useState([]);

  // 생성 결과
  const [result, setResult] = useState(null);
  // { title, intro, body, conclusion, hashtags }

  // 편집 모드
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');

  // 로딩
  const [generating, setGenerating] = useState(false);
  const [regenSection, setRegenSection] = useState(null); // 'title'|'intro'|'body'|'conclusion'

  // 복사 피드백
  const [copied, setCopied] = useState(false);

  // 이미지 상태
  const [images, setImages] = useState(emptyImages());
  const [imgSearched, setImgSearched] = useState(false);
  // 2026-07-07 신규: 썸네일 배경으로 직접 선택한 이미지 카드 인덱스(0~9).
  // null이면 선택 안 함 = 기존 자동 검색 그대로 사용. 카드 클릭으로 토글.
  const [thumbBgIndex, setThumbBgIndex] = useState(null);
  // 2026-08-04 신규: 보너스 슬롯(인덱스 5~9)을 더블클릭으로 "삽입 선택"한
  // 카드 인덱스 집합. 비어있으면(사용자가 하나도 고르지 않으면) 발행 시
  // 1~5개를 무작위로 자동 선택한다. resolveBonusPoints()에서 사용.
  const [insertSelected, setInsertSelected] = useState(new Set());
  // 미리보기와 실제 발행 결과가 어긋나지 않도록, 보너스 삽입 지점(0~4,
  // 기존 5곳 기준 인덱스)을 미리보기 요청 시 한 번 계산해 고정해둔다.
  const [resolvedBonusPoints, setResolvedBonusPoints] = useState(null);

  // 에러 메시지
  const [errorMsg, setErrorMsg] = useState('');

  // 단어 교체
  const [showReplace, setShowReplace] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState('');
  const [replaceTo, setReplaceTo]     = useState('');
  const [replaceCount, setReplaceCount] = useState(null); // null | number

  // 키워드 자동 생성
  const [kwSuggesting, setKwSuggesting] = useState(false);
  const [kwError, setKwError]           = useState('');

  // 발행 관련
  const [publishing, setPublishing]       = useState(false);
  const [scheduling, setScheduling]       = useState(false); // 예약 등록 중(네이버 에디터 자동화 진행 중)
  const [testing, setTesting]             = useState(false); // 2026-07-24 신규: 테스트 발행 진행 중(개발자 전용, 실제 발행 안 함)
  const [savingDraft, setSavingDraft]     = useState(false); // 2026-08-09 신규: 임시저장(검수 대기로 저장) 진행 중
  const [publishMsg, setPublishMsg]       = useState('');    // 성공/오류 메시지
  const [headlessMode, setHeadlessMode]   = useState(true);  // true=백그라운드 발행
  const [autoThumbnail, setAutoThumbnail] = useState(true);  // 커스텀 썸네일 자동 생성 (settings.customThumbnail)
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate]   = useState('');
  const [scheduleTime, setScheduleTime]   = useState('09:00');
  const [earliestSlot, setEarliestSlot]           = useState(''); // 'YYYY-MM-DDTHH:MM' — 예약 가능한 가장 빠른 시각
  const [earliestSlotLoading, setEarliestSlotLoading] = useState(false);
  const [publishCategory, setPublishCategory] = useState('');   // 카테고리명
  const [publishVisibility, setPublishVisibility] = useState('public'); // 'public'|'private'
  const [blogCategories, setBlogCategories] = useState([]);          // 실제 블로그 카테고리 목록
  const [categoriesLoading, setCategoriesLoading] = useState(false); // 카테고리 로딩 중
  // 2026-07-22 신규: 카테고리 로드 실패 표시. 지금까지 확인된 실패 사례가
  // 전부 네이버 세션 만료였어서(계정 세션 라이브 체크 기능과 같은 원인),
  // 조용히 빈 칸으로 남기지 않고 원인을 바로 안내 — 사용자 피드백 반영.
  const [categoryError, setCategoryError] = useState(false);

  // 2026-07-07 신규: 발행 전 미리보기 — 수동/반자동 전용. 체크박스가 켜져
  // 있으면 즉시발행/예약발행 클릭 시 실제 자동화 전에 먼저 썸네일/본문
  // 스타일을 반영한 미리보기를 보여주고, 확인 후에만 실제 발행을 진행한다.
  // previewPendingAction: 'now' | 'schedule' — 미리보기 확인 버튼을 눌렀을 때
  // 어떤 발행 동작을 이어서 실행할지 기억해둔다.
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewPendingAction, setPreviewPendingAction] = useState(null);

  // 2026-07-07 신규: 검수 대기 화면에서 "글 생성으로 이동"으로 넘어온 글을
  // 위한 상태 — reviewMemo는 상단 안내 배너에 표시할 누락 사유,
  // pendingCategoryRef는 계정별 카테고리 목록이 로드되기 전에 미리 정해둔
  // 카테고리를 그 로딩이 끝난 뒤 한 번 적용하기 위한 값(계정 변경 시
  // publishCategory를 비우는 기존 이펙트와 충돌하지 않도록 ref로 보관).
  const [reviewMemo, setReviewMemo] = useState('');
  const pendingCategoryRef = useRef(null);

  // 2026-07-29 신규(개발자 전용 테스트 기능): "글 가져오기" — 사용자가
  // 입력한 URL의 본문을 가져와 참고 자료로 삼아 선택한 글톤에 맞춰
  // 재구성해서 글을 생성한다. 배포판에서는 아래 process.env.NODE_ENV
  // 가드로 버튼 자체가 렌더링되지 않고, main.js의 dev:fetchUrlText
  // 핸들러도 isDev로 이중 차단한다(기존 개발자 등급 토글/테스트 발행과
  // 동일한 이중가드 패턴).
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  // 2026-08-04 신규: URL 가져오기 모달에서 고를 글 톤 — 기본값 정보형.
  // 상품 판매 관련 소스를 가져올 때 리뷰형으로 선택하면 제휴 상품 코드가
  // 붙을 수 있도록 하기 위함(사용자 요청).
  const [importTone, setImportTone] = useState('info');
  const [sourceMaterial, setSourceMaterial] = useState(null); // { url, title, text, tone } | null
  // 2026-07-29 신규: 가져오기 성공 시 잠깐 떴다가(3초) 자동으로 사라지는 알림
  const [importToast, setImportToast] = useState(false);

  // 환경설정 기본값 로드 (최초 1회)
  useEffect(() => {
    window.electronAPI.settings.get().then(res => {
      if (res.success && res.settings) {
        const s = res.settings;
        if (s.tone)          setTone(s.tone);
        if (s.writingStyle)  setWritingStyle(s.writingStyle);
        if (s.personalExp)   setPersonalExp(s.personalExp);
        if (s.sentenceStyle) setSentenceStyle(s.sentenceStyle);
        // 환경설정의 customThumbnail 값으로 초기화 (기본 true)
        setAutoThumbnail(s.customThumbnail !== false);
        // 2026-07-16에 "브라우저 표시" 체크박스를 전역 설정
        // (settings.autoShowPublishWindow)과 연동했었으나, 그러면 이
        // 화면에서 수동 발행을 한 번만 해도 완전자동 루프의 브라우저
        // 표시 설정까지 조용히 바뀌어버리는 문제가 있어 2026-07-23에
        // 분리함. 완전자동/예약 발행이 쓰는 전역 설정은 이제 환경설정 →
        // 자동화 루프 탭에서 별도로 관리하고, 이 화면의 체크박스는 항상
        // 기본값(해제=headlessMode true)에서 시작해 발행할 때마다 직접
        // 선택하는 방식으로 동작(발행 성공 시 다시 기본값으로 리셋 —
        // doPublishNow/doScheduleSubmit 참고).
      }
    });
  }, []);

  // 계정 목록 — 글 생성 화면이 활성화될 때마다 최신화
  useEffect(() => {
    if (pathname === '/post-create') {
      window.electronAPI.account.getAll().then(res => {
        if (res.success) setAccounts(res.accounts);
      });
    }
  }, [pathname]);

  // 계정 선택 시 블로그 카테고리 자동 로드
  useEffect(() => {
    if (!accountId) {
      setBlogCategories([]);
      setPublishCategory('');
      setCategoryError(false);
      return;
    }
    setCategoriesLoading(true);
    setBlogCategories([]);
    setCategoryError(false);
    // 2026-07-07: 검수 대기에서 넘어온 카테고리가 대기 중이면(pendingCategoryRef)
    // 빈 값 대신 그 값으로 초기화 — 아래 카테고리 목록 로딩 완료 후 한 번 더
    // 확정 적용한다.
    setPublishCategory(pendingCategoryRef.current || '');
    window.electronAPI.blog.getCategories(Number(accountId)).then(res => {
      setCategoriesLoading(false);
      if (res.success && res.categories && res.categories.length > 0) {
        setBlogCategories(res.categories);
      } else if (!res.success) {
        // 2026-07-22 신규: 로드 실패는 지금까지 전부 세션 만료가 원인이었음
        setCategoryError(true);
      }
      if (pendingCategoryRef.current) {
        setPublishCategory(pendingCategoryRef.current);
        pendingCategoryRef.current = null;
      }
    }).catch(() => {
      setCategoriesLoading(false);
      setCategoryError(true);
    });
  }, [accountId]);

  // 2026-07-07 신규: 검수 대기 화면에서 "글 생성으로 이동"으로 넘어온 글
  // 프리필 — location.state.reviewPost가 있으면 각 입력값을 채운다.
  // 2026-07-24 수정: "글 생성" 화면은 다른 페이지로 이동해도 입력 중이던
  // 내용이 사라지지 않도록 항상 마운트 상태를 유지하고 CSS로만 보이기/
  // 숨기기 한다(MainLayout.jsx). 원래는 의존성 배열을 비워 "이 컴포넌트가
  // 처음 마운트될 때 딱 한 번만" 실행했는데, 컴포넌트가 항상 마운트돼
  // 있다 보니 앱 켠 뒤 "글 생성" 화면을 한 번이라도 거쳐가면 그 다음부터는
  // 검수 대기에서 넘어와도 이 effect가 다시 실행되지 않아 빈 화면으로
  // 보이는 문제가 있었음(테스트로 열기를 반복 사용하며 발견). state를
  // 의존성으로 추가해 "새로운 reviewPost를 담아 navigate할 때마다"
  // 다시 채우도록 수정 — reviewPost가 없는 일반적인 화면 전환(사이드바
  // 클릭 등)은 rp가 없어 그대로 가드에서 걸러지므로 입력 중이던 내용은
  // 여전히 보존된다.
  useEffect(() => {
    const rp = state?.reviewPost;
    if (!rp) return;

    // 2026-08-09 수정: 임시저장 시 함께 저장한 원본 주제(topic)가 있으면
    // 그걸 우선 사용 — 예전에는 저장된 값이 없어 AI가 만든 제목(rp.title)을
    // 대신 채우고 있었음(완전자동/반자동 루프가 만든 검수 대기 글처럼
    // topic이 없는 경우엔 지금처럼 title로 대체).
    setTopic(rp.topic || rp.title || '');
    setKeywords(rp.keywords || '');

    // 2026-08-15 신규: 글감 수집 화면의 "바로 글 생성" 버튼으로 넘어온
    // 경우(rp.autoSuggestKeywords) — 키워드 칸에 주제와 동일한 문구만
    // 채워지면 사용자가 "키워드 자동 생성" 버튼을 또 눌러야 하는 번거로움이
    // 있어, 도착 직후 자동으로 한 번 생성해서 덮어씀(URL 가져오기 기능의
    // handleImportUrl과 동일 패턴 — topic state는 아직 갱신 전이라 rp.topic을
    // 직접 사용, handleSuggestKeywords()를 그대로 호출하면 stale state를
    // 읽어 조용히 실패함). 실패해도 위에서 채운 폴백(키워드=주제)이 그대로
    // 남으므로 글 생성 자체는 계속 진행 가능.
    if (rp.autoSuggestKeywords) {
      const topicForKw = (rp.topic || rp.title || '').trim();
      if (topicForKw) {
        setKwSuggesting(true);
        setKwError('');
        window.electronAPI.post.suggestKeywords({ topic: topicForKw })
          .then(res => {
            if (res.success && res.keywords?.length) {
              setKeywords(res.keywords.join(', '));
              return res.keywords;
            }
            setKwError(res.error || '키워드 생성 실패');
            setTimeout(() => setKwError(''), 4000);
            return [];
          })
          .catch(() => {
            setKwError('키워드 생성 실패');
            setTimeout(() => setKwError(''), 4000);
            return [];
          })
          // 2026-08-15: 키워드 자동 생성 스피너(kwSuggesting)는 여기서 끝냄 —
          // 아래 자동 글 생성까지 이 상태를 물고 있으면 "키워드 자동 생성"
          // 버튼이 전체 글 생성이 끝날 때까지 계속 "생성 중"으로 보여
          // 혼동을 줄 수 있음(글 생성 자체는 별도 generating 스피너가 표시).
          .finally(() => setKwSuggesting(false))
          .then((kwArray) => {
            // 2026-08-15 신규(사용자 요청): 글감 수집 화면 "바로 글 생성"
            // 모달에서 톤까지 골라 넘어온 경우(rp.autoGenerate) — 키워드
            // 자동 생성이 끝나는 대로 이어서 글 생성까지 자동 실행. URL
            // 가져오기(handleImportUrl)와 동일한 체이닝 패턴 — 키워드
            // 생성이 실패해도(kwArray가 비어도) topicForKw 하나로 글 생성은
            // 계속 진행(handleGenerate 내부에서 topic 폴백 처리).
            if (rp.autoGenerate) {
              return handleGenerate({
                topic: topicForKw,
                keywords: (kwArray && kwArray.length) ? kwArray : [topicForKw],
                tone: rp.tone,
              });
            }
          });
      }
    }

    setResult({
      title: rp.title || '',
      // 2026-07-08 신규: 검수 대기 → 글 생성 이동 시 썸네일 전용 문구도 복원
      thumbText: rp.thumbText || '',
      intro: rp.intro || '',
      body: rp.body || '',
      conclusion: rp.conclusion || '',
      hashtags: rp.hashtags || [],
      links: rp.links || [],
    });
    setAutoThumbnail(rp.autoThumbnail !== false);
    setPublishVisibility(rp.visibility || 'public');
    setReviewMemo(rp.memo || '');
    // 2026-08-09 신규: 글 톤/지정 제품명도 함께 복원 — 기존엔 이 두 값이
    // 검수 대기 → 글 생성 이동 시 초기값으로 리셋되던 빈틈이 있었음(리뷰형
    // 톤으로 저장한 글을 불러와도 제휴 광고 게이팅이 어긋날 수 있었음).
    if (rp.tone) setTone(rp.tone);
    setReviewProductName(rp.reviewProductName || '');
    // 2026-08-09 신규: "관련 사이트를 게시글에 삽입" 체크 여부도 함께 복원
    setInsertLinks(!!rp.insertLinks);

    const rpImages = rp.images || [];
    setImages(IMG_POSITIONS.map((pos, i) => ({
      position: pos,
      id:           rpImages[i]?.id || null,
      url:          rpImages[i]?.url || null,
      thumb:        rpImages[i]?.thumb || null,
      alt:          rpImages[i]?.alt || '',
      photographer: rpImages[i]?.photographer || '',
      loading: false,
    })));
    setImgSearched(true);

    if (rp.category) pendingCategoryRef.current = rp.category;
    if (rp.accountId) setAccountId(String(rp.accountId));
  }, [state]);

  // 전체 글 텍스트
  const fullText = result
    ? `${result.title}\n\n${result.intro}\n\n${result.body}\n\n${result.conclusion}`
    : '';

  const kwList = keywords.split(',').map(k => k.trim()).filter(Boolean);
  const charCount = countChars(fullText);
  const densities = calcDensity(fullText, kwList);

  // ── 이미지 자동 검색 ─────────────────────────────────────
  const searchImages = async (kws) => {
    setImgSearched(false);
    setThumbBgIndex(null); // 이미지 전체 재검색 시 이전 썸네일 배경 선택은 초기화
    setInsertSelected(new Set()); // 2026-08-04: 보너스 삽입 선택도 함께 초기화
    setResolvedBonusPoints(null);
    setImages(emptyImages().map(img => ({ ...img, loading: true })));
    const res = await window.electronAPI.image.search({ keywords: kws });
    if (res.success && res.images) {
      setImages(IMG_POSITIONS.map((pos, i) => ({
        position: pos,
        id:           res.images[i]?.id || null,
        url:          res.images[i]?.url || null,
        thumb:        res.images[i]?.thumb || null,
        alt:          res.images[i]?.alt || kws[0] || '',
        photographer: res.images[i]?.photographer || '',
        loading: false,
      })));
    } else {
      setImages(emptyImages());
    }
    setImgSearched(true);
  };

  // ── 이미지 1장 교체 ──────────────────────────────────────
  const handleSwapImage = async (idx) => {
    const excludeIds = images.map(img => img.id).filter(Boolean);
    setImages(prev => prev.map((img, i) => i === idx ? { ...img, loading: true } : img));
    const res = await window.electronAPI.image.swapOne({ keywords: kwList, excludeIds });
    if (res.success && res.image) {
      setImages(prev => prev.map((img, i) => i === idx ? {
        ...img, ...res.image, loading: false,
      } : img));
    } else {
      setImages(prev => prev.map((img, i) => i === idx ? { ...img, loading: false } : img));
    }
  };

  // ── 로컬 이미지 업로드 ────────────────────────────────────
  const handleUploadImage = async (idx) => {
    const res = await window.electronAPI.image.upload();
    if (res.success && res.image) {
      setImages(prev => prev.map((img, i) => i === idx ? {
        ...img, ...res.image, loading: false,
      } : img));
    }
  };

  // ── alt 텍스트 편집 ──────────────────────────────────────
  const handleAltChange = (idx, value) => {
    setImages(prev => prev.map((img, i) => i === idx ? { ...img, alt: value } : img));
  };

  // ── 썸네일 배경 이미지 선택 (2026-07-07 신규) ────────────
  // 이미지 카드를 클릭하면 해당 이미지를 썸네일 배경으로 지정(단일 선택,
  // 라디오 방식) — 같은 카드를 다시 클릭하면 선택 해제(자동 검색으로 복귀).
  const handleSelectThumbBg = (idx) => {
    setThumbBgIndex(prev => (prev === idx ? null : idx));
  };

  // ── 보너스 이미지(추가 5슬롯) 삽입 선택 (2026-08-04 신규) ────
  // 인덱스 5~9(도입부+~마무리+)만 더블클릭으로 토글 가능 — 기존 5개(0~4)는
  // 항상 삽입되므로 선택 대상이 아님. 하나라도 선택되어 있으면 발행 시
  // 그 지점만 정확히 사용하고, 하나도 선택 안 하면 1~5개를 무작위로 사용.
  const handleToggleInsertSelect = (idx) => {
    if (idx < 5) return;
    setInsertSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // 보너스 삽입 지점(0~4, 기존 5곳 기준 인덱스) 계산 — 더블클릭으로 고른
  // 게 있으면 그 지점 그대로, 없으면 1~5개를 무작위로 고름. 미리보기와
  // 실제 발행이 어긋나지 않도록 이 함수는 발행 액션 시점에 한 번만
  // 호출해 resolvedBonusPoints에 저장하고 재사용한다.
  const resolveBonusPoints = () => {
    const manual = [...insertSelected].map(i => i - 5).filter(i => i >= 0 && i <= 4);
    if (manual.length > 0) return manual;
    const pts = [0, 1, 2, 3, 4];
    for (let i = pts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pts[i], pts[j]] = [pts[j], pts[i]];
    }
    const count = 1 + Math.floor(Math.random() * 5); // 1~5
    return pts.slice(0, count);
  };

  // ── 키워드 자동 생성 ──────────────────────────────────────
  const handleSuggestKeywords = async () => {
    if (!topic.trim()) return;
    setKwSuggesting(true);
    setKwError('');
    try {
      const res = await window.electronAPI.post.suggestKeywords({ topic: topic.trim() });
      if (res.success && res.keywords?.length) {
        setKeywords(res.keywords.join(', '));
      } else {
        setKwError(res.error || '키워드 생성 실패');
        setTimeout(() => setKwError(''), 4000);
      }
    } finally {
      setKwSuggesting(false);
    }
  };

  // 2026-07-13 신규: 주제 전환 시 이전에 생성된 글이 남아있어 새 글을
  // 준비하기 불편하다는 요청으로 추가 — 생성된 글/주제/키워드/해시태그를
  // 한 번에 초기화. 되돌릴 수 없는 동작이라 확인창을 거친다.
  const handleReset = () => {
    if (!window.confirm('생성된 글과 주제·키워드·해시태그를 모두 초기화할까요?\n이 작업은 되돌릴 수 없습니다.')) return;
    setResult(null);
    setTopic('');
    setKeywords('');
    setHashtagInput('');
    setErrorMsg('');
    setPublishMsg('');
    // 2026-07-29 신규: 가져온 참고 URL 본문도 함께 초기화
    setSourceMaterial(null);
    setShowUrlImport(false);
    setImportUrl('');
    setImportError('');
    setImportToast(false);
    // 2026-08-07 신규: 지정했던 리뷰 제품명도 함께 초기화
    setReviewProductName('');
    // 2026-08-09 신규: 관련 사이트 삽입 체크박스도 기본값(해제)으로 초기화
    setInsertLinks(false);
  };

  // ── [개발자 전용 테스트] URL 글 가져오기 ──────────────────
  // 2026-07-29 수정(사용자 요청): 원문만 가져와서 대기하는 게 아니라,
  // (1) 원문을 대표하는 짧은 주제(11자 이내, 백엔드에서 생성)로 "주제"
  // 입력칸을 자동으로 채우고, (2) 그 주제로 기존 "키워드 자동 생성"
  // 기능을 재사용해 "키워드"도 자동으로 채우고, (3) 글 톤은 "정보형"으로
  // 고정한 뒤, (4) 곧바로 글 생성까지 자동으로 트리거해서 결과를 미리보기
  // 화면에 바로 보여준다. topic/keywords/tone/sourceMaterial state는
  // setState 직후 곧바로 읽으면 갱신 전 값일 수 있어, handleGenerate에는
  // state가 아니라 여기서 만든 값을 override로 명시해서 넘긴다.
  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      const res = await window.electronAPI.dev.fetchUrlText({ url: importUrl.trim() });
      if (res.success) {
        const shortTopic = (res.topic && res.topic.trim()) || (res.title || '').trim().slice(0, 11) || topic;
        // 2026-08-04 신규: 모달에서 고른 톤(importTone)을 sourceMaterial에
        // 함께 저장 — "주제" 화면의 고정 힌트 문구가 실제 선택된 톤을
        // 정확히 표시하도록 함(하드코딩된 '정보형' 대신).
        const material = { url: res.url, title: res.title || '', text: res.text || '', tone: importTone };

        // 키워드 자동 생성 — 기존 "✦ 키워드 자동 생성" 기능과 동일한 IPC 재사용
        let kwArray = [];
        try {
          const kwRes = await window.electronAPI.post.suggestKeywords({ topic: shortTopic });
          if (kwRes.success && kwRes.keywords?.length) kwArray = kwRes.keywords;
        } catch (e) {
          // 키워드 자동 생성이 실패해도 글 생성 자체는 계속 진행(참고 자료만으로도 충분)
        }

        // 화면에도 반영(사용자가 결과 확인 가능하도록) — 실제 생성 호출은 아래 override로 진행
        setTopic(shortTopic);
        setKeywords(kwArray.join(', '));
        setTone(importTone);
        setSourceMaterial(material);
        setShowUrlImport(false);
        setImportUrl('');

        // 3초 후 자동으로 사라지는 알림(사용자 요청 — 배지의 × 대신 토스트로 변경)
        setImportToast(true);
        setTimeout(() => setImportToast(false), 3000);

        // 원문을 재가공해서 곧바로 글 생성 — 완료되면 기존 generating 스피너와
        // 동일하게 진행 상태가 표시되고, 끝나면 결과가 미리보기에 나타난다.
        await handleGenerate({ topic: shortTopic, keywords: kwArray, tone: importTone, sourceMaterial: material });
      } else {
        setImportError(res.error || '가져오기 실패');
      }
    } finally {
      setImporting(false);
    }
  };

  // ── 글 생성 ──────────────────────────────────────────────
  // 2026-07-29 수정: "글 가져오기" 자동 생성 흐름에서 setTopic/setKeywords/
  // setTone 직후 곧바로 글 생성을 트리거해야 하는데, React state 갱신은
  // 비동기라 이 시점에 topic/kwList/tone/sourceMaterial state를 그대로
  // 읽으면 이전 값(빈 값)이 잡히는 문제가 있음. overrides 인자로 명시적
  // 값을 넘길 수 있게 해서 이 경우엔 state 대신 override 값을 사용하고,
  // 기존처럼 버튼 클릭으로 호출될 때는 override 없이 현재 state를 그대로
  // 사용(동작 변경 없음).
  const handleGenerate = async (overrides = {}) => {
    const genTopic = overrides.topic !== undefined ? overrides.topic : topic;
    const genKeywords = overrides.keywords !== undefined ? overrides.keywords : kwList;
    const genTone = overrides.tone !== undefined ? overrides.tone : tone;
    const genSourceMaterial = overrides.sourceMaterial !== undefined ? overrides.sourceMaterial : sourceMaterial;
    if (!genTopic || !genTopic.trim()) return;
    setGenerating(true);
    setEditMode(false);
    setImages(emptyImages());
    setImgSearched(false);
    setErrorMsg('');
    try {
      const res = await window.electronAPI.post.generate({
        topic: genTopic, keywords: genKeywords, tone: genTone, writingStyle, personalExp, sentenceStyle, targetMin, targetMax,
        // 2026-07-29 신규(개발자 전용 테스트 기능): "글 가져오기"로 가져온
        // 외부 URL 본문이 있으면 참고 자료로 함께 전달
        sourceMaterial: genSourceMaterial || undefined,
      });
      if (res.success) {
        setResult(res.result);
        const kws = genKeywords.length ? genKeywords : [genTopic];
        searchImages(kws);
      } else {
        setErrorMsg(res.error || '알 수 없는 오류가 발생했습니다.');
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── 섹션별 재생성 ─────────────────────────────────────────
  const handleRegenSection = async (section) => {
    setRegenSection(section);
    try {
      const res = await window.electronAPI.post.regenerateSection({
        section, topic, keywords: kwList, tone, writingStyle, personalExp, sentenceStyle,
        currentResult: result,
      });
      if (res.success) {
        if (section === 'title' || section === 'thumbText') {
          // 안전장치(2026-07-03): 프롬프트를 지켜도 AI가 간혹 마크다운을 섞어
          // 낼 수 있어, 제목만은 첫 번째 비어있지 않은 줄 + 마크다운 마커
          // 제거까지 한 번 더 방어적으로 정리한다.
          // 2026-07-08: 썸네일 문구도 동일하게 한 줄 평문이어야 하므로 같은
          // 안전장치를 재사용.
          const cleaned = (res.text || '')
            .split('\n')
            .map(l => l.replace(/^#{1,4}\s*/, '').replace(/^▪\s*/, '').trim())
            .filter(Boolean)[0] || res.text;
          setResult(prev => ({ ...prev, [section]: cleaned }));
        } else {
          setResult(prev => ({ ...prev, [section]: res.text }));
        }
      }
    } finally {
      setRegenSection(null);
    }
  };

  // ── 전체 복사 ─────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(editMode ? editContent : fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── 발행 전 미리보기 (2026-07-07 신규) ────────────────────
  // "미리보기" 체크박스가 켜져 있을 때, 즉시발행/예약발행을 실제로
  // 실행하기 전에 main 프로세스에서 썸네일·본문 스타일을 확정해 미리
  // 보여준다. action: 'now' | 'schedule' — 미리보기 확인 시 이어서 실행할
  // 발행 동작을 함께 기억해둔다.
  const requestPreview = async (action) => {
    setPreviewLoading(true);
    // 2026-08-04 신규: 보너스 이미지 삽입 지점을 여기서 한 번만 계산해
    // 고정 — 미리보기 렌더링과 실제 발행이 같은 지점을 쓰도록 보장.
    const bonusPts = resolveBonusPoints();
    setResolvedBonusPoints(bonusPts);
    try {
      const res = await window.electronAPI.post.renderPreview({
        title: result.title,
        // 2026-07-08 신규: 썸네일 전용 문구 — 있으면 제목 대신 썸네일에 사용
        thumbText: result.thumbText || '',
        intro: result.intro,
        body: result.body,
        conclusion: result.conclusion,
        // 2026-08-09 신규: "게시글에 삽입" 체크박스가 해제돼 있으면 미리보기에도
        // 관련 사이트를 빼서, 실제 발행 결과와 미리보기가 어긋나지 않게 함.
        links: insertLinks && Array.isArray(result.links) ? result.links : [],
        hashtags: hashtagList,
        autoThumbnail: autoThumbnail,
        // 2026-07-07: 이미지 카드를 클릭해 썸네일 배경을 직접 선택한 경우 전달
        // — 선택 안 했으면 undefined로 넘어가 기존 자동 검색 그대로 사용
        thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
        // 2026-07-23 신규: 제휴 광고가 "리뷰형" 톤에서만 미리보기에도 반영되도록 전달
        tone,
        // 2026-08-07 신규: 리뷰형에서 사용자가 지정한 제품명 — 있으면 제목 대신 우선 사용
        reviewProductName: reviewProductName || undefined,
        // 2026-08-19 신규: 쿠팡 subId(계정별 채널 구분)를 실제 발행과 동일하게
        // 미리보기에도 반영하기 위해 선택된 계정 ID 전달
        accountId: accountId ? Number(accountId) : undefined,
      });
      if (res.success) {
        setPreviewData(res);
        setPreviewPendingAction(action);
        setPreviewModalOpen(true);
      } else {
        setPublishMsg(`⚠️ 미리보기 생성 실패: ${res.error || '알 수 없는 오류'}`);
        setTimeout(() => setPublishMsg(''), 5000);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  // 미리보기 모달에서 "이대로 발행"을 눌렀을 때 — 미리보기에서 이미 만든
  // 썸네일/확정 색상 프리셋을 그대로 실제 발행에 재사용해, 미리 본 결과와
  // 실제 발행 결과가 달라지지 않도록 한다.
  const confirmPreviewAndPublish = async () => {
    const forcedThumbPath = previewData?.thumbTempPath || null;
    const forcedStyleIndex = previewData?.resolvedStyleIndex != null ? previewData.resolvedStyleIndex : null;
    // 2026-07-24 신규: 색상(forcedStyleIndex)과 별도로 구조(forcedLayoutId)도
    // 미리보기에서 확정된 값을 그대로 재사용해 실제 발행 결과가 미리보기와
    // 어긋나지 않도록 함.
    const forcedLayoutId = previewData?.resolvedLayoutId != null ? previewData.resolvedLayoutId : null;
    // 2026-08-04 신규: 미리보기에서 확정한 보너스 이미지 지점을 그대로 재사용
    const forcedBonusPoints = resolvedBonusPoints;
    const action = previewPendingAction;
    setPreviewModalOpen(false);
    setPreviewData(null);
    setPreviewPendingAction(null);
    if (action === 'schedule') await doScheduleSubmit(forcedThumbPath, forcedStyleIndex, forcedLayoutId, forcedBonusPoints);
    else await doPublishNow(forcedThumbPath, forcedStyleIndex, forcedLayoutId, forcedBonusPoints);
  };

  // 2026-07-24 신규(개발자 전용): 미리보기 모달에서 "테스트" — 실제 발행과
  // 완전히 동일하게 네이버 에디터 자동화를 끝까지 수행하되 마지막 "발행"
  // 버튼만 누르지 않고 멈춘다. 실제로 게시되지 않으므로 삭제할 필요가
  // 없고, 반복해서 눌러도 계정에 영향이 없다.
  const confirmPreviewAndTest = async () => {
    const forcedThumbPath = previewData?.thumbTempPath || null;
    const forcedStyleIndex = previewData?.resolvedStyleIndex != null ? previewData.resolvedStyleIndex : null;
    const forcedLayoutId = previewData?.resolvedLayoutId != null ? previewData.resolvedLayoutId : null;
    const forcedBonusPoints = resolvedBonusPoints;
    setPreviewModalOpen(false);
    setPreviewData(null);
    setPreviewPendingAction(null);
    await doTestPublish(forcedThumbPath, forcedStyleIndex, forcedLayoutId, forcedBonusPoints);
  };

  // 2026-08-09 신규: 발행 전 미리보기 모달에서 "임시저장" — 이미 AI 토큰을
  // 써서 생성한 글을, 기능 추가/버그 수정으로 앱을 재시작해야 할 때
  // 다시 생성하지 않고 재사용할 수 있도록 검수 대기(status='review')로
  // 저장한다. 반자동/완전자동 루프가 검수 대기 글을 저장하는 것과 동일한
  // 방식(main.js post:saveDraft)을 재사용 — 저장 후 검수 대기 화면으로
  // 이동하면, 나중에 "글 생성으로 이동"/"테스트로 열기"로 AI 재호출 없이
  // 그대로 불러올 수 있다.
  const handleSaveDraft = async () => {
    if (!result) return;
    setSavingDraft(true);
    setPublishMsg('');
    try {
      const res = await window.electronAPI.post.saveDraft({
        accountId: Number(accountId),
        post: {
          title: result.title,
          thumbText: result.thumbText || '',
          intro: result.intro,
          body: result.body,
          conclusion: result.conclusion,
          // 2026-08-09: 임시저장은 "게시글에 삽입" 체크 여부와 무관하게 AI가
          // 생성한 관련 사이트 원본을 그대로 저장(체크 상태 자체는 insertLinks로 별도 저장)
          links: Array.isArray(result.links) ? result.links : [],
          insertLinks,
          hashtags: hashtagList,
          images: images.map(img => ({ id: img.id, url: img.url, thumb: img.thumb, alt: img.alt, photographer: img.photographer })),
          category: publishCategory.trim(),
          visibility: publishVisibility,
          autoThumbnail: autoThumbnail,
          tone,
          reviewProductName: reviewProductName || undefined,
          // 2026-08-09 신규: 사용자가 입력한 원본 주제/키워드도 함께 저장
          topic,
          keywords,
        },
      });
      if (res.success) {
        setPreviewModalOpen(false);
        setPreviewData(null);
        setPreviewPendingAction(null);
        navigate('/review-queue');
      } else {
        setPublishMsg(`⚠️ 임시저장 실패: ${res.error || '알 수 없는 오류'}`);
        setTimeout(() => setPublishMsg(''), 5000);
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const doTestPublish = async (forcedThumbPath, forcedStyleIndex, forcedLayoutId, forcedBonusPoints) => {
    setTesting(true);
    setPublishMsg('');
    const bonusPts = forcedBonusPoints || resolvedBonusPoints || resolveBonusPoints();
    try {
      const res = await window.electronAPI.publish.test({
        accountId: Number(accountId),
        post: {
          title: result.title,
          thumbText: result.thumbText || '',
          intro: result.intro,
          body: result.body,
          conclusion: result.conclusion,
          // 2026-08-09 신규: "게시글에 삽입" 체크박스 해제 시 실제 발행과
          // 동일하게 관련 사이트를 빼서 테스트
          links: insertLinks && Array.isArray(result.links) ? result.links : [],
          hashtags: hashtagList,
          images: images.map(img => ({ url: img.url, alt: img.alt })),
          category: publishCategory.trim(),
          visibility: publishVisibility,
          autoThumbnail: autoThumbnail,
          forcedThumbPath: forcedThumbPath || undefined,
          forcedStyleIndex: forcedStyleIndex != null ? forcedStyleIndex : undefined,
          forcedLayoutId: forcedLayoutId != null ? forcedLayoutId : undefined,
          thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
          bonusPoints: bonusPts,
          // 2026-08-07 신규: 리뷰형에서 사용자가 지정한 제품명 — 있으면 제목 대신 우선 사용
          reviewProductName: reviewProductName || undefined,
          tone,
        },
      });
      if (res.success) {
        setPublishMsg('🧪 테스트 창이 열렸습니다 — 발행 버튼은 누르지 않았습니다. 검사(우클릭→검사)로 확인 후 창을 직접 닫아주세요.');
      } else {
        setPublishMsg(`⚠️ ${res.error || '테스트 오류'}`);
      }
    } finally {
      setTesting(false);
      setTimeout(() => setPublishMsg(''), 8000);
    }
  };

  // ── 즉시 발행 ─────────────────────────────────────────────
  const handlePublishNow = async () => {
    if (!accountId) { setPublishMsg('⚠️ 발행 계정을 선택해주세요.'); setTimeout(() => setPublishMsg(''), 3000); return; }
    if (!result) return;
    if (previewEnabled) { await requestPreview('now'); return; }
    await doPublishNow(null, null, null, null);
  };

  const doPublishNow = async (forcedThumbPath, forcedStyleIndex, forcedLayoutId, forcedBonusPoints) => {
    setPublishing(true);
    setPublishMsg('');
    // 2026-08-04 신규: 미리보기를 거치지 않은 경우(previewEnabled=false)엔
    // 여기서 처음으로 보너스 지점을 계산 — 이전 발행에서 남은 값을 그대로
    // 재사용하지 않도록 forcedBonusPoints > resolvedBonusPoints > 새로 계산 순.
    const bonusPts = forcedBonusPoints || resolvedBonusPoints || resolveBonusPoints();
    try {
      const res = await window.electronAPI.publish.now({
        accountId: Number(accountId),
        post: {
          title: result.title,
          // 2026-07-08 신규: 썸네일 전용 문구 — 있으면 제목 대신 썸네일에 사용
          thumbText: result.thumbText || '',
          intro: result.intro,
          body: result.body,
          conclusion: result.conclusion,
          // 2026-08-09 신규: "게시글에 삽입" 체크박스가 해제돼 있으면 관련 사이트를 뺌
          links: insertLinks && Array.isArray(result.links) ? result.links : [],
          hashtags: hashtagList,
          images: images.map(img => ({ url: img.url, alt: img.alt })),
          category: publishCategory.trim(),
          visibility: publishVisibility,
          headless: headlessMode,
          autoThumbnail: autoThumbnail,
          forcedThumbPath: forcedThumbPath || undefined,
          forcedStyleIndex: forcedStyleIndex != null ? forcedStyleIndex : undefined,
          forcedLayoutId: forcedLayoutId != null ? forcedLayoutId : undefined,
          // 2026-07-07: 미리보기 없이 바로 발행(previewEnabled=false)한 경우에도
          // 선택한 썸네일 배경이 반영되도록 전달
          thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
          // 2026-07-23 신규: 제휴 광고가 "리뷰형" 톤에서만 삽입되도록 전달
          tone,
          bonusPoints: bonusPts,
          // 2026-08-07 신규: 리뷰형에서 사용자가 지정한 제품명 — 있으면 제목 대신 우선 사용
          reviewProductName: reviewProductName || undefined,
        },
      });
      if (res.success) {
        setPublishMsg('✓ 발행이 완료되었습니다.');
        // 2026-07-23 신규: 발행 성공 시 공개 설정·브라우저 표시를 기본값으로
        // 리셋(사용자 요청) — 다음 글에는 매번 새로 선택하도록 함.
        setPublishVisibility('public');
        setHeadlessMode(true);
      } else {
        setPublishMsg(`⚠️ ${res.error || '발행 오류'}`);
      }
    } finally {
      setPublishing(false);
      setTimeout(() => setPublishMsg(''), 6000);
    }
  };

  // ── 예약 발행: 예약 가능한 가장 빠른 시각 조회 (2026-07-03) ──
  // 모달이 열려있고 계정이 선택되어 있는 동안, 계정이 바뀔 때마다
  // 최소 예약 가능 시각을 다시 조회해 날짜/시간 입력의 min으로 사용한다.
  useEffect(() => {
    if (!showScheduleModal || !accountId) return;
    let cancelled = false;
    setEarliestSlotLoading(true);
    window.electronAPI.publish.getEarliestSlot({ accountId: Number(accountId) }).then(res => {
      if (cancelled || !res.success) return;
      setEarliestSlot(res.earliestAt);
      const eDate = res.earliestAt.slice(0, 10);
      setScheduleDate(prev => (!prev || prev < eDate) ? eDate : prev);
    }).finally(() => { if (!cancelled) setEarliestSlotLoading(false); });
    return () => { cancelled = true; };
  }, [showScheduleModal, accountId]);

  // 선택된 날짜가 최소 가능 날짜와 같아지면, 시간도 최소 가능 시각 이후로 보정
  // (네이버 예약 분 선택은 10분 단위만 지원하므로, 보정 값도 10분 단위로 올림)
  useEffect(() => {
    if (!earliestSlot) return;
    const eDate = earliestSlot.slice(0, 10);
    const eTime = earliestSlot.slice(11, 16);
    if (scheduleDate === eDate && scheduleTime < eTime) {
      const [eh, em] = eTime.split(':').map(Number);
      let totalMin = Math.ceil((eh * 60 + em) / 10) * 10;
      const rh = Math.floor(totalMin / 60) % 24;
      const rm = totalMin % 60;
      setScheduleTime(`${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`);
    }
  }, [scheduleDate, earliestSlot]);

  // ── 예약 발행 ─────────────────────────────────────────────
  // (2026-07-03) "예약 등록" 클릭 즉시 네이버 에디터를 열어 즉시발행과
  // 동일하게 전체 자동화를 수행하고, 마지막에 네이버 자체 예약 기능으로
  // 등록한다 — 앱/PC가 꺼져 있어도 네이버가 예약 시각에 발행하도록 하기 위함.
  // 그래서 즉시발행과 동일한 필드(category/visibility/headless/autoThumbnail/
  // links)를 함께 넘긴다.
  const handleScheduleSubmit = async () => {
    if (!accountId) { setPublishMsg('⚠️ 발행 계정을 선택해주세요.'); setTimeout(() => setPublishMsg(''), 3000); return; }
    if (!scheduleDate) { setPublishMsg('⚠️ 날짜를 선택해주세요.'); setTimeout(() => setPublishMsg(''), 3000); return; }
    if (!result) return;
    // 2026-07-07: 미리보기 체크박스가 켜져 있으면, 날짜/시간 선택 모달을
    // 닫고 먼저 미리보기를 보여준 뒤 확인 시에만 실제 예약 등록을 진행한다.
    if (previewEnabled) {
      setShowScheduleModal(false);
      await requestPreview('schedule');
      return;
    }
    await doScheduleSubmit(null, null, null, null);
  };

  const doScheduleSubmit = async (forcedThumbPath, forcedStyleIndex, forcedLayoutId, forcedBonusPoints) => {
    const scheduledAt = `${scheduleDate}T${scheduleTime}`;
    setScheduling(true);
    const bonusPts = forcedBonusPoints || resolvedBonusPoints || resolveBonusPoints();
    try {
      const res = await window.electronAPI.publish.schedule({
        accountId: Number(accountId),
        post: {
          title: result.title,
          // 2026-07-08 신규: 썸네일 전용 문구 — 있으면 제목 대신 썸네일에 사용
          thumbText: result.thumbText || '',
          intro: result.intro,
          body: result.body,
          conclusion: result.conclusion,
          // 2026-08-09 신규: "게시글에 삽입" 체크박스가 해제돼 있으면 관련 사이트를 뺌
          links: insertLinks && Array.isArray(result.links) ? result.links : [],
          hashtags: hashtagList,
          images: images.map(img => ({ url: img.url, alt: img.alt })),
          category: publishCategory.trim(),
          visibility: publishVisibility,
          headless: headlessMode,
          autoThumbnail: autoThumbnail,
          forcedThumbPath: forcedThumbPath || undefined,
          forcedStyleIndex: forcedStyleIndex != null ? forcedStyleIndex : undefined,
          forcedLayoutId: forcedLayoutId != null ? forcedLayoutId : undefined,
          thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
          // 2026-07-23 신규: 제휴 광고가 "리뷰형" 톤에서만 삽입되도록 전달
          tone,
          bonusPoints: bonusPts,
          // 2026-08-07 신규: 리뷰형에서 사용자가 지정한 제품명 — 있으면 제목 대신 우선 사용
          reviewProductName: reviewProductName || undefined,
        },
        scheduledAt,
      });
      if (res.success) {
        setShowScheduleModal(false);
        setPublishMsg(`✓ ${scheduleDate} ${scheduleTime} 네이버 예약 등록 완료`);
        setTimeout(() => setPublishMsg(''), 5000);
        // 2026-07-23 신규: 예약 등록도 발행과 동일하게 즉시 브라우저 자동화가
        // 실행되므로(설계상 "1회 발행"과 동일) 공개 설정·브라우저 표시를 기본값으로 리셋
        setPublishVisibility('public');
        setHeadlessMode(true);
      } else {
        // 오류 시 모달을 다시 열어 사용자가 시각 수정 후 재시도할 수 있도록
        setShowScheduleModal(true);
        setPublishMsg(`⚠️ ${res.error || '예약 오류'}`);
        setTimeout(() => setPublishMsg(''), 7000);
      }
    } finally {
      setScheduling(false);
    }
  };

  // ── 단어 교체 ────────────────────────────────────────────
  // 2026-07-29 수정(실사용 지적 — 치환은 되는데 항상 "0건 교체"로 표시됨):
  // 기존엔 rep()가 setResult(prev => ({...}))의 콜백 안에서 실행됐는데,
  // 이 콜백은 setResult() 호출 시점에 즉시 실행되는 게 아니라 React가
  // 나중에(다음 렌더링 처리 시점에) 실행함. 그런데 바로 다음 줄의
  // setReplaceCount(count)는 그 자리에서 즉시 실행되므로, count가 실제로
  // 계산되기 전(초기값 0)을 항상 읽어서 표시하고 있었음 — 텍스트 치환
  // 자체는 나중에 정상 반영되지만 개수 표시만 항상 0이 되는 구조적
  // 버그. 개수 계산을 setResult() 호출 전에 동기적으로 먼저 끝내고, 그
  // 결과를 setResult()/setReplaceCount() 양쪽에 나눠 넘기도록 순서 수정.
  const handleReplace = () => {
    if (!replaceFrom.trim() || !result) return;
    const regex = new RegExp(replaceFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    let count = 0;
    const rep = (text) => {
      if (!text) return text;
      const matches = text.match(regex);
      count += matches ? matches.length : 0;
      return text.replace(regex, replaceTo);
    };
    const nextResult = {
      ...result,
      title:      rep(result.title),
      // 2026-07-08 신규: 썸네일 전용 문구도 찾아바꾸기 대상에 포함
      thumbText:  rep(result.thumbText || ''),
      intro:      rep(result.intro),
      body:       rep(result.body),
      conclusion: rep(result.conclusion),
    };
    setResult(nextResult);
    setReplaceCount(count);
    setTimeout(() => setReplaceCount(null), 2500);
  };

  // ── 편집 모드 진입 / 종료 ─────────────────────────────────
  const enterEdit = () => setEditMode(true);
  const exitEdit  = () => setEditMode(false);

  // ── 해시태그 편집 ─────────────────────────────────────────
  const [hashtagInput, setHashtagInput] = useState('');
  useEffect(() => {
    if (result?.hashtags) {
      // AI가 # 없이 반환하는 경우에도 정상 표시되도록 클라이언트측 정규화
      const normalized = result.hashtags
        .map(t => { t = String(t || '').replace(/\r\n?/g, '').trim(); return t.startsWith('#') ? t : '#' + t; })
        .filter(t => t.length > 1)
        .join(' ');
      setHashtagInput(normalized);
    }
  }, [result?.hashtags]);

  const removeTag = (tag) => {
    const tags = hashtagInput.replace(/\r\n?/g, ' ').split(/[\s,，]+/).filter(t => t !== tag);
    setHashtagInput(tags.join(' '));
  };

  // Windows \r\n 및 콤마 구분자 모두 처리
  const hashtagList = hashtagInput
    .replace(/\r\n?/g, ' ')
    .split(/[\s,，]+/)
    .map(t => t.trim())
    .filter(t => t.startsWith('#') && t.length > 1);

  return (
    <div className="post-create">
      <div className="page-header post-create-header">
        <div>
          <h1>글 생성</h1>
          <p>주제와 키워드를 입력하면 AI가 SEO 최적화 글을 자동으로 생성합니다.</p>
        </div>
        <button className="btn btn-ghost" onClick={handleReset} title="생성된 글과 주제·키워드·해시태그를 초기화합니다">
          초기화
        </button>
      </div>

      <div className="post-create-layout">
        {/* ── 상단: 미리보기 (70%) ────────────────────────────── */}
        <div className="post-preview-col">
          {!result && !generating ? (
            <div className="card preview-empty-card preview-fill">
              {errorMsg ? (
                <div className="preview-empty">
                  {errorMsg.startsWith('⏳') ? (
                    /* Rate Limit 전용 카드 */
                    <div style={{
                      background: 'linear-gradient(135deg, rgba(234,179,8,0.12) 0%, rgba(234,179,8,0.04) 100%)',
                      border: '1.5px solid rgba(234,179,8,0.45)',
                      borderRadius: 14,
                      padding: '24px 28px',
                      maxWidth: 440,
                      textAlign: 'left',
                    }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
                      <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
                        Groq API 사용 한도 초과
                      </p>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', marginBottom: 16 }}>
                        {errorMsg.split('\n').slice(2).join('\n')}
                      </p>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => { setErrorMsg(''); navigate('/settings'); }}>
                          ⚙️ 환경설정 이동
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setErrorMsg('')}>닫기</button>
                      </div>
                    </div>
                  ) : (
                    /* 일반 오류 카드 */
                    <>
                      <div className="preview-empty-icon">⚠️</div>
                      <p style={{ color: 'var(--danger)', fontWeight: 600 }}>글 생성 오류</p>
                      <p className="empty-sub" style={{ whiteSpace: 'pre-wrap', textAlign: 'center', maxWidth: 420, color: 'var(--text-secondary)' }}>{errorMsg}</p>
                      <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setErrorMsg('')}>닫기</button>
                    </>
                  )}
                </div>
              ) : (
                <div className="preview-empty">
                  <div className="preview-empty-icon">✍️</div>
                  <p>글을 생성하면 여기에 표시됩니다.</p>
                  <p className="empty-sub">주제와 키워드를 입력하고 글 생성 버튼을 눌러주세요.</p>
                </div>
              )}
            </div>
          ) : generating ? (
            <div className="card preview-empty-card preview-fill">
              <div className="preview-empty">
                <div className="gen-spinner" />
                <p>AI가 글을 작성하고 있습니다…</p>
                <p className="empty-sub">잠시만 기다려 주세요 (10~30초)</p>
              </div>
            </div>
          ) : (
            <>
              {/* 2026-07-07 신규: 검수 대기에서 넘어온 글이면 누락 사유 배너 표시 */}
              {reviewMemo && (
                <div className="review-import-banner">
                  ✏️ 검수 대기에서 불러온 글입니다 — {reviewMemo}
                </div>
              )}

              {/* 툴바 */}
              <div className="preview-toolbar">
                <div className="preview-stats">
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                    <span className={`char-count ${charCount < targetMin ? 'warn' : charCount > targetMax ? 'over' : 'ok'}`}>
                      현재 {charCount.toLocaleString()}자
                    </span>
                    <span className="char-target">목표 {targetMin.toLocaleString()}~{targetMax.toLocaleString()}자</span>
                  </div>
                  {densities.length > 0 && (
                    <button
                      className="btn btn-ghost btn-xs kw-density-btn"
                      onClick={() => setShowDensity(v => !v)}
                      title="키워드 밀도 보기"
                    >
                      키워드 밀도 {densities.length}개
                    </button>
                  )}
                </div>
                <div className="preview-actions">
                  {!editMode ? (
                    <button className="btn btn-ghost btn-sm" onClick={enterEdit}>직접 편집</button>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={exitEdit}>편집 완료</button>
                  )}
                  {!editMode && (
                    <button
                      className={`btn btn-sm ${showReplace ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setShowReplace(v => !v)}
                    >단어 교체</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                    <CopyIcon />{copied ? '복사됨!' : '복사'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleGenerate()} disabled={generating}>
                    <RefreshIcon />전체 재생성
                  </button>
                </div>
              </div>

              {/* 키워드 밀도 팝업 */}
              {showDensity && densities.length > 0 && (
                <div className="density-popup-overlay" onClick={() => setShowDensity(false)}>
                  <div className="density-popup" onClick={e => e.stopPropagation()}>
                    <div className="density-popup-header">
                      <span className="density-popup-title">키워드 밀도</span>
                      <button className="density-popup-close" onClick={() => setShowDensity(false)}>✕</button>
                    </div>
                    <div className="density-popup-body">
                      {densities.map(d => {
                        const pct = parseFloat(d.density);
                        const barW = Math.min(pct * 10, 100);
                        const color = pct < 0.5 ? 'var(--text-muted)' : pct > 3 ? 'var(--danger)' : 'var(--success)';
                        return (
                          <div key={d.kw} className="density-row">
                            <span className="density-kw">{d.kw}</span>
                            <div className="density-bar-wrap">
                              <div className="density-bar" style={{ width: `${barW}%`, background: color }} />
                            </div>
                            <span className="density-pct" style={{ color }}>{d.density}%</span>
                            <span className="density-count">({d.count}회)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 단어 교체 바 */}
              {showReplace && !editMode && (
                <div className="replace-bar">
                  <input
                    className="input"
                    placeholder="찾을 단어"
                    value={replaceFrom}
                    onChange={e => setReplaceFrom(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleReplace()}
                  />
                  <span className="replace-arrow">→</span>
                  <input
                    className="input"
                    placeholder="바꿀 단어"
                    value={replaceTo}
                    onChange={e => setReplaceTo(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleReplace()}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleReplace} disabled={!replaceFrom.trim()}>
                    교체
                  </button>
                  {replaceCount !== null && (
                    <span className="replace-count-badge">✓ {replaceCount}건 교체됨</span>
                  )}
                  <button
                    className="btn btn-ghost btn-xs"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => { setShowReplace(false); setReplaceFrom(''); setReplaceTo(''); setReplaceCount(null); }}
                  >✕</button>
                </div>
              )}

              {/* 섹션별 보기 / 인라인 편집 */}
              <div className="preview-sections">
                <SectionCard
                  label="제목" content={result.title} section="title"
                  onRegen={handleRegenSection} regenSection={regenSection}
                  editMode={editMode}
                  onEdit={v => setResult(p => ({ ...p, title: v }))}
                  isTitle
                />
                {/* 2026-07-08 신규: 썸네일 이미지에 들어가는 별도 문구 —
                    제목과 동일한 편집/재생성 UX(SectionCard)를 그대로 재사용.
                    핵심 키워드 포함 18~20자, AI가 제목과 별개로 생성. */}
                {tierLimits.thumbnail && (
                  <SectionCard
                    label="썸네일 문구" content={result.thumbText} section="thumbText"
                    onRegen={handleRegenSection} regenSection={regenSection}
                    editMode={editMode}
                    onEdit={v => setResult(p => ({ ...p, thumbText: v }))}
                    isTitle
                  />
                )}
                <SectionCard
                  label="도입부" content={result.intro} section="intro"
                  onRegen={handleRegenSection} regenSection={regenSection}
                  editMode={editMode}
                  onEdit={v => setResult(p => ({ ...p, intro: v }))}
                />
                <SectionCard
                  label="본문" content={result.body} section="body"
                  onRegen={handleRegenSection} regenSection={regenSection}
                  editMode={editMode}
                  onEdit={v => setResult(p => ({ ...p, body: v }))}
                />
                <SectionCard
                  label="마무리" content={result.conclusion} section="conclusion"
                  onRegen={handleRegenSection} regenSection={regenSection}
                  editMode={editMode}
                  onEdit={v => setResult(p => ({ ...p, conclusion: v }))}
                />
              </div>

              {/* 해시태그 */}
              <div className="card hashtag-card">
                <div className="hashtag-header">
                  <span className="panel-title" style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
                    해시태그 <span className="label-hint">({hashtagList.length}/30)</span>
                  </span>
                </div>
                <div className="hashtag-list">
                  {hashtagList.map(tag => (
                    <span key={tag} className="hashtag-chip">
                      {tag}
                      <button className="tag-remove" onClick={() => removeTag(tag)}>×</button>
                    </span>
                  ))}
                </div>
                <input
                  className="input hashtag-input"
                  placeholder="#해시태그 추가 (스페이스로 구분)"
                  value={hashtagInput}
                  onChange={e => setHashtagInput(e.target.value)}
                />
              </div>

              {/* 이미지 */}
              <ImageSection
                images={images}
                kwList={kwList}
                onSwap={handleSwapImage}
                onUpload={handleUploadImage}
                onAltChange={handleAltChange}
                onRefreshAll={() => searchImages(kwList.length ? kwList : [topic])}
                onSearchKeyword={(q) => searchImages(q.split(/[,\s]+/).map(s => s.trim()).filter(Boolean))}
                thumbBgIndex={thumbBgIndex}
                onSelectThumbBg={handleSelectThumbBg}
                insertSelected={insertSelected}
                onToggleInsertSelect={handleToggleInsertSelect}
              />

              {/* 2026-07-22 신규: 관련 사이트 수동 편집 — AI가 자동 생성한
                  result.links(이름+주소 배열)를 그대로 노출/편집. 백엔드는
                  손대지 않음 — renderPreview/publish.now/publish.schedule이
                  이미 result.links를 그대로 사용하고 있어 이 배열만
                  갱신하면 자동 반영됨. */}
              <LinksSection
                links={result.links}
                onChange={(next) => setResult(p => ({ ...p, links: next }))}
                insertEnabled={insertLinks}
                onToggleInsertEnabled={setInsertLinks}
              />
            </>
          )}
        </div>

        {/* ── 하단: 글 설정 ───────────────────────────────────── */}
        <div className="post-create-panel card">
          {/* 줄 1: 주제 | 키워드 */}
          <div className="panel-row">
            <div className="panel-field panel-topic">
              <label className="panel-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <span>주제 <span className="label-required">*</span></span>
                {/* 2026-07-29 신규(개발자 전용 테스트 기능): URL의 글을
                    가져와 참고 자료로 삼아 글을 생성. 배포판 제외 —
                    process.env.NODE_ENV 가드(기존 테스트 발행 버튼과 동일 패턴).
                    2026-07-29 수정: 버튼을 주제 입력칸 우측 끝에 맞추고,
                    "가져온 글 반영됨" 표시는 버튼 위 줄에 겹치지 않게 배치. */}
                {process.env.NODE_ENV === 'development' && (
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    {/* 2026-07-29 수정(사용자 요청): 배지의 × 버튼 제거 —
                        가져오기 성공 시 3초만 잠깐 떴다가 자동으로 사라지는
                        알림으로 대체. 대신 활성 상태는 아래 버튼 자체가
                        초록색으로 바뀌는 것으로 표시(토글). */}
                    {importToast && (
                      <span className="label-hint" style={{ fontSize: 10, whiteSpace: 'nowrap', color: 'var(--success)' }}>
                        ✓ 가져온 글 반영됨
                      </span>
                    )}
                    <button
                      type="button"
                      className={`btn btn-ghost btn-xs${sourceMaterial ? ' btn-url-import-active' : ''}`}
                      style={{ padding: '1px 6px', fontSize: 11 }}
                      onClick={() => {
                        if (sourceMaterial) {
                          // 활성 상태에서 다시 누르면 비활성화(해제) — 톤 잠금도 함께 풀림
                          setSourceMaterial(null);
                        } else {
                          setShowUrlImport(true);
                          setImportError('');
                        }
                      }}
                      title={sourceMaterial ? '가져온 참고 자료가 반영된 상태입니다 — 다시 누르면 해제됩니다' : 'URL의 글 내용을 가져와 참고 자료로 삼아 글을 생성합니다(개발자 전용 테스트 기능)'}
                    >
                      🔗 글 가져오기
                    </button>
                  </span>
                )}
              </label>
              <input
                className="input"
                type="text"
                placeholder="예: 강남 맛집 추천"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>
            <div className="panel-field panel-keywords">
              <div className="panel-label panel-kw-label">
                <div className="kw-label-left">
                  키워드 <span className="label-hint">(쉼표로 구분)</span>
                  <button
                    className="btn-kw-suggest"
                    onClick={handleSuggestKeywords}
                    disabled={!topic.trim() || kwSuggesting}
                    title="주제 기반 SEO 키워드 자동 생성"
                  >
                    {kwSuggesting
                      ? <><span className="spinner-xs" /> 생성 중…</>
                      : '✦ 키워드 자동 생성'}
                  </button>
                </div>
                <div className="kw-label-right">
                  <label className="toggle-label" title="이번 발행에서만 브라우저 창을 표시/숨기기 — 발행 후 다시 기본값(해제)으로 돌아갑니다. 완전자동/예약 발행의 브라우저 표시는 환경설정 → 자동화 루프에서 별도로 설정합니다.">
                    <input
                      type="checkbox"
                      checked={!headlessMode}
                      onChange={e => {
                        // 2026-07-23: 전역 설정(settings.autoShowPublishWindow)과
                        // 분리 — 이 화면의 체크박스는 이제 로컬 상태만 바꾸고,
                        // 완전자동 루프가 쓰는 전역 설정에는 더 이상 영향을
                        // 주지 않는다(환경설정 → 자동화 루프 탭에서 별도 관리).
                        setHeadlessMode(!e.target.checked);
                      }}
                    />
                    <span className="toggle-text">🖥️ 브라우저 표시</span>
                  </label>
                  <label
                    className={`toggle-label${!tierLimits.thumbnail ? ' premium-lock-host' : ''}`}
                    title={!tierLimits.thumbnail ? PREMIUM_ONLY_TOOLTIP : '발행 시 글 제목이 들어간 디자인 썸네일을 자동 생성합니다'}
                  >
                    <input
                      type="checkbox"
                      checked={autoThumbnail && tierLimits.thumbnail}
                      disabled={!tierLimits.thumbnail}
                      onChange={e => setAutoThumbnail(e.target.checked)}
                    />
                    <span className="toggle-text">🖼️ 썸네일 자동 생성</span>
                    {!tierLimits.thumbnail && (
                      <span className="premium-lock-overlay"><span className="premium-locked-badge">🔒 프리미엄</span></span>
                    )}
                  </label>
                </div>
              </div>
              <div className="kw-input-wrap">
                <input
                  className="input"
                  type="text"
                  placeholder={kwSuggesting ? '키워드 생성 중…' : '예: 강남역 점심, 혼밥, 데이트  (또는 위 버튼으로 자동 생성)'}
                  value={keywords}
                  onChange={e => setKeywords(e.target.value)}
                  readOnly={kwSuggesting}
                />
                {kwError && <span className="kw-error">{kwError}</span>}
              </div>
            </div>
          </div>

          {/* 줄 2: 글 톤 | 문체 | 경험담 | 문장 길이 */}
          <div className="panel-row">
            <div className="panel-field panel-flex1">
              <label className="panel-label">
                글 톤
                {/* 2026-07-29 신규: "글 가져오기" 참고자료가 있을 때는 모달에서 고른
                    톤으로 고정(2026-08-04: 하드코딩된 '정보형' 대신 실제 선택 톤 표시) */}
                {sourceMaterial && (
                  <span className="label-hint" style={{ marginLeft: 6 }}>
                    가져온 글 — {TONE_OPTIONS.find(o => o.value === sourceMaterial.tone)?.label || '정보형'} 고정
                  </span>
                )}
                {/* 2026-08-07 신규: 리뷰형 + 제품명이 지정된 경우, 어떤 제품이
                    지정됐는지 표시하고 클릭으로 다시 수정할 수 있게 함 */}
                {!sourceMaterial && tone === 'review' && reviewProductName && (
                  <span
                    className="label-hint"
                    style={{
                      marginLeft: 'auto',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                      textAlign: 'right',
                    }}
                    onClick={() => { setReviewProductInput(reviewProductName); setShowReviewProductModal(true); }}
                    title={`클릭해서 지정 제품명 수정 — ${reviewProductName}`}
                  >
                    지정: {reviewProductName}
                  </span>
                )}
              </label>
              <DescSelect
                options={TONE_OPTIONS}
                value={sourceMaterial ? sourceMaterial.tone : tone}
                onChange={(v) => {
                  setTone(v);
                  // 2026-08-07 신규: 리뷰형으로 바꾸면 제품명 입력 모달을 띄움
                  if (v === 'review') {
                    setReviewProductInput(reviewProductName);
                    setShowReviewProductModal(true);
                  }
                }}
                disabled={!!sourceMaterial}
              />
            </div>
            <div className="panel-field panel-flex1">
              <label className="panel-label">문체</label>
              <DescSelect options={STYLE_OPTIONS} value={writingStyle} onChange={setWritingStyle} />
            </div>
            <div className="panel-field panel-flex1">
              <label className="panel-label">경험담 삽입</label>
              <DescSelect options={EXP_OPTIONS} value={personalExp} onChange={setPersonalExp} />
            </div>
            <div className="panel-field panel-flex1">
              <label className="panel-label">문장 길이</label>
              <DescSelect options={SENTENCE_OPTIONS} value={sentenceStyle} onChange={setSentenceStyle} align="right" />
            </div>
          </div>

          {/* 줄 3: 카테고리 | 공개 설정 | 발행 계정 */}
          <div className="panel-row">
            <div className="panel-field panel-flex1">
              <label className="panel-label">
                카테고리
                {categoriesLoading && <span className="category-loading-dot"> ·</span>}
                {categoryError && !categoriesLoading && (
                  <span style={{ color: '#ef4444', fontWeight: 500 }}> — 계정관리 - 세션 만료 확인</span>
                )}
              </label>
              {blogCategories.length > 0 ? (
                <select
                  className="input"
                  value={publishCategory}
                  onChange={e => setPublishCategory(e.target.value)}
                >
                  <option value="">미분류</option>
                  {blogCategories.map((cat, i) => (
                    <option key={i} value={cat.name ?? cat}>{cat.name ?? cat}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  placeholder={accountId && !categoriesLoading ? '카테고리명 직접 입력' : '카테고리명 (없으면 미분류)'}
                  value={publishCategory}
                  onChange={e => setPublishCategory(e.target.value)}
                />
              )}
            </div>
            <div className="panel-field" style={{ flexShrink: 0 }}>
              <label className="panel-label">공개 설정</label>
              <div className="visibility-toggle">
                <button
                  type="button"
                  className={`vis-btn${publishVisibility === 'public' ? ' vis-active' : ''}`}
                  onClick={() => setPublishVisibility('public')}
                >🌐 공개</button>
                <button
                  type="button"
                  className={`vis-btn${publishVisibility === 'private' ? ' vis-active' : ''}`}
                  onClick={() => setPublishVisibility('private')}
                >🔒 비공개</button>
              </div>
            </div>
            <div className="panel-field panel-account">
              <label className="panel-label">발행 계정</label>
              <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">계정 선택 (선택사항)</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.nickname || a.naver_id}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 줄 4: 목표 글자수 | 버튼들 */}
          <div className="panel-row panel-row-last">
            <div className="panel-field">
              <label className="panel-label">목표 글자수</label>
              <div className="range-row">
                <input className="input range-input" type="number" min={500} step={100}
                  value={targetMin} onChange={e => setTargetMin(Number(e.target.value))} />
                <span className="range-sep">~</span>
                <input className="input range-input" type="number" min={500} step={100}
                  value={targetMax} onChange={e => setTargetMax(Number(e.target.value))} />
                <span className="input-suffix">자</span>
              </div>
            </div>
            <div className="panel-field panel-btn-field">
              <label className="panel-label">&nbsp;</label>
              <div className="publish-btn-group">
                <label className="preview-toggle" title="즉시발행/예약발행 클릭 시, 실제 발행 전에 썸네일·본문 스타일이 반영된 미리보기를 먼저 보여줍니다.">
                  <input type="checkbox" checked={previewEnabled} onChange={e => setPreviewEnabled(e.target.checked)} />
                  <span>미리보기</span>
                </label>
                <button
                  className="btn btn-primary btn-generate"
                  onClick={() => handleGenerate()}
                  disabled={!topic.trim() || generating}
                >
                  {generating
                    ? <><span className="spinner-sm" />생성 중…</>
                    : '✦ 글 생성하기'}
                </button>
                <button
                  className="btn btn-publish-now"
                  onClick={handlePublishNow}
                  disabled={!result || publishing || generating || previewLoading}
                  title="지금 바로 네이버 블로그에 발행"
                >
                  {previewLoading ? <><span className="spinner-sm" />준비중…</> : publishing ? <><span className="spinner-sm" />발행 중…</> : '📤 즉시 발행'}
                </button>
                <button
                  className={`btn btn-schedule${!tierLimits.reservation ? ' premium-lock-host' : ''}`}
                  onClick={() => { setShowScheduleModal(true); const today = new Date().toISOString().slice(0,10); setScheduleDate(today); }}
                  disabled={!result || generating || !tierLimits.reservation}
                  title={!tierLimits.reservation ? PREMIUM_ONLY_TOOLTIP : '날짜와 시간을 지정해 예약 발행'}
                >
                  🕐 예약 발행
                  {!tierLimits.reservation && (
                    <span className="premium-lock-overlay"><span className="premium-locked-badge">🔒 프리미엄</span></span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 발행 메시지 */}
          {publishMsg && (
            <div className={`publish-msg ${publishMsg.startsWith('✓') ? 'publish-msg-ok' : 'publish-msg-err'}`}>
              {publishMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── 리뷰형 제품명 지정 모달 (2026-08-07 신규) ──────────────
          글 톤을 "리뷰형"으로 바꾸면 뜬다. 여기 입력한 제품명이 있으면
          쿠팡 제휴 상품 검색 시 글 제목 대신 이 값을 우선 검색어로 사용
          (post:renderPreview / publish:now·test·schedule 모두 반영).
          기존 예약 발행 모달과 동일한 modal-overlay/modal-box 패턴 재사용. */}
      {showReviewProductModal && (
        <div className="modal-overlay" onClick={() => setShowReviewProductModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">리뷰할 제품명 지정</h2>
            <div className="modal-body">
              <div className="modal-field">
                <label className="panel-label">제품명 (선택 사항)</label>
                <input
                  className="input"
                  type="text"
                  placeholder="예: 다이슨 에어랩 컴플리트"
                  value={reviewProductInput}
                  onChange={e => setReviewProductInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (setReviewProductName(reviewProductInput.trim()), setShowReviewProductModal(false))}
                  autoFocus
                />
                <span className="label-hint" style={{ marginTop: 4, display: 'block' }}>
                  입력하면 쿠팡 제휴 상품 검색 시 글 제목 대신 이 제품명을 우선 사용합니다. 비워두면 기존처럼 글 제목으로 검색합니다.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-ghost"
                onClick={() => { setReviewProductName(''); setShowReviewProductModal(false); }}
              >
                지정 안 함
              </button>
              <button
                className="btn btn-primary"
                onClick={() => { setReviewProductName(reviewProductInput.trim()); setShowReviewProductModal(false); }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── URL 글 가져오기 모달 (2026-07-29 신규, 개발자 전용 테스트) ──
          기존엔 라벨 줄 안에서 인라인으로 확장되는 방식이었는데, 옆
          "키워드" 영역과 겹쳐 보이는 문제로 별도 팝업으로 전환. 기존
          예약 발행 모달과 동일한 modal-overlay/modal-box 패턴 재사용. */}
      {showUrlImport && (
        <div className="modal-overlay" onClick={() => { if (!importing) setShowUrlImport(false); }}>
          <div className="modal-box url-import-modal-box" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">URL 글 가져오기</h2>
            <div className="modal-body">
              <div className="modal-field">
                <label className="panel-label">가져올 페이지 URL</label>
                <input
                  className="input"
                  type="text"
                  placeholder="https://..."
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
                  disabled={importing}
                  autoFocus
                />
                {importError && <span className="kw-error">{importError}</span>}
              </div>
              {/* 2026-08-04 신규: 가져온 원문을 어떤 톤으로 재작성할지 선택 —
                  상품 판매 관련 소스면 리뷰형을 골라 제휴 상품 코드가
                  붙도록 할 수 있음(사용자 요청). URL 입력칸 바로 아래
                  좌측 정렬로 배치. */}
              <div className="modal-field url-import-tone-field">
                <label className="panel-label">글 톤</label>
                <DescSelect options={TONE_OPTIONS} value={importTone} onChange={setImportTone} disabled={importing} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowUrlImport(false)} disabled={importing}>취소</button>
              <button className="btn btn-primary" onClick={handleImportUrl} disabled={importing || !importUrl.trim()}>
                {importing ? <><span className="spinner-sm" />가져오는 중…</> : '가져오기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 예약 발행 모달 ────────────────────────────────────── */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">예약 발행 설정</h2>
            <div className="modal-body">
              <div className="modal-field">
                <label className="panel-label">발행 날짜</label>
                <input
                  className="input"
                  type="date"
                  value={scheduleDate}
                  min={earliestSlot ? earliestSlot.slice(0, 10) : new Date().toISOString().slice(0, 10)}
                  onChange={e => setScheduleDate(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label className="panel-label">발행 시간</label>
                {(() => {
                  // 네이버 에디터의 예약 시간 선택 UI와 동일하게: 시(00~23) + 분(00/10/20/30/40/50, 10분 단위)
                  const [curH, curM] = scheduleTime.split(':');
                  const isEarliestDate = !!(earliestSlot && scheduleDate === earliestSlot.slice(0, 10));
                  let minH = null, minM = null;
                  if (isEarliestDate) {
                    const [eh, em] = earliestSlot.slice(11, 16).split(':').map(Number);
                    const totalMin = Math.ceil((eh * 60 + em) / 10) * 10;
                    minH = Math.floor(totalMin / 60) % 24;
                    minM = totalMin % 60;
                  }
                  const hourList = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
                    .filter(h => !isEarliestDate || Number(h) >= minH);
                  const minuteList = ['00', '10', '20', '30', '40', '50']
                    .filter(m => !isEarliestDate || Number(curH) > minH || Number(m) >= minM);
                  return (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        className="input"
                        value={curH}
                        onChange={e => {
                          const newH = e.target.value;
                          // 시간이 바뀌어 현재 분이 더 이상 허용 범위 밖이면 최소 허용 분으로 보정
                          const nextMinuteList = ['00', '10', '20', '30', '40', '50']
                            .filter(m => !isEarliestDate || Number(newH) > minH || Number(m) >= minM);
                          const nextM = nextMinuteList.includes(curM) ? curM : nextMinuteList[0];
                          setScheduleTime(`${newH}:${nextM}`);
                        }}
                      >
                        {hourList.map(h => <option key={h} value={h}>{h}시</option>)}
                      </select>
                      <select
                        className="input"
                        value={curM}
                        onChange={e => setScheduleTime(`${curH}:${e.target.value}`)}
                      >
                        {minuteList.map(m => <option key={m} value={m}>{m}분</option>)}
                      </select>
                    </div>
                  );
                })()}
              </div>
              <div className="modal-field">
                <label className="panel-label">발행 계정</label>
                <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}>
                  <option value="">계정 선택</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.nickname || a.naver_id}</option>
                  ))}
                </select>
              </div>
              {accountId && (
                <p className="modal-hint" style={{ color: 'var(--accent)' }}>
                  {earliestSlotLoading
                    ? '예약 가능 시각 확인 중…'
                    : earliestSlot
                      ? `⏱ 예약 가능 시각: ${earliestSlot.slice(0,10)} ${earliestSlot.slice(11,16)} 이후 (최소 간격 적용)`
                      : ''}
                </p>
              )}
              <p className="modal-hint">
                "예약 등록"을 누르면 지금 바로 네이버 에디터가 열려 즉시발행과 동일하게 내용이 채워지고,<br/>
                마지막에 네이버 자체 예약 기능으로 등록됩니다. 이후에는 앱이나 PC가 꺼져 있어도<br/>
                네이버가 예약 시각에 자동으로 발행합니다.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowScheduleModal(false)} disabled={scheduling}>취소</button>
              <button className="btn btn-primary" onClick={handleScheduleSubmit} disabled={scheduling}>
                {scheduling ? <><span className="spinner-sm" />예약 등록 중…</> : '예약 등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 발행 전 미리보기 모달 (2026-07-07 신규) ─────────────── */}
      {previewModalOpen && (
        <div className="modal-overlay preview-modal-overlay" onClick={() => setPreviewModalOpen(false)}>
          <div className="modal-box preview-modal-box" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">발행 전 미리보기</h2>
            <div className="modal-body preview-modal-body">
              <p className="modal-hint">
                ⚠️ 실제 네이버 에디터의 세부 여백·폰트 렌더링과는 다소 차이가 있을 수 있는 근사 미리보기입니다.
              </p>
              {previewData?.thumbDataUrl && (
                <div className="preview-thumb-wrap">
                  <img src={previewData.thumbDataUrl} alt="썸네일 미리보기" className="preview-thumb-img" />
                </div>
              )}
              <div className="preview-content">
                {/* 2026-07-07: 이미지 3장→5장 확대. main.js의 splitBodyForImages와
                    동일한 순서(이미지1→대분류1도입→이미지2→중분류1→이미지3→
                    중분류2→이미지4→대분류2→이미지5→마무리)로 실제 발행과
                    일치시킴. hasPart1~3가 모두 false면(AI가 구조를 안 지킨
                    예외 상황) 이미지2~4를 대분류2 뒤에 몰아서 표시. */}
                <div dangerouslySetInnerHTML={{ __html: previewData?.introHtml || '' }} />
                {images[0]?.url && <img src={images[0].url} alt={images[0].alt || ''} className="preview-body-img" />}
                {/* 2026-08-04 신규: 보너스 이미지 — 이 지점이 resolvedBonusPoints에
                    포함된 경우만, 기존 이미지 바로 뒤에 한 장 더 표시 */}
                {resolvedBonusPoints?.includes(0) && images[5]?.url && <img src={images[5].url} alt={images[5].alt || ''} className="preview-body-img" />}
                {/* 2026-07-23 신규: 제휴 광고 — 도입부 아래(위치설정 'intro'|'both') */}
                {(previewData?.adPosition === 'intro' || previewData?.adPosition === 'both') && previewData?.adHtml && (
                  <>
                    {/* 2026-07-23(5차 수정 — 원래 방식으로 복귀): 버튼 이미지+SE3
                        "링크" 카드 방식 폐기(원치 않는 카드 생성 + 클릭 시 "사용권한이
                        없습니다" 오류로 확인됨). 상품 이미지 + 박스(안에 텍스트 링크
                        포함)로 복귀 */}
                    {/* 2026-07-23: 실제 발행은 상품 이미지를 70%로 축소+가운데 정렬해서
                        넣으므로 미리보기도 동일하게 표시(본문 이미지는 영향 없음) */}
                    {previewData?.adProductImage && (
                      <img
                        src={previewData.adProductImage}
                        alt="제휴 광고 상품"
                        className="preview-body-img"
                        style={{ display: 'block', width: '70%', margin: '0 auto' }}
                      />
                    )}
                    <div dangerouslySetInnerHTML={{ __html: previewData.adHtml }} />
                  </>
                )}
                {previewData?.hasPart1 && (
                  <>
                    <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart1Html || '' }} />
                    {images[1]?.url && <img src={images[1].url} alt={images[1].alt || ''} className="preview-body-img" />}
                    {resolvedBonusPoints?.includes(1) && images[6]?.url && <img src={images[6].url} alt={images[6].alt || ''} className="preview-body-img" />}
                  </>
                )}
                {previewData?.hasPart2 && (
                  <>
                    <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart2Html || '' }} />
                    {images[2]?.url && <img src={images[2].url} alt={images[2].alt || ''} className="preview-body-img" />}
                    {resolvedBonusPoints?.includes(2) && images[7]?.url && <img src={images[7].url} alt={images[7].alt || ''} className="preview-body-img" />}
                  </>
                )}
                {previewData?.hasPart3 && (
                  <>
                    <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart3Html || '' }} />
                    {images[3]?.url && <img src={images[3].url} alt={images[3].alt || ''} className="preview-body-img" />}
                    {resolvedBonusPoints?.includes(3) && images[8]?.url && <img src={images[8].url} alt={images[8].alt || ''} className="preview-body-img" />}
                  </>
                )}
                <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart4Html || '' }} />
                {/* 2026-07-23 신규: 제휴 광고 — 본문 아래(위치설정 'body'|'both', 기본값) */}
                {(previewData?.adPosition === 'body' || previewData?.adPosition === 'both') && previewData?.adHtml && (
                  <>
                    {/* 2026-07-23(5차 수정 — 원래 방식으로 복귀): 버튼 이미지+SE3
                        "링크" 카드 방식 폐기(원치 않는 카드 생성 + 클릭 시 "사용권한이
                        없습니다" 오류로 확인됨). 상품 이미지 + 박스(안에 텍스트 링크
                        포함)로 복귀 */}
                    {/* 2026-07-23: 실제 발행은 상품 이미지를 70%로 축소+가운데 정렬해서
                        넣으므로 미리보기도 동일하게 표시(본문 이미지는 영향 없음) */}
                    {previewData?.adProductImage && (
                      <img
                        src={previewData.adProductImage}
                        alt="제휴 광고 상품"
                        className="preview-body-img"
                        style={{ display: 'block', width: '70%', margin: '0 auto' }}
                      />
                    )}
                    <div dangerouslySetInnerHTML={{ __html: previewData.adHtml }} />
                  </>
                )}
                {!(previewData?.hasPart1 || previewData?.hasPart2 || previewData?.hasPart3) && (
                  <>
                    {images[1]?.url && <img src={images[1].url} alt={images[1].alt || ''} className="preview-body-img" />}
                    {resolvedBonusPoints?.includes(1) && images[6]?.url && <img src={images[6].url} alt={images[6].alt || ''} className="preview-body-img" />}
                    {images[2]?.url && <img src={images[2].url} alt={images[2].alt || ''} className="preview-body-img" />}
                    {resolvedBonusPoints?.includes(2) && images[7]?.url && <img src={images[7].url} alt={images[7].alt || ''} className="preview-body-img" />}
                    {images[3]?.url && <img src={images[3].url} alt={images[3].alt || ''} className="preview-body-img" />}
                    {resolvedBonusPoints?.includes(3) && images[8]?.url && <img src={images[8].url} alt={images[8].alt || ''} className="preview-body-img" />}
                  </>
                )}
                {images[4]?.url && <img src={images[4].url} alt={images[4].alt || ''} className="preview-body-img" />}
                {resolvedBonusPoints?.includes(4) && images[9]?.url && <img src={images[9].url} alt={images[9].alt || ''} className="preview-body-img" />}
                <div dangerouslySetInnerHTML={{ __html: previewData?.conclusionHtml || '' }} />
                {previewData?.linksHtml && <div dangerouslySetInnerHTML={{ __html: previewData.linksHtml }} />}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setPreviewModalOpen(false); setPreviewData(null); setPreviewPendingAction(null); }} disabled={publishing || scheduling || testing || savingDraft}>취소</button>
              {/* 2026-08-09 신규: 발행하지 않고 검수 대기로 저장 — 이미 AI 토큰을
                  써서 생성한 글을 나중에(앱 재시작 후 등) 재호출 없이 재사용하기 위함 */}
              <button className="btn btn-ghost" onClick={handleSaveDraft} disabled={publishing || scheduling || testing || savingDraft}>
                {savingDraft ? <><span className="spinner-sm" />저장 중…</> : '💾 임시저장'}
              </button>
              {/* 2026-07-24 신규(개발자 전용): 실제 발행 버튼만 안 누르고 나머지는
                  전부 동일하게 자동화 — 반복 테스트해도 계정에 영향 없음.
                  process.env.NODE_ENV==='development'는 기존 개발자 등급 토글(Sidebar.jsx)과
                  동일한 판정 방식이며, main.js의 publish:test 핸들러도 isDev로 이중 차단한다. */}
              {process.env.NODE_ENV === 'development' && (
                <button className="btn btn-ghost" onClick={confirmPreviewAndTest} disabled={publishing || scheduling || testing || savingDraft}>
                  {testing ? <><span className="spinner-sm" />테스트 중…</> : '🧪 테스트(발행 안 함)'}
                </button>
              )}
              <button className="btn btn-primary" onClick={confirmPreviewAndPublish} disabled={publishing || scheduling || testing || savingDraft}>
                {(publishing || scheduling)
                  ? <><span className="spinner-sm" />발행 중…</>
                  : previewPendingAction === 'schedule' ? '이대로 예약 발행' : '이대로 즉시 발행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 미리보기용 마크다운 기호 제거 (##/### 유지해야 toNaverHtml 동작 — 표시만 제거) ──
function stripForDisplay(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => line.replace(/^\s*#{1,6}\s+/, ''))  // ## ### 제거
    .join('\n')
    .trim();
}

// ── 섹션 카드 컴포넌트 ────────────────────────────────────────
function SectionCard({ label, content, section, onRegen, regenSection, isTitle, editMode, onEdit }) {
  const loading = regenSection === section;

  // textarea 자동 높이 조절
  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  return (
    <div className={`card section-card${isTitle ? ' section-card-title' : ''}${editMode ? ' section-card-editing' : ''}`}>
      <div className="section-card-header">
        <span className="section-label">{label}</span>
        {!editMode && (
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => onRegen(section)}
            disabled={!!regenSection}
            title={`${label} 재생성`}
          >
            {loading ? <span className="spinner-xs" /> : <RefreshIcon size={11} />}
            {loading ? '생성 중…' : '재생성'}
          </button>
        )}
      </div>
      {editMode ? (
        <textarea
          className={`section-edit-textarea${isTitle ? ' section-edit-title' : ''}`}
          value={content}
          spellCheck={false}
          ref={autoResize}
          onChange={e => {
            onEdit(e.target.value);
            autoResize(e.target);
          }}
        />
      ) : (
        <div className={`section-content${isTitle ? ' section-title-text' : ''}`}>
          {isTitle ? content : stripForDisplay(content)}
        </div>
      )}
    </div>
  );
}

// ── 이미지 섹션 컴포넌트 ──────────────────────────────────────
function ImageSection({ images, kwList, onSwap, onUpload, onAltChange, onRefreshAll, onSearchKeyword, thumbBgIndex, onSelectThumbBg, insertSelected, onToggleInsertSelect }) {
  const allLoading = images.every(img => img.loading);
  const hasAny     = images.some(img => img.url);
  const [imgQuery, setImgQuery] = React.useState('');
  // 2026-08-04 신규: 더블클릭은 브라우저에서 click 이벤트 2번 + dblclick
  // 1번이 순서대로 발생함 — onClick(썸네일 배경 선택)이 그대로 있으면
  // 더블클릭으로 삽입 선택을 하려 할 때마다 썸네일 배경이 먼저 켜졌다가
  // 다시 꺼지는(토글 2번) 문제가 실사용에서 확인됨. 단일 클릭은 이 타이머로
  // 살짝 지연시키고, 그 사이 두 번째 클릭(=더블클릭)이 오면 지연된 썸네일
  // 배경 선택 자체를 취소해 더블클릭 중에는 기존 썸네일 배경 선택이 전혀
  // 건드려지지 않도록 함.
  const clickTimerRef = React.useRef(null);
  const handleCardClick = (idx, img) => {
    if (!img.url || img.loading) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onSelectThumbBg(idx);
      clickTimerRef.current = null;
    }, 250);
  };
  const handleCardDoubleClick = (idx, img) => {
    if (!img.url || img.loading) return;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (idx >= 5) onToggleInsertSelect(idx);
  };

  const handleSearch = () => {
    const q = imgQuery.trim();
    if (!q) return;
    onSearchKeyword(q);
  };

  return (
    <div className="card image-section">
      <div className="image-section-header">
        <span className="section-label" style={{ whiteSpace: 'nowrap' }}>이미지 자동 첨부</span>
        {/* 2026-07-07 재수정: 라벨+힌트+입력칸+버튼을 다시 한 그룹(1열)으로
            복원하되, 힌트 텍스트는 img-hint-text로 폭을 제한해 자연스럽게
            2줄로 줄바꿈되도록 함(전체를 2행으로 나눴던 이전 방식은 되돌림)
            2026-07-08: 자연 줄바꿈 대신 "대주제2"/"마무리" 사이에서
            강제로 줄을 나누도록 <br /> 삽입 (사용자 명시 요청)
            2026-07-08(2차): 힌트는 라벨 바로 옆에 붙이고 싶지만, 입력칸/
            검색/새로고침은 우측 정렬을 유지하고 싶다는 요청 — 힌트를
            img-header-right 밖으로 꺼내 라벨의 형제 요소로 두고,
            img-header-right(입력칸+버튼)는 margin-left:auto로 우측 고정 */}
        <span className="label-hint img-hint-text">도입부 · 대주제1 · 중간전환 · 대주제2<br />마무리 5곳 자동 배치(1줄) · 클릭=썸네일 배경 선택 · "+" 5곳(2줄)은 더블클릭=삽입 선택(1~5개, 안 고르면 무작위)</span>
        <div className="img-header-right">
          {/* 키워드 직접 검색 */}
          <input
            className="input img-search-input"
            placeholder="키워드"
            value={imgQuery}
            onChange={e => setImgQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            disabled={allLoading}
          />
          <button
            className="btn btn-ghost btn-xs"
            onClick={handleSearch}
            disabled={allLoading || !imgQuery.trim()}
            title="검색어로 이미지 검색"
          >
            {allLoading ? <span className="spinner-xs" /> : '🔍'}
          </button>
          <button className="btn btn-ghost btn-xs" onClick={onRefreshAll} disabled={allLoading} style={{ whiteSpace: 'nowrap' }}>
            {allLoading ? <span className="spinner-xs" /> : <RefreshIcon size={11} />}
            {allLoading ? '검색 중…' : '새로고침'}
          </button>
        </div>
      </div>

      <div className="image-grid">
        {images.map((img, idx) => (
          <div key={img.position} className="image-card">
            {/* 위치 라벨 */}
            <div className="image-pos-label">{img.position}</div>

            {/* 이미지 영역 — 2026-07-07: 이미지가 있을 때 클릭하면 해당 이미지를
                썸네일 배경으로 선택(라디오 방식), 선택된 카드는 테두리 강조.
                2026-08-04: 인덱스 5~9(보너스 슬롯)는 더블클릭으로 "삽입 선택"도
                가능 — 기존 0~4는 항상 삽입되므로 더블클릭 대상 아님. */}
            <div
              className={`image-thumb-wrap${thumbBgIndex === idx ? ' selected' : ''}${insertSelected?.has(idx) ? ' insert-selected' : ''}`}
              onClick={() => handleCardClick(idx, img)}
              onDoubleClick={() => handleCardDoubleClick(idx, img)}
              role={img.url ? 'button' : undefined}
              title={img.url ? (idx >= 5 ? '클릭=썸네일 배경 선택 · 더블클릭=삽입 선택' : '클릭하면 썸네일 배경으로 선택됩니다') : undefined}
              style={img.url ? { cursor: 'pointer' } : undefined}
            >
              {img.loading ? (
                <div className="image-loading">
                  <div className="gen-spinner" style={{ width: 28, height: 28, borderWidth: 2 }} />
                </div>
              ) : img.url ? (
                <img src={img.thumb || img.url} alt={img.alt} className="image-thumb" />
              ) : (
                <div className="image-empty">
                  <span style={{ fontSize: 22 }}>🖼</span>
                  <p>이미지 없음</p>
                </div>
              )}
              {thumbBgIndex === idx && (
                <div className="thumb-bg-badge">썸네일 배경</div>
              )}
              {insertSelected?.has(idx) && (
                <div className="insert-selected-badge">✓ 삽입 선택됨</div>
              )}
            </div>

            {/* 사진작가 크레딧 */}
            {img.photographer && !img.loading && (
              <div className="image-credit">📷 {img.photographer}</div>
            )}

            {/* Alt 텍스트 */}
            {img.url && !img.loading && (
              <input
                className="input image-alt-input"
                placeholder="이미지 설명 (SEO alt text)"
                value={img.alt}
                onChange={e => onAltChange(idx, e.target.value)}
              />
            )}

            {/* 버튼 */}
            <div className="image-btns">
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => onSwap(idx)}
                disabled={img.loading}
                title="다른 이미지로 교체"
              >
                <RefreshIcon size={11} />교체
              </button>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => onUpload(idx)}
                disabled={img.loading}
                title="내 컴퓨터에서 이미지 선택"
              >
                ↑ 업로드
              </button>
            </div>
          </div>
        ))}
      </div>

      {!hasAny && !allLoading && (
        <p className="image-hint">Unsplash API 키를 환경설정에서 입력하면 자동으로 이미지가 추천됩니다.</p>
      )}
    </div>
  );
}

// ── 관련 사이트 수동 편집 (2026-07-22 신규) ────────────────────
// 계정 관리 화면의 "선택 삭제" 패턴(휴지통 버튼 → 체크박스 → 일괄삭제)과
// 동일한 UX를 재사용 — 줄마다 +/- 버튼을 두지 않고 섹션 제목 옆에 작은
// 버튼 2개만 두어 공간을 절약한다(사용자 요청).
function LinksSection({ links, onChange, insertEnabled, onToggleInsertEnabled }) {
  const list = Array.isArray(links) ? links : [];
  const [bulkMode, setBulkMode] = React.useState(false);
  const [selectedIdx, setSelectedIdx] = React.useState(new Set());

  const handleAdd = () => {
    // 2026-08-09 신규: 사용자가 직접 추가한 줄은 manual:true로 표시 —
    // 백엔드 filterReachableLinks()가 이 값을 보고 메인 도메인 축약을
    // 건너뛰고 URL(제휴 숏링크/딥링크의 경로·쿼리 포함)을 그대로 유지한다.
    onChange([...list, { name: '', url: '', manual: true }]);
  };

  const toggleBulkMode = () => {
    setBulkMode(v => !v);
    setSelectedIdx(new Set());
  };

  const toggleSelect = (idx) => {
    setSelectedIdx(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selectedIdx.size === 0) return;
    onChange(list.filter((_, idx) => !selectedIdx.has(idx)));
    setSelectedIdx(new Set());
    setBulkMode(false);
  };

  const updateField = (idx, field, value) => {
    const next = list.slice();
    next[idx] = { ...next[idx], [field]: value };
    // 2026-08-09 신규: URL을 직접 입력/수정하면 manual:true로 표시 —
    // AI가 자동 생성한 링크라도 사용자가 URL을 손댄 순간부터는 원본
    // 그대로 유지 대상이 된다(제휴 숏링크/딥링크 트래킹 정보 보존).
    if (field === 'url') next[idx].manual = true;
    onChange(next);
  };

  return (
    <div className="card links-section">
      <div className="links-section-header">
        <span className="section-label" style={{ whiteSpace: 'nowrap' }}>관련 사이트</span>
        <div className="links-header-right">
          {bulkMode ? (
            <>
              <button
                className="btn btn-ghost btn-xs"
                onClick={handleBulkDelete}
                disabled={selectedIdx.size === 0}
              >
                선택 삭제 ({selectedIdx.size})
              </button>
              <button className="btn btn-ghost btn-xs" onClick={toggleBulkMode}>취소</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-xs" onClick={handleAdd} title="줄 추가">+ 추가</button>
              <button
                className="btn btn-ghost btn-xs"
                onClick={toggleBulkMode}
                disabled={list.length === 0}
                title="줄 삭제"
              >
                − 삭제
              </button>
            </>
          )}
          {/* 2026-08-09 신규: 관련 사이트를 실제로 게시글에 삽입할지 여부.
              기본 해제 — AI가 3개를 생성해 보여주는 것과는 별개로, 매 글마다
              항상 삽입되면 저품질 판정 위험이 있다는 우려로 사용자가 직접
              확인 후 체크해야만 미리보기/발행 결과에 반영되도록 함. */}
          <label className="links-insert-toggle" title="체크해야 실제 미리보기·발행 결과에 관련 사이트가 삽입됩니다. 체크를 해제해도 위 목록은 그대로 유지되어 언제든 다시 켤 수 있습니다.">
            <input
              type="checkbox"
              checked={!!insertEnabled}
              onChange={e => onToggleInsertEnabled(e.target.checked)}
            />
            <span>게시글에 삽입</span>
          </label>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="image-hint">등록된 관련 사이트가 없습니다. "+ 추가"를 눌러 등록하세요.</p>
      ) : (
        <div className="links-rows">
          {list.map((link, idx) => (
            <div key={idx} className="links-row">
              {bulkMode && (
                <input
                  type="checkbox"
                  className="links-row-check"
                  checked={selectedIdx.has(idx)}
                  onChange={() => toggleSelect(idx)}
                />
              )}
              <input
                className="input links-name-input"
                placeholder="사이트 이름"
                value={link.name || ''}
                onChange={e => updateField(idx, 'name', e.target.value)}
              />
              <input
                className="input links-url-input"
                placeholder="https://..."
                value={link.url || ''}
                onChange={e => updateField(idx, 'url', e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
