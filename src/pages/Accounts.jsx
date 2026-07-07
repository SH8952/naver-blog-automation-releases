import React, { useState, useEffect, useCallback } from 'react';
import './Accounts.css';

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
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addProgress, setAddProgress] = useState({ current: 0, total: 0 });
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({ nickname: '', memo: '', naver_id: '' });

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

  // ── 계정 삭제 ──────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('이 계정을 삭제하시겠습니까?')) return;
    const res = await window.electronAPI.account.delete(id);
    if (res.success) setAccounts(prev => prev.filter(a => a.id !== id));
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
          className="btn btn-primary"
          onClick={handleAddAccount}
          disabled={adding}
        >
          <PlusIcon />
          계정 추가
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

        <div style={{ marginLeft: 'auto' }}>
          <span className="account-count-badge">{accounts.length}개 계정</span>
        </div>
      </div>

      {/* 계정 테이블 */}
      <div className="card accounts-table-wrap">
        <table className="accounts-table">
          <thead>
            <tr>
              <th>#</th>
              <th>아이디</th>
              <th>닉네임</th>
              <th>상태</th>
              <th>마지막 로그인</th>
              <th>메모</th>
              <th>삭제</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <div className="spinner" style={{ margin: '0 auto 10px' }} />
                    <p>불러오는 중…</p>
                  </div>
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <div className="empty-icon">👤</div>
                    <p>등록된 계정이 없습니다.</p>
                    <p className="empty-sub">계정 추가 버튼을 눌러 네이버 계정을 등록하세요.</p>
                  </div>
                </td>
              </tr>
            ) : (
              accounts.map((acct, idx) => (
                <tr key={acct.id} className={editingId === acct.id ? 'row-editing' : ''}>
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
                      <span className="editable-cell" onClick={() => startEdit(acct)}>
                        {acct.nickname || <span className="placeholder-text">편집</span>}
                      </span>
                    )}
                  </td>

                  {/* 상태 */}
                  <td className="col-status">
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
                  </td>

                  {/* 마지막 로그인 */}
                  <td className="col-lastlogin">{formatDate(acct.last_login)}</td>

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
                      <span className="editable-cell" onClick={() => startEdit(acct)}>
                        {acct.memo || <span className="placeholder-text">편집</span>}
                      </span>
                    )}
                  </td>

                  {/* 삭제 / 편집 액션 (맨 오른쪽) */}
                  <td className="col-actions">
                    {editingId === acct.id ? (
                      <div className="action-btns">
                        <button className="btn btn-primary btn-sm" onClick={() => saveEdit(acct.id)}>저장</button>
                        <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>취소</button>
                      </div>
                    ) : (
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(acct.id)}
                        title="계정 삭제"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
