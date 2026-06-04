import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getUser } from './auth';
import { loadRolePermissions } from './lib/rolePermissions';
import LoginPage from './pages/LoginPage';
import WeekOverviewPage from './pages/WeekOverviewPage';
import DayDetailPage from './pages/DayDetailPage';
import ConfigPage from './pages/ConfigPage';
import RatioDashboardPage from './pages/RatioDashboardPage';
import RatioSummaryPage from './pages/RatioSummaryPage';
import SettingsPage from './pages/SettingsPage';
import MorningBriefingPage from './pages/MorningBriefingPage';
import ReportingPage from './pages/ReportingPage';
import ErrorBoundary from './components/ErrorBoundary';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  // Pre-load role permissions so nav and guards reflect config immediately
  useEffect(() => { loadRolePermissions(); }, []);

  return (
    <ErrorBoundary>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
