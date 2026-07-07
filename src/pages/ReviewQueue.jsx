import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './ReviewQueue.css';

// ── 날짜 포맷 ─────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso.replace(' ', 'T'));
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return '-';
  }
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
// 반자동(半自動) 모드에서 자동화 루프가 미리 생성해둔 초안을,
// 사용자가 최종 검수 후 직접 발행 버튼을 눌러 게시하는 화면.
// (2026-07-05 신규 — 발행 스케줄러 아래 별도 사이드바 섹션으로 배치)
export default function ReviewQueue() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [publishingId, setPublishingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [movingId, setMovingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.post.getReviewQueue();
      if (res.success) setPosts(res.posts || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePublish = async (post) => {
    if (!window.confirm(`"${post.title}"\n\n이 글을 지금 발행하시겠습니까?`)) return;
    setPublishingId(post.id);
    const res = await window.electronAPI.post.publishReview(post.id);
    setPublishingId(null);
    if (res.success) {
      load();
    } else {
      window.alert(`발행 실패: ${res.error || '알 수 없는 오류'}`);
      load();
    }
  };

  const handleDelete = async (post) => {
    if (!window.confirm(`"${post.title}"\n\n이 검수 대기 글을 삭제하시겠습니까?`)) return;
    setDeletingId(post.id);
    await window.electronAPI.post.deleteReview(post.id);
    setDeletingId(null);
    load();
  };

  const parseContent = (post) => {
    try { return JSON.parse(post.content_json || '{}'); } catch { return {}; }
  };

  // 2026-07-07 신규: 검수 대기 글을 "글 생성" 화면으로 옮겨서 사용자가 직접
  // 수정한 뒤 즉시발행/예약발행을 할 수 있게 함(완전자동 누락 항목 회부 기능과
  // 함께 도입) — 옮기면 원본은 검수 대기 목록에서 삭제(사용자 확정 설계).
  const handleMoveToEditor = async (post) => {
    if (!window.confirm(`"${post.title}"\n\n이 글을 "글 생성" 화면으로 옮겨 수정하시겠습니까?\n(검수 대기 목록에서는 삭제됩니다)`)) return;
    setMovingId(post.id);
    const content = parseContent(post);
    let images = [];
    try { images = JSON.parse(post.images_json || '[]'); } catch { /* 무시 */ }
    let hashtags = [];
    try { hashtags = JSON.parse(post.hashtags || '[]'); } catch { /* 무시 */ }
    const reviewPost = {
      title: post.title,
      // 2026-07-08 신규: 썸네일 전용 문구도 함께 이동
      thumbText: content.thumbText || '',
      intro: content.intro || '',
      body: content.body || '',
      conclusion: content.conclusion || '',
      links: content.links || [],
      hashtags,
      images,
      accountId: post.account_id,
      category: post.category || '',
      visibility: post.visibility || 'public',
      autoThumbnail: !!post.auto_thumbnail,
      memo: post.memo || '',
    };
    await window.electronAPI.post.deleteReview(post.id);
    setMovingId(null);
    navigate('/post-create', { state: { reviewPost } });
  };

  return (
    <div className="review-queue">
      <div className="page-header">
        <div>
          <h1>검수 대기</h1>
          <p>반자동 모드로 자동 생성된 초안입니다. 검수 후 발행 버튼을 눌러야 실제로 게시됩니다.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          {loading ? '…' : '↻ 새로고침'}
        </button>
      </div>

      {loading ? (
        <div className="card">
          <div className="empty-state">
            <div className="spinner" style={{ margin: '0 auto 10px' }} />
            <p>불러오는 중…</p>
          </div>
        </div>
      ) : posts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>검수 대기 중인 글이 없습니다.</p>
            <p className="empty-sub">자동화 루프를 반자동 모드로 실행하면 여기에 초안이 쌓입니다.</p>
          </div>
        </div>
      ) : (
        <div className="review-list">
          {posts.map(post => {
            const content = parseContent(post);
            const expanded = expandedId === post.id;
            return (
              <div className="card review-item" key={post.id}>
                <div className="review-item-header" onClick={() => setExpandedId(expanded ? null : post.id)}>
                  <div className="review-item-main">
                    <span className="review-title">{post.title}</span>
                    <span className="review-meta">
                      👤 {post.account_nickname || post.account_naver_id || '알 수 없음'}
                      <span> · {formatDate(post.created_at)}</span>
                    </span>
                  </div>
                  <span className="review-expand-arrow">{expanded ? '▲' : '▼'}</span>
                </div>

                {post.memo && (
                  <div className="review-item-memo">⚠️ {post.memo}</div>
                )}

                {expanded && (
                  <div className="review-item-body">
                    {content.intro && <p className="review-section">{content.intro}</p>}
                    {content.body && <p className="review-section review-section-body">{content.body}</p>}
                    {content.conclusion && <p className="review-section">{content.conclusion}</p>}
                  </div>
                )}

                <div className="review-item-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleDelete(post)}
                    disabled={deletingId === post.id || publishingId === post.id || movingId === post.id}
                  >
                    {deletingId === post.id ? '삭제 중…' : '🗑 삭제'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleMoveToEditor(post)}
                    disabled={deletingId === post.id || publishingId === post.id || movingId === post.id}
                  >
                    {movingId === post.id ? '이동 중…' : '✏️ 글 생성으로 이동'}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handlePublish(post)}
                    disabled={publishingId === post.id || deletingId === post.id || movingId === post.id}
                  >
                    {publishingId === post.id ? '발행 중…' : '✓ 발행하기'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
