import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import PostCreate from '../pages/PostCreate';
import './MainLayout.css';

export default function MainLayout() {
  const { pathname } = useLocation();
  const isPostCreate = pathname === '/post-create';

  return (
    <div className="app-shell">
      {/* macOS 트래픽 라이트 전용 드래그 영역 */}
      <div className="app-titlebar">
        <div className="app-titlebar-drag" />
      </div>

      {/* 사이드바 + 메인 콘텐츠 */}
      <div className="app-body">
        <Sidebar />
        <main className="main-content">
          {/* 글 생성: 항상 마운트 유지, CSS로 보이기/숨기기 (상태 보존) */}
          <div className="main-inner" style={{ display: isPostCreate ? 'block' : 'none' }}>
            <PostCreate />
          </div>
          {/* 나머지 페이지 */}
          <div className="main-inner" style={{ display: isPostCreate ? 'none' : 'block' }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
