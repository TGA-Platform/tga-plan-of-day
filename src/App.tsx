import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getUser } from './auth';
import { loadRolePermissions } from './lib/rolePermissions';
import { getPendingCount, flushQueue } from './utils/syncQueue';
import LoginPage from './pages/LoginPage';
import WeekOverviewPage from './pages/WeekOverviewPage';
import DayDetailPage from './pages/DayDetailPage';
import ConfigPage from './pages/ConfigPage';
import RatioDashboardPage from './pages/RatioDashboardPage';
import RatioSummaryPage from './pages/RatioSummaryPage';
import SettingsPage from './pages/SettingsPage';
import MorningBriefingPage from './pages/MorningBriefingPage';
import ReportingPage from './pages/ReportingPage';
import StaffingStructurePage from './pages/StaffingStructurePage';
import ComplianceConfigPage from './pages/ComplianceConfigPage';
import RosterBuilderPage from './pages/RosterBuilderPage';
import ErrorBoundary from './components/ErrorBoundary';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function OfflineBanner() {
  const [pendingCount, setPendingCount] = useState(getPendingCount);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const update = (e: Event) => setPendingCount((e as CustomEvent).detail.count);
    window.addEventListener('pod-queue-changed', update);
    return () => window.removeEventListener('pod-queue-changed', update);
  }, []);

  if (pendingCount === 0) return null;

  const handleRetry = async () => {
    setRetrying(true);
    await flushQueue();
    setPendingCount(getPendingCount());
    setRetrying(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#f59e0b', color: '#1c1917', padding: '8px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      fontSize: 14, fontWeight: 500, boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
    }}>
      <span>⚠️ {pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''} — waiting to sync to server</span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#1c1917', color: '#fef3c7', cursor: 'pointer', fontWeight: 600 }}
      >
        {retrying ? 'Retrying…' : 'Retry now'}
      </button>
    </div>
  );
}

export default function App() {
  // Pre-load role permissions so nav and guards reflect config immediately
  useEffect(() => { loadRolePermissions(); }, []);

  return (
    <ErrorBoundary>
      <OfflineBanner />
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <MorningBriefingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/week"
          element={
            <RequireAuth>
              <WeekOverviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/day/:date"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <DayDetailPage />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/config"
          element={
            <RequireAuth>
              <ConfigPage />
            </RequireAuth>
          }
        />
        <Route
          path="/ratio"
          element={
            <RequireAuth>
              <RatioDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/summary"
          element={
            <RequireAuth>
              <RatioSummaryPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route path="/reporting" element={<RequireAuth><ReportingPage /></RequireAuth>} />
        <Route path="/staffing" element={<RequireAuth><StaffingStructurePage /></RequireAuth>} />
        <Route path="/compliance-config" element={<RequireAuth><ComplianceConfigPage /></RequireAuth>} />
        <Route path="/roster" element={<RequireAuth><RosterBuilderPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
