import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import PostCreate from './pages/PostCreate';
import Accounts from './pages/Accounts';
import History from './pages/History';
import Settings from './pages/Settings';
import PublishScheduler from './pages/PublishScheduler';
import Research from './pages/Research';
import ReviewQueue from './pages/ReviewQueue';
import LicenseGate from './components/LicenseGate';
import './styles/globals.css';

export default function App() {
  return (
    // 2026-07-13 신규: 라이선스 키가 있는데 문제(만료/서명무효/기기불일치/
    // 시간조작)가 있을 때만 아래 라우터 전체 대신 LicenseGate가 안내
    // 화면을 보여준다. 키가 없거나 정상이면 그대로 통과.
    <LicenseGate>
      <HashRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="post-create" element={null} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="research" element={<Research />} />
            <Route path="scheduler" element={<PublishScheduler />} />
            <Route path="review-queue" element={<ReviewQueue />} />
            <Route path="history" element={<History />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </LicenseGate>
  );
}
