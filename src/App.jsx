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
import './styles/globals.css';

export default function App() {
  return (
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
  );
}
