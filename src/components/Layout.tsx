import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout, getUser } from '../auth';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const user = getUser();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f5f7f5' }}>
      {/* Header */}
      <header className="no-print text-white px-4 py-3 flex items-center justify-between shadow-lg" style={{ backgroundColor: '#1a2e1a' }}>
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm" style={{ backgroundColor: '#4a7a3a' }}>
            TGA
          </div>
          <div>
            <div className="font-bold text-base leading-tight">Plan of the Day</div>
            <div className="text-xs opacity-70">The Grove Academy</div>
          </div>
        </Link>

        <div className="flex items-center gap-4">
          {user && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <span className="opacity-70">Oatley</span>
              <span className="opacity-40">•</span>
              <span className="opacity-70">{user.name}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="text-sm px-3 py-1 rounded border border-white/30 hover:bg-white/10 transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="no-print text-center py-3 text-xs opacity-40">
        TGA Plan of the Day © {new Date().getFullYear()} The Grove Academy
      </footer>
    </div>
  );
}
