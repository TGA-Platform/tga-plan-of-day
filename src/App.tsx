import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getUser } from './auth';
import LoginPage from './pages/LoginPage';
import WeekOverviewPage from './pages/WeekOverviewPage';
import DayDetailPage from './pages/DayDetailPage';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
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
              <DayDetailPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
