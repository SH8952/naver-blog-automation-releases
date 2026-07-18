import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Accounts.css';
import useLicenseLimits, { PREMIUM_ONLY_TOOLTIP } from '../hooks/useLicenseLimits';

// ── 날짜 포맷 ─────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return '-';
  }
}

// ── 아이콘 ────────────────────────────────────────────────────
const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function Accounts() {
  const { limits } = useLicenseLimits();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addProgress, setAddProgress] = useState({ current: 0, total: 0 });
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({ nickname: '', memo: '', naver_id: '' });
  // 2026-07-17 추가: 계정 목록 열이 많아 가로 스크롤이 생기던 문제 —
  // 행마다 있던 삭제 버튼을 없애고, 상단 툴바의 작은 삭제 버튼으로
  // "선택 모드"를 켠 뒤 체크박스로 여러 계정을 골라 한 번에 삭제하는
  // 방식으로 변경.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ── 계정 순서 드래그 변경 (2026-07-17 7차 수정) ──────────────
  // 행 전체를 드래그해서 원하는 위치로 끌어놓으면 순서가 바뀌고,
  // DB(sort_order)에도 저장되어 재시작해도 유지됨. 편집 중이거나
  // 선택 삭제 모드일 때는 혼동을 막기 위해 드래그를 비활성화한다.
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const dragEnabled = !bulkMode && editingId === null;

  const handleRowDragStart = (idx) => setDragIndex(idx);

  const handleRowDragOver = (e, idx) => {
    e.preventDefault(); // 드롭을 허용하려면 반드시 필요
    if (dragIndex === null) return;
    if (idx !== dragOverIndex) setDragOverIndex(idx);
  };

  const handleRowDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleRowDrop = async (dropIdx) => {
    if (dragIndex === null || dragIndex === dropIdx) {
      handleRowDragEnd();
      return;
    }
    const reordered = [...accounts];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIdx, 0, moved);
    setAccounts(reordered); // 먼저 화면부터 즉시 반영(체감 반응성)
    handleRowDragEnd();

    const ids = reordered.map(a => a.id);
    const res = await window.electronAPI.account.reorder(ids);
    if (!res.success) {
      console.error('계정 순서 저장 실패:', res.error);
      loadAccounts(); // 저장 실패 시 실제 DB 상태로 다시 맞춤
    }
  };

  // ── 열 너비 (엑셀 방식 드래그 리사이즈, 2026-07-17 3차 수정) ──────
  // 사용자가 각 열 경계를 직접 드래그해서 늘리거나 줄일 수 있고,
  // 경계를 더블클릭하면 그 열의 실제 내용에 딱 맞는 최소 너비로
  // 자동 조정된다. 텍스트를 잘라내거나 말줄임표(...)로 숨기지 않고,
  // 사용자가 원하는 만큼만 좁히거나 넓힐 수 있게 하는 게 목적.
  const DEFAULT_WIDTHS = { id: 140, nickname: 100, status: 90, lastlogin: 130, memo: 110 };
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS);
  const resizingRef = useRef(null); // { col, startX, startWidth }
  const [resizingCol, setResizingCol] = useState(null); // 드래그 중인 열(하이라이트 표시용)
  const colWidthsRef = useRef(colWidths); // 저장 시점에 최신값을 정확히 읽기 위한 참조

  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // 2026-07-17 추가: 프로그램을 껐다 켜도 사용자가 조절한 열 너비가
  // 그대로 유지되도록, 기존 설정 저장 방식(settings.get/set)에 함께 저장.
  useEffect(() => {
    window.electronAPI.settings.get().then(res => {
      if (res.success && res.settings && res.settings.accountsColWidths) {
        setColWidths(prev => ({ ...prev, ...res.settings.accountsColWidths }));
      }
    });
  }, []);

  const persistColWidths = (widths) => {
    window.electronAPI.settings.get().then(res => {
      if (res.success && res.settings) {
        window.electronAPI.settings.set({ ...res.settings, accountsColWidths: widths });
      }
    });
  };

  const handleResizeMove = useCallback((e) => {
    const r = resizingRef.current;
    if (!r) return;
    const delta = e.clientX - r.startX;
    const next = Math.max(36, r.startWidth + delta); // 너무 좁아져서 아예 안 보이는 것 방지(최소 36px)
    setColWidths(prev => ({ ...prev, [r.col]: next }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingRef.current = null;
    setResizingCol(null);
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    persistColWidths(colWidthsRef.current); // 드래그가 끝난 시점의 최신 폭을 저장
  }, [handleResizeMove]);

  const handleResizeStart = (col, e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { col, startX: e.clientX, startWidth: colWidths[col] };
    setResizingCol(col);
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    // 드래그 중 텍스트가 선택되거나 커서가 깜빡이지 않도록
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // 경계 더블클릭 — 그 열의 실제 내용 중 가장 긴 것에 딱 맞는 최소 폭으로 조정
  // 2026-07-17 수정: 이미 줄바꿈된 상태에서 scrollWidth를 재면 "한 줄로
  // 폈을 때 진짜 필요한 폭"이 아니라 "지금 줄바꿈된 상태의 폭"이 측정돼,
  // 더블클릭할 때마다 미세하게 어긋나며 계속 커지는 문제가 있었음.
  // 측정하는 순간에만 강제로 한 줄(nowrap)로 펼쳐서 정확한 값을 재고
  // 즉시 원래 상태로 되돌린다.
  const handleAutoFit = (col) => {
    const cells = document.querySelectorAll(`[data-col="${col}"]`);
    let maxContent = 0;
    cells.forEach(el => {
      const prevWhiteSpace = el.style.whiteSpace;
      el.style.whiteSpace = 'nowrap';
      maxContent = Math.max(maxContent, el.scrollWidth);
      el.style.whiteSpace = prevWhiteSpace;
    });
    const next = Math.max(36, maxContent + 20); // 좌우 여백 보정
    setColWidths(prev => {
      const updated = { ...prev, [col]: next };
      persistColWidths(updated);
      return updated;
    });
  };

  useEffect(() => {
    // 컴포넌트가 사라질 때 혹시 드래그 중이던 리스너가 남아있지 않도록 정리
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [handleResizeMove, handleResizeEnd]);

  // ── 계정 목록 로드 ─────────────────────────────────────────
  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await window.electronAPI.account.getAll();
      if (res.success) {
        setAccounts(res.accounts);
      } else {
        // 진단용 로그 (2026-07-05 추가) — 조회 실패 시 콘솔에 표시
        console.error('계정 목록 조회 실패:', res.error);
      }
    } catch (err) {
      console.error('계정 로드 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ── 계정 추가 (로그인 창 바로 열기) ──────────────────────────
  const handleAddAccount = async () => {
    setAdding(true);
    setAddProgress({ current: 1, total: 1 });
    const res = await window.electronAPI.account.add();
    setAdding(false);
    setAddProgress({ current: 0, total: 0 });
    if (res.success) loadAccounts();
  };

  // ── 계정 삭제 (2026-07-17: 행별 삭제 버튼 → 상단 일괄 삭제로 대체) ──
  const toggleBulkMode = () => {
    setBulkMode(prev => !prev);
    setSelectedIds(new Set());
  };

  const toggleSelectOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(prev =>
      prev.size === accounts.length ? new Set() : new Set(accounts.map(a => a.id))
    );
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedIds.size}개 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await window.electronAPI.account.delete(id);
    }
    setAccounts(prev => prev.filter(a => !selectedIds.has(a.id)));
    setSelectedIds(new Set());
    setBulkMode(false);
  };

  // ── 재로그인 (만료된 계정) ─────────────────────────────────
  const handleReLogin = async () => {
    setAdding(true);
    setAddProgress({ current: 1, total: 1 });
    await window.electronAPI.account.add();
    setAdding(false);
    setAddProgress({ current: 0, total: 0 });
    loadAccounts();
  };

  // ── 인라인 편집 ───────────────────────────────────────────
  const startEdit = (account) => {
    setEditingId(account.id);
    setEditValues({ nickname: account.nickname || '', memo: account.memo || '', naver_id: account.naver_id || '' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues({ nickname: '', memo: '', naver_id: '' });
  };

  const saveEdit = async (id) => {
    const res = await window.electronAPI.account.update({
      id,
      nickname: editValues.nickname,
      memo: editValues.memo,
      naver_id: editValues.naver_id.trim(),
    });
    if (res.success) {
      setAccounts(prev =>
        prev.map(a =>
          a.id === id ? { ...a, nickname: editValues.nickname, memo: editValues.memo, naver_id: editValues.naver_id.trim() } : a
        )
      );
      setEditingId(null);
    }
  };

  const handleEditKey = (e, id) => {
    if (e.key === 'Enter') saveEdit(id);
    if (e.key === 'Escape') cancelEdit();
  };

  // ── 렌더 ──────────────────────────────────────────────────
  return (
    <div className="accounts">
      {/* 헤더 */}
      <div className="page-header">
        <div>
          <h1>계정 관리</h1>
          <p>
            최초 1회 수동 로그인 후 쿠키가 암호화되어 자동 저장됩니다.
            <br />
            네이버 앱 푸시 승인 방식의 2단계 인증 해제 후 추가
          </p>
        </div>
      </div>

      {/* 툴바 */}
      <div className="accounts-toolbar">
        <button
          className={`btn btn-primary${!limits.isPremium && accounts.length >= limits.maxAccounts ? ' premium-lock-host' : ''}`}
          onClick={handleAddAccount}
          disabled={adding || (!limits.isPremium && accounts.length >= limits.maxAccounts)}
          title={!limits.isPremium && accounts.length >= limits.maxAccounts ? PREMIUM_ONLY_TOOLTIP : undefined}
        >
          <PlusIcon />
          계정 추가
          {!limits.isPremium && accounts.length >= limits.maxAccounts && (
            <span className="premium-lock-overlay"><span className="premium-locked-badge">🔒 프리미엄</span></span>
          )}
        </button>

        {/* 진행 표시 */}
        {adding && (
          <div className="add-progress">
            <div className="spinner" />
            {addProgress.total > 1
              ? `로그인 중 (${addProgress.current}/${addProgress.total})… 창을 확인하세요`
              : '네이버 로그인 창을 확인하세요…'}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="account-count-badge">{accounts.length}개 계정</span>
          {!bulkMode ? (
            <button
              className="btn-bulk-toggle"
              onClick={toggleBulkMode}
              title="계정 삭제"
              disabled={accounts.length === 0}
            >
              <TrashIcon />
            </button>
          ) : (
            <div className="bulk-actions">
              <button
                className="btn-bulk-delete"
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
              >
                선택 삭제 ({selectedIds.size})
              </button>
              <button className="btn btn-ghost btn-sm" onClick={toggleBulkMode}>취소</button>
            </div>
          )}
        </div>
      </div>

      {/* 계정 테이블 */}
      <div className="card accounts-table-wrap">
        <table className="accounts-table">
          {/* 2026-07-17 3차 수정: colgroup으로 실제 열 너비를 제어 —
              사용자가 드래그로 조절한 값(colWidths)이 그대로 반영됨.
              2026-07-17 4차 수정: 선택삭제 체크박스를 별도 열로 추가하지
              않고, 기존 "편집" 칸 안에 왼쪽 정렬로 넣어 선택 모드를 켜도
              테이블 전체 폭이 늘어나지 않도록 함. */}
          <colgroup>
            <col style={{ width: 30 }} />
            <col style={{ width: colWidths.id }} />
            <col style={{ width: colWidths.nickname }} />
            <col style={{ width: colWidths.status }} />
            <col style={{ width: colWidths.lastlogin }} />
            <col style={{ width: colWidths.memo }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th className="resizable-th">
                <span className="measure-wrap" data-col="id">아이디</span>
                <span
                  className={`col-resize-handle${resizingCol === 'id' ? ' resizing' : ''}`}
                  onMouseDown={e => handleResizeStart('id', e)}
                  onDoubleClick={() => handleAutoFit('id')}
                  title="드래그로 너비 조절 · 더블클릭으로 자동 맞춤"
                />
              </th>
              <th className="resizable-th">
                <span className="measure-wrap" data-col="nickname">닉네임</span>
                <span
                  className={`col-resize-handle${resizingCol === 'nickname' ? ' resizing' : ''}`}
                  onMouseDown={e => handleResizeStart('nickname', e)}
                  onDoubleClick={() => handleAutoFit('nickname')}
                  title="드래그로 너비 조절 · 더블클릭으로 자동 맞춤"
                />
              </th>
              <th className="resizable-th">
                <span className="measure-wrap" data-col="status">상태</span>
                <span
                  className={`col-resize-handle${resizingCol === 'status' ? ' resizing' : ''}`}
                  onMouseDown={e => handleResizeStart('status', e)}
                  onDoubleClick={() => handleAutoFit('status')}
                  title="드래그로 너비 조절 · 더블클릭으로 자동 맞춤"
                />
              </th>
              <th className="resizable-th">
                <span className="measure-wrap" data-col="lastlogin">마지막 로그인</span>
                <span
                  className={`col-resize-handle${resizingCol === 'lastlogin' ? ' resizing' : ''}`}
                  onMouseDown={e => handleResizeStart('lastlogin', e)}
                  onDoubleClick={() => handleAutoFit('lastlogin')}
                  title="드래그로 너비 조절 · 더블클릭으로 자동 맞춤"
                />
              </th>
              <th className="resizable-th">
                <span className="measure-wrap" data-col="memo">메모</span>
                <span
                  className={`col-resize-handle${resizingCol === 'memo' ? ' resizing' : ''}`}
                  onMouseDown={e => handleResizeStart('memo', e)}
                  onDoubleClick={() => handleAutoFit('memo')}
                  title="드래그로 너비 조절 · 더블클릭으로 자동 맞춤"
                />
              </th>
              <th className="col-actions">
                {bulkMode && (
                  <input
                    type="checkbox"
                    checked={accounts.length > 0 && selectedIds.size === accounts.length}
                    onChange={toggleSelectAll}
                    title="전체 선택"
                  />
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <div className="spinner" style={{ margin: '0 auto 10px' }} />
                    <p>불러오는 중…</p>
                  </div>
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <div className="empty-icon">👤</div>
                    <p>등록된 계정이 없습니다.</p>
                    <p className="empty-sub">계정 추가 버튼을 눌러 네이버 계정을 등록하세요.</p>
                  </div>
                </td>
              </tr>
            ) : (
              accounts.map((acct, idx) => (
                <tr
                  key={acct.id}
                  className={[
                    editingId === acct.id ? 'row-editing' : '',
                    dragIndex === idx ? 'row-dragging' : '',
                    dragOverIndex === idx && dragIndex !== idx ? 'row-drag-over' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={dragEnabled}
                  onDragStart={() => handleRowDragStart(idx)}
                  onDragOver={e => handleRowDragOver(e, idx)}
                  onDrop={() => handleRowDrop(idx)}
                  onDragEnd={handleRowDragEnd}
                  style={dragEnabled ? { cursor: 'grab' } : undefined}
                  title={dragEnabled ? '행을 끌어서 순서를 바꿀 수 있습니다' : undefined}
                >
                  {/* # */}
                  <td className="col-idx">{idx + 1}</td>

                  {/* 아이디 */}
                  <td className="col-id">
                    {editingId === acct.id ? (
                      <input
                        className="input inline-input"
                        style={{ width: '120px', fontSize: '12px' }}
                        value={editValues.naver_id}
                        onChange={e => setEditValues(v => ({ ...v, naver_id: e.target.value }))}
                        onKeyDown={e => handleEditKey(e, acct.id)}
                        placeholder="블로그 아이디"
                        title="네이버 블로그 주소: blog.naver.com/[아이디]"
                      />
                    ) : (
                      <span
                        className="editable-cell"
                        data-col="id"
                        onClick={() => startEdit(acct)}
                        title="클릭하여 아이디 수정"
                        style={{ color: acct.naver_id?.startsWith('naver_') ? 'var(--danger)' : undefined }}
                      >
                        {acct.naver_id || <span className="placeholder-text">미확인</span>}
                        {acct.naver_id?.startsWith('naver_') && <span style={{ fontSize: '10px', marginLeft: 4, color: 'var(--danger)' }}>⚠ 수정 필요</span>}
                      </span>
                    )}
                  </td>

                  {/* 닉네임 */}
                  <td className="col-nickname">
                    {editingId === acct.id ? (
                      <input
                        className="input inline-input"
                        value={editValues.nickname}
                        onChange={e => setEditValues(v => ({ ...v, nickname: e.target.value }))}
                        onKeyDown={e => handleEditKey(e, acct.id)}
                        placeholder="닉네임 입력"
                        autoFocus
                      />
                    ) : (
                      <span className="editable-cell" data-col="nickname" onClick={() => startEdit(acct)}>
                        {acct.nickname || <span className="placeholder-text">편집</span>}
                      </span>
                    )}
                  </td>

                  {/* 상태 */}
                  <td className="col-status">
                    <span className="status-cell-wrap" data-col="status">
                      <span className={`status-badge status-${acct.status}`}>
                        {acct.status === 'active' ? '✓ 활성' : '⚠ 만료'}
                      </span>
                      {acct.status === 'expired' && (
                        <button
                          className="btn-relogin"
                          onClick={handleReLogin}
                          disabled={adding}
                          title="다시 로그인"
                        >
                          <RefreshIcon />
                          재로그인
                        </button>
                      )}
                    </span>
                  </td>

                  {/* 마지막 로그인 */}
                  <td className="col-lastlogin"><span className="measure-wrap" data-col="lastlogin">{formatDate(acct.last_login)}</span></td>

                  {/* 메모 */}
                  <td className="col-memo">
                    {editingId === acct.id ? (
                      <input
                        className="input inline-input"
                        value={editValues.memo}
                        onChange={e => setEditValues(v => ({ ...v, memo: e.target.value }))}
                        onKeyDown={e => handleEditKey(e, acct.id)}
                        placeholder="메모 입력"
                      />
                    ) : (
                      <span className="editable-cell" data-col="memo" onClick={() => startEdit(acct)}>
                        {acct.memo || <span className="placeholder-text">편집</span>}
                      </span>
                    )}
                  </td>

                  {/* 편집 액션 / 선택 삭제 체크박스 (2026-07-17 4차 수정:
                      별도 열 대신 같은 칸을 공유해 선택 모드를 켜도
                      테이블 폭이 늘어나지 않도록 함) */}
                  <td className="col-actions">
                    {editingId === acct.id ? null : bulkMode ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(acct.id)}
                        onChange={() => toggleSelectOne(acct.id)}
                      />
                    ) : dragEnabled ? (
                      <span className="drag-grip" title="행을 끌어서 순서를 바꿀 수 있습니다">⠿</span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 2026-07-17 9차 수정: 저장/취소 버튼을 테이블 안(좁은 칸)에 두지
          않고 테이블 바깥으로 완전히 빼서, 편집 중에도 테이블 자체의
          가로 스크롤이 생기지 않도록 함. */}
      {editingId !== null && (
        <div className="edit-float-actions">
          <button className="btn btn-primary btn-sm" onClick={() => saveEdit(editingId)}>저장</button>
          <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>취소</button>
        </div>
      )}
    </div>
  );
}
