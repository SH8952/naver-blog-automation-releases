import React, { useState, useEffect } from 'react';
import './History.css';

const STATUS_LABEL = {
  published:       { label: '발행완료', cls: 'badge-published' },
  publishing:      { label: '발행중', cls: 'badge-publishing' },
  'pending_confirm': { label: '확인대기', cls: 'badge-publishing' },
  scheduled:       { label: '예약', cls: 'badge-scheduled' },
  failed:          { label: '실패', cls: 'badge-failed' },
  cancelled:       { label: '취소', cls: 'badge-cancelled' },
  draft:           { label: '임시저장', cls: 'badge-draft' },
};

function fmtDt(iso) {
  if (!iso) return '';
  // MM-DD HH:MM 형식으로 축약
  const s = iso.replace('T', ' ');
  return s.slice(5, 16); // "MM-DD HH:MM"
}

// ── CSV 내보내기 ──────────────────────────────────────────────
function exportCSV(posts) {
  const headers = ['ID', '제목', '계정', '상태', '예약일시', '발행일시', '링크', '오류'];
  const rows = posts.map(p => [
    p.id,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    `"${(p.account_nickname || p.naver_id || '').replace(/"/g, '""')}"`,
    p.status,
    p.scheduled_at || '',
    p.published_at || '',
    p.post_url || '',
    `"${(p.error_msg || '').replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `발행이력_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function History() {
  const [posts, setPosts]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQ, setSearchQ]   = useState('');

  const loadPosts = () => {
    setLoading(true);
    window.electronAPI.publish.getAll(filterStatus ? { status: filterStatus } : {}).then(res => {
      if (res.success) setPosts(res.posts);
      setLoading(false);
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 이력을 삭제하시겠습니까?')) return;
    await window.electronAPI.publish.delete(id);
    loadPosts();
  };

  useEffect(() => { loadPosts(); }, [filterStatus]);

  const filtered = posts.filter(p => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return (p.title || '').toLowerCase().includes(q) || (p.naver_id || '').toLowerCase().includes(q);
  });

  return (
    <div className="history">
      <div className="page-header">
        <div>
          <h1>발행 이력</h1>
          <p>발행된 모든 글의 기록을 확인합니다.</p>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="history-filters">
        <div className="history-search-wrap">
          <span className="history-search-icon">🔍</span>
          <input
            className="input history-search"
            placeholder="제목 또는 계정 검색…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>
        <select
          className="input history-status-filter"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">전체 상태</option>
          <option value="published">발행완료</option>
          <option value="scheduled">예약 대기</option>
          <option value="failed">실패</option>
          <option value="cancelled">취소</option>
        </select>
        <span className="history-count">{filtered.length}건</span>
        <button
          className="btn btn-ghost btn-sm history-export-btn"
          onClick={() => exportCSV(filtered)}
          disabled={filtered.length === 0}
          title="현재 목록을 CSV로 내보내기"
        >
          ↓ CSV 내보내기
        </button>
      </div>

      {loading ? (
        <div className="card">
          <div className="empty-state"><div className="empty-icon">⏳</div><p>불러오는 중…</p></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <p>{searchQ || filterStatus ? '검색 결과가 없습니다.' : '발행 이력이 없습니다.'}</p>
            <p className="empty-sub">글을 발행하면 이곳에 기록됩니다.</p>
          </div>
        </div>
      ) : (
        <div className="history-table-wrap card">
          <table className="history-table">
            <colgroup>
              <col /><col /><col /><col /><col /><col />
            </colgroup>
            <thead>
              <tr>
                <th>상태</th>
                <th>제목</th>
                <th>계정</th>
                <th>예약일시</th>
                <th>발행일시</th>
                <th>삭제</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(post => {
                const st = STATUS_LABEL[post.status] || { label: post.status, cls: 'badge-draft' };
                return (
                  <tr key={post.id}>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td className="history-title-cell">
                      <span title={post.title}>{post.title || '(제목 없음)'}</span>
                      {post.error_msg && (
                        <p className="history-error">⚠️ {post.error_msg}</p>
                      )}
                    </td>
                    <td className="history-account">
                      {post.account_nickname || post.naver_id || '—'}
                    </td>
                    <td className="history-date">{fmtDt(post.scheduled_at) || '—'}</td>
                    <td className="history-date">{fmtDt(post.published_at) || '—'}</td>
                    <td>
                      <button
                        className="history-delete-btn"
                        onClick={() => handleDelete(post.id)}
                        title="이력 삭제"
                      >🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
