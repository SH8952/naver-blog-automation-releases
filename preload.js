const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  /** OS 플랫폼('darwin'/'win32'/'linux') — Mac 전용 UI(트래픽라이트 여백 등) 분기용 (2026-07-08 신규) */
  platform: process.platform,

  // ── 계정 관리 ──────────────────────────────────────────────
  account: {
    /** 전체 계정 목록 조회 */
    getAll: () => ipcRenderer.invoke('account:getAll'),

    /** 네이버 로그인 창 열기 → 쿠키 추출 → DB 저장 */
    add: () => ipcRenderer.invoke('account:add'),

    /** 계정 삭제 */
    delete: (id) => ipcRenderer.invoke('account:delete', id),

    /** 닉네임·메모 수정 */
    update: (data) => ipcRenderer.invoke('account:update', data),

    /** 계정별 자동화 루프 포함/제외 토글 (2026-07-05 신규) */
    setLoopEnabled: (id, enabled) => ipcRenderer.invoke('account:setLoopEnabled', { id, enabled }),

    /** 계정별 자동화 루프 카테고리 배정 (2026-07-05 신규) */
    setLoopCategory: (id, category) => ipcRenderer.invoke('account:setLoopCategory', { id, category }),

    /** 계정별 네이버 블로그 발행 카테고리 지정 (2026-07-06 신규) */
    setNaverCategory: (id, category) => ipcRenderer.invoke('account:setNaverCategory', { id, category }),

    /** 계정별 추가 배정/네이버 카테고리 쌍 (2026-07-06 신규, 파일럿) */
    getCategoryPairs: (accountId) => ipcRenderer.invoke('account:getCategoryPairs', accountId),
    addCategoryPair: (accountId) => ipcRenderer.invoke('account:addCategoryPair', accountId),
    removeCategoryPair: (pairId) => ipcRenderer.invoke('account:removeCategoryPair', pairId),
    setCategoryPairCategory: (pairId, category) => ipcRenderer.invoke('account:setCategoryPairCategory', { pairId, category }),
    setCategoryPairNaverCategory: (pairId, category) => ipcRenderer.invoke('account:setCategoryPairNaverCategory', { pairId, category }),

  },

  // ── 환경설정 ───────────────────────────────────────────────
  settings: {
    /** 전체 설정 조회 */
    get: () => ipcRenderer.invoke('settings:get'),

    /** 전체 설정 저장 */
    set: (settings) => ipcRenderer.invoke('settings:set', settings),

    /** Gemini API 키 테스트 */
    testGemini: (key) => ipcRenderer.invoke('settings:testGemini', key),

    /** Groq API 키 테스트 */
    testGroq: (key) => ipcRenderer.invoke('settings:testGroq', key),

    /** OpenAI API 키 테스트 */
    testOpenai: (key) => ipcRenderer.invoke('settings:testOpenai', key),

    /** Claude API 키 테스트 */
    testClaude: (key) => ipcRenderer.invoke('settings:testClaude', key),

    /** Unsplash API 키 테스트 */
    testUnsplash: (key) => ipcRenderer.invoke('settings:testUnsplash', key),

    /** 네이버 Open API 테스트 */
    testNaverApi:  (id, secret)            => ipcRenderer.invoke('settings:testNaverApi', id, secret),
    testSearchAd:  (customerId, apiKey, secretKey) => ipcRenderer.invoke('settings:testSearchAd', customerId, apiKey, secretKey),
  },

  // ── 라이선스 (오프라인 서명 키, 2026-07-04 신규 / 2026-07-13 HWID 조회 추가) ──
  license: {
    /** 현재 라이선스 상태 조회 (등급/최대기기수/만료일/기기고정/시간조작 여부 등) */
    get: () => ipcRenderer.invoke('license:get'),

    /** 라이선스 키 적용 (빈 문자열 전달 시 라이선스 해제 → 스탠다드로 복귀) */
    set: (key) => ipcRenderer.invoke('license:set', key),

    /** 이 기기의 고유 식별값(HWID) 조회 — 문의 대응 시 참고용 */
    getHwid: () => ipcRenderer.invoke('license:getHwid'),

    /** 등급별 사용 제한값 조회 (2026-07-14 신규) — 계정수/자동화루프/예약발행/
     *  썸네일/키워드리서치 가능 여부 + 하루 최대 발행. 프론트엔드에서 버튼
     *  비활성화 여부 판단용. 실제 차단은 각 IPC 핸들러 내부에서 별도 수행. */
    getLimits: () => ipcRenderer.invoke('license:getLimits'),
  },

  // ── 글 생성 ────────────────────────────────────────────────
  post: {
    /** Gemini로 블로그 글 전체 생성 */
    generate: (params) => ipcRenderer.invoke('post:generate', params),

    /** 섹션별 재생성 */
    regenerateSection: (params) => ipcRenderer.invoke('post:regenerateSection', params),

    /** 발행 전 미리보기 — 수동/반자동 전용(2026-07-07 신규) */
    renderPreview: (params) => ipcRenderer.invoke('post:renderPreview', params),

    /** 주제 기반 SEO 키워드 자동 생성 */
    suggestKeywords: (params) => ipcRenderer.invoke('post:suggestKeywords', params),

    /** 반자동 검수 대기 목록 조회 (2026-07-05 신규) */
    getReviewQueue: () => ipcRenderer.invoke('post:getReviewQueue'),

    /** 검수 대기 글 최종 발행 */
    publishReview: (id) => ipcRenderer.invoke('post:publishReview', { id }),

    /** 검수 대기 글 삭제 */
    deleteReview: (id) => ipcRenderer.invoke('post:deleteReview', { id }),
  },

  // ── 자동화 루프 (2026-07-05 신규) ────────────────────────────
  automationLoop: {
    /** 자동화 루프 세부 설정 조회 */
    getSettings: () => ipcRenderer.invoke('automationLoop:getSettings'),

    /** 자동화 루프 세부 설정 저장 */
    setSettings: (settings) => ipcRenderer.invoke('automationLoop:setSettings', settings),

    /** 자동화 루프 시작 (mode: 'auto' | 'semi') */
    start: (mode) => ipcRenderer.invoke('automationLoop:start', { mode }),

    /** 자동화 루프 중지 */
    stop: () => ipcRenderer.invoke('automationLoop:stop'),

    /** 현재 실행 상태 조회 (대시보드 표시용) */
    getStatus: () => ipcRenderer.invoke('automationLoop:getStatus'),

    /** 키워드 소진 시 PC 종료 카운트다운 취소 */
    cancelShutdown: () => ipcRenderer.invoke('automationLoop:cancelShutdown'),
  },

  // ── 이미지 ─────────────────────────────────────────────────
  image: {
    /** 키워드 기반 Unsplash 이미지 3장 검색 */
    search: (params) => ipcRenderer.invoke('image:search', params),

    /** 이미지 1장 교체 */
    swapOne: (params) => ipcRenderer.invoke('image:swapOne', params),

    /** 로컬 이미지 파일 업로드 */
    upload: () => ipcRenderer.invoke('image:upload'),
  },

  // ── 발행 & 스케줄러 ────────────────────────────────────────
  publish: {
    /** 즉시 발행 (네이버 글쓰기 창 자동 열기) */
    now: (params) => ipcRenderer.invoke('publish:now', params),

    /** 예약 발행 등록 */
    schedule: (params) => ipcRenderer.invoke('publish:schedule', params),

    /** 예약 가능한 가장 빠른 시각 조회 (간격 제한 UI용) */
    getEarliestSlot: (params) => ipcRenderer.invoke('publish:getEarliestSlot', params),

    /** 발행/예약 목록 조회 */
    getAll: (filters) => ipcRenderer.invoke('publish:getAll', filters),

    /** 예약 취소 */
    cancel: (id) => ipcRenderer.invoke('publish:cancel', id),

    /** 이력 삭제 */
    delete: (id) => ipcRenderer.invoke('publish:delete', id),
  },

  // ── 대시보드 통계 ──────────────────────────────────────────
  dashboard: {
    getStats:        () => ipcRenderer.invoke('dashboard:getStats'),
    getTrend:        () => ipcRenderer.invoke('dashboard:getTrend'),
    getAccountStats: () => ipcRenderer.invoke('dashboard:getAccountStats'),
  },

  // ── [개발용] 데이터 초기화 / 등급 강제 전환 ────────────────
  // 2026-07-14: getTierOverride/setTierOverride는 메인 프로세스에서
  // isDev가 아니면 무조건 거부하므로, 배포판에서 호출해도 아무 효과 없음.
  dev: {
    reset: () => ipcRenderer.invoke('dev:reset'),
    getTierOverride: () => ipcRenderer.invoke('dev:getTierOverride'),
    setTierOverride: (value) => ipcRenderer.invoke('dev:setTierOverride', value),
  },

  // ── 글감 수집 ──────────────────────────────────────────────
  research: {
    getKeywords:   ()        => ipcRenderer.invoke('research:getKeywords'),
    addKeyword:    (data)    => ipcRenderer.invoke('research:addKeyword', data),
    deleteKeyword:    (id)  => ipcRenderer.invoke('research:deleteKeyword', id),
    deleteAllKeywords: ()   => ipcRenderer.invoke('research:deleteAllKeywords'),
    getTrends:         ()   => ipcRenderer.invoke('research:getTrends'),
    toggleActive:  (id, val) => ipcRenderer.invoke('research:toggleActive', id, val),
    collect:       (id)      => ipcRenderer.invoke('research:collect', id),
    getItems:      (kwId)    => ipcRenderer.invoke('research:getItems', kwId),
    deleteItem:    (id)      => ipcRenderer.invoke('research:deleteItem', id),
    toggleUsed:      (id, val)  => ipcRenderer.invoke('research:toggleUsed', id, val),
    analyzeKeyword:  (keywords) => ipcRenderer.invoke('keyword:analyze', keywords),

    /** 등록된 키워드에서 사용된 카테고리 목록(중복제거) 조회 (2026-07-05 신규) */
    getCategories: () => ipcRenderer.invoke('research:getCategories'),
  },

  // ── 블로그 ─────────────────────────────────────────────────
  blog: {
    /** 계정의 실제 블로그 카테고리 목록 조회 */
    getCategories: (accountId) => ipcRenderer.invoke('blog:getCategories', accountId),
    /** (2026-07-06 신규, 1단계 진단용) 카테고리별 주제분류 매칭 조사 */
    getCategoryTopics: (accountId) => ipcRenderer.invoke('blog:getCategoryTopics', accountId),
  },

  // ── 앱 시스템 ──────────────────────────────────────────────
  app: {
    /** 오류 로그 파일을 기본 에디터로 열기 */
    openLog:   () => ipcRenderer.invoke('app:openLog'),
    /** 오류 로그 내용 읽기 (마지막 200줄) */
    readLog:   () => ipcRenderer.invoke('app:readLog'),
    /** 오류 로그 초기화 */
    clearLog:  () => ipcRenderer.invoke('app:clearLog'),

    /** 자동화 루프 전용 로그 (2026-07-05 신규) */
    openLoopLog:  () => ipcRenderer.invoke('app:openLoopLog'),
    readLoopLog:  () => ipcRenderer.invoke('app:readLoopLog'),
    clearLoopLog: () => ipcRenderer.invoke('app:clearLoopLog'),
  },
});
