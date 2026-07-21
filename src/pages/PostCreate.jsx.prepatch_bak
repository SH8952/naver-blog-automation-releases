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
function DescSelect({ options, value, onChange, align = 'left' }) {
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
        onClick={() => setOpen(o => !o)}
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
const IMG_POSITIONS = ['도입부', '대주제1', '중간전환', '대주제2', '마무리'];
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
  // 2026-07-07 신규: 썸네일 배경으로 직접 선택한 이미지 카드 인덱스(0~4).
  // null이면 선택 안 함 = 기존 자동 검색 그대로 사용. 카드 클릭으로 토글.
  const [thumbBgIndex, setThumbBgIndex] = useState(null);

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
        // 2026-07-16 추가: "브라우저 표시" 체크박스도 저장된 전역 설정
        // (settings.autoShowPublishWindow)으로 초기화 — 지금까지는 이
        // 화면을 새로 열 때마다 항상 꺼짐(headlessMode=true)으로
        // 리셋되고, 이 값이 반자동/완전자동 루프에는 전혀 반영되지
        // 않았음. 이제 main.js도 같은 키(settings.autoShowPublishWindow)를
        // 읽어 완전자동/예약 발행에 반영하므로, 이 화면과 자동화가 같은
        // 설정값을 공유하게 된다.
        setHeadlessMode(!s.autoShowPublishWindow);
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
      return;
    }
    setCategoriesLoading(true);
    setBlogCategories([]);
    // 2026-07-07: 검수 대기에서 넘어온 카테고리가 대기 중이면(pendingCategoryRef)
    // 빈 값 대신 그 값으로 초기화 — 아래 카테고리 목록 로딩 완료 후 한 번 더
    // 확정 적용한다.
    setPublishCategory(pendingCategoryRef.current || '');
    window.electronAPI.blog.getCategories(Number(accountId)).then(res => {
      setCategoriesLoading(false);
      if (res.success && res.categories && res.categories.length > 0) {
        setBlogCategories(res.categories);
      }
      if (pendingCategoryRef.current) {
        setPublishCategory(pendingCategoryRef.current);
        pendingCategoryRef.current = null;
      }
    }).catch(() => setCategoriesLoading(false));
  }, [accountId]);

  // 2026-07-07 신규: 검수 대기 화면에서 "글 생성으로 이동"으로 넘어온 글
  // 프리필 — location.state.reviewPost가 있으면 최초 1회만 각 입력값을
  // 채운다(재실행 방지를 위해 의존성 배열을 비워둠 — 이 화면에 진입할 때
  // 딱 한 번만 반영하면 되는 값이라 accountId 등 다른 상태 변경으로 인한
  // 재실행이 필요 없음).
  useEffect(() => {
    const rp = state?.reviewPost;
    if (!rp) return;

    setTopic(rp.title || '');
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
  }, []);

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
  };

  // ── 글 생성 ──────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    setEditMode(false);
    setImages(emptyImages());
    setImgSearched(false);
    setErrorMsg('');
    try {
      const res = await window.electronAPI.post.generate({
        topic, keywords: kwList, tone, writingStyle, personalExp, sentenceStyle, targetMin, targetMax,
      });
      if (res.success) {
        setResult(res.result);
        const kws = kwList.length ? kwList : [topic];
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
    try {
      const res = await window.electronAPI.post.renderPreview({
        title: result.title,
        // 2026-07-08 신규: 썸네일 전용 문구 — 있으면 제목 대신 썸네일에 사용
        thumbText: result.thumbText || '',
        intro: result.intro,
        body: result.body,
        conclusion: result.conclusion,
        links: Array.isArray(result.links) ? result.links : [],
        hashtags: hashtagList,
        autoThumbnail: autoThumbnail,
        // 2026-07-07: 이미지 카드를 클릭해 썸네일 배경을 직접 선택한 경우 전달
        // — 선택 안 했으면 undefined로 넘어가 기존 자동 검색 그대로 사용
        thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
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
    const action = previewPendingAction;
    setPreviewModalOpen(false);
    setPreviewData(null);
    setPreviewPendingAction(null);
    if (action === 'schedule') await doScheduleSubmit(forcedThumbPath, forcedStyleIndex);
    else await doPublishNow(forcedThumbPath, forcedStyleIndex);
  };

  // ── 즉시 발행 ─────────────────────────────────────────────
  const handlePublishNow = async () => {
    if (!accountId) { setPublishMsg('⚠️ 발행 계정을 선택해주세요.'); setTimeout(() => setPublishMsg(''), 3000); return; }
    if (!result) return;
    if (previewEnabled) { await requestPreview('now'); return; }
    await doPublishNow(null, null);
  };

  const doPublishNow = async (forcedThumbPath, forcedStyleIndex) => {
    setPublishing(true);
    setPublishMsg('');
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
          links: Array.isArray(result.links) ? result.links : [],
          hashtags: hashtagList,
          images: images.map(img => ({ url: img.url, alt: img.alt })),
          category: publishCategory.trim(),
          visibility: publishVisibility,
          headless: headlessMode,
          autoThumbnail: autoThumbnail,
          forcedThumbPath: forcedThumbPath || undefined,
          forcedStyleIndex: forcedStyleIndex != null ? forcedStyleIndex : undefined,
          // 2026-07-07: 미리보기 없이 바로 발행(previewEnabled=false)한 경우에도
          // 선택한 썸네일 배경이 반영되도록 전달
          thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
        },
      });
      if (res.success) {
        setPublishMsg('✓ 발행이 완료되었습니다.');
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
    await doScheduleSubmit(null, null);
  };

  const doScheduleSubmit = async (forcedThumbPath, forcedStyleIndex) => {
    const scheduledAt = `${scheduleDate}T${scheduleTime}`;
    setScheduling(true);
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
          links: Array.isArray(result.links) ? result.links : [],
          hashtags: hashtagList,
          images: images.map(img => ({ url: img.url, alt: img.alt })),
          category: publishCategory.trim(),
          visibility: publishVisibility,
          headless: headlessMode,
          autoThumbnail: autoThumbnail,
          forcedThumbPath: forcedThumbPath || undefined,
          forcedStyleIndex: forcedStyleIndex != null ? forcedStyleIndex : undefined,
          thumbBgUrl: (thumbBgIndex != null && images[thumbBgIndex]?.url) || undefined,
        },
        scheduledAt,
      });
      if (res.success) {
        setShowScheduleModal(false);
        setPublishMsg(`✓ ${scheduleDate} ${scheduleTime} 네이버 예약 등록 완료`);
        setTimeout(() => setPublishMsg(''), 5000);
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
    setResult(prev => ({
      ...prev,
      title:      rep(prev.title),
      // 2026-07-08 신규: 썸네일 전용 문구도 찾아바꾸기 대상에 포함
      thumbText:  rep(prev.thumbText || ''),
      intro:      rep(prev.intro),
      body:       rep(prev.body),
      conclusion: rep(prev.conclusion),
    }));
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
                  <button className="btn btn-ghost btn-sm" onClick={handleGenerate} disabled={generating}>
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
                <SectionCard
                  label="썸네일 문구" content={result.thumbText} section="thumbText"
                  onRegen={handleRegenSection} regenSection={regenSection}
                  editMode={editMode}
                  onEdit={v => setResult(p => ({ ...p, thumbText: v }))}
                  isTitle
                />
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
              />
            </>
          )}
        </div>

        {/* ── 하단: 글 설정 ───────────────────────────────────── */}
        <div className="post-create-panel card">
          {/* 줄 1: 주제 | 키워드 */}
          <div className="panel-row">
            <div className="panel-field panel-topic">
              <label className="panel-label">주제 <span className="label-required">*</span></label>
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
                  <label className="toggle-label" title="발행 중 브라우저 창을 표시/숨기기">
                    <input
                      type="checkbox"
                      checked={!headlessMode}
                      onChange={e => {
                        const showBrowser = e.target.checked;
                        setHeadlessMode(!showBrowser);
                        // 2026-07-16 추가: 이 체크박스 상태를 전역 설정
                        // (settings.autoShowPublishWindow)에도 저장해,
                        // 반자동(예약 발행)·완전자동 루프도 같은 값을
                        // 따르도록 함. settings:set은 전체 settings 객체를
                        // 통째로 교체하므로, 최신 설정을 먼저 읽어와
                        // 병합한 뒤 저장한다(다른 설정값이 지워지지
                        // 않도록).
                        window.electronAPI.settings.get().then(res => {
                          if (res.success && res.settings) {
                            window.electronAPI.settings.set({
                              ...res.settings,
                              autoShowPublishWindow: showBrowser,
                            });
                          }
                        });
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
              <label className="panel-label">글 톤</label>
              <DescSelect options={TONE_OPTIONS} value={tone} onChange={setTone} />
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
                  onClick={handleGenerate}
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
                {previewData?.hasPart1 && (
                  <>
                    <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart1Html || '' }} />
                    {images[1]?.url && <img src={images[1].url} alt={images[1].alt || ''} className="preview-body-img" />}
                  </>
                )}
                {previewData?.hasPart2 && (
                  <>
                    <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart2Html || '' }} />
                    {images[2]?.url && <img src={images[2].url} alt={images[2].alt || ''} className="preview-body-img" />}
                  </>
                )}
                {previewData?.hasPart3 && (
                  <>
                    <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart3Html || '' }} />
                    {images[3]?.url && <img src={images[3].url} alt={images[3].alt || ''} className="preview-body-img" />}
                  </>
                )}
                <div dangerouslySetInnerHTML={{ __html: previewData?.bodyPart4Html || '' }} />
                {!(previewData?.hasPart1 || previewData?.hasPart2 || previewData?.hasPart3) && (
                  <>
                    {images[1]?.url && <img src={images[1].url} alt={images[1].alt || ''} className="preview-body-img" />}
                    {images[2]?.url && <img src={images[2].url} alt={images[2].alt || ''} className="preview-body-img" />}
                    {images[3]?.url && <img src={images[3].url} alt={images[3].alt || ''} className="preview-body-img" />}
                  </>
                )}
                {images[4]?.url && <img src={images[4].url} alt={images[4].alt || ''} className="preview-body-img" />}
                <div dangerouslySetInnerHTML={{ __html: previewData?.conclusionHtml || '' }} />
                {previewData?.linksHtml && <div dangerouslySetInnerHTML={{ __html: previewData.linksHtml }} />}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setPreviewModalOpen(false); setPreviewData(null); setPreviewPendingAction(null); }} disabled={publishing || scheduling}>취소</button>
              <button className="btn btn-primary" onClick={confirmPreviewAndPublish} disabled={publishing || scheduling}>
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
function ImageSection({ images, kwList, onSwap, onUpload, onAltChange, onRefreshAll, onSearchKeyword, thumbBgIndex, onSelectThumbBg }) {
  const allLoading = images.every(img => img.loading);
  const hasAny     = images.some(img => img.url);
  const [imgQuery, setImgQuery] = React.useState('');

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
        <span className="label-hint img-hint-text">도입부 · 대주제1 · 중간전환 · 대주제2<br />마무리 5곳 자동 배치 · 클릭하면 썸네일 배경으로 선택</span>
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
                썸네일 배경으로 선택(라디오 방식), 선택된 카드는 테두리 강조 */}
            <div
              className={`image-thumb-wrap${thumbBgIndex === idx ? ' selected' : ''}`}
              onClick={() => img.url && !img.loading && onSelectThumbBg(idx)}
              role={img.url ? 'button' : undefined}
              title={img.url ? '클릭하면 썸네일 배경으로 선택됩니다' : undefined}
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
