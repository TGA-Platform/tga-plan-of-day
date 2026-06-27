import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout, getUser } from '../auth';
import { canAccess } from '../lib/rolePermissions';

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate  = useNavigate();
  const user = getUser();

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F5FAF3', width: '100%' }}>
      {/* Header */}
      <header
        className="no-print px-5 py-3 flex items-center justify-between border-b"
        style={{ backgroundColor: '#ffffff', borderColor: '#E2F1DA', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3">
          <img src="/tga-logo.jpg" alt="The Grove Academy" className="h-10 w-auto object-contain" />
          <div>
            <div className="font-bold text-sm leading-tight" style={{ color: '#050505' }}>
              Plan of the Day
            </div>
            <div className="text-xs" style={{ color: '#596570' }}>Ratio Dashboard</div>
          </div>
        </Link>

        {/* Nav */}
        <div className="flex items-center gap-4">
          {user && (
            <nav className="hidden sm:flex items-center gap-3 text-sm font-medium">
              {canAccess(user.role, 'dashboard') && (
                <>
                  <Link to="/ratio" style={{ color: '#050505' }} className="hover:opacity-60 transition-opacity">Dashboard</Link>
                  <span style={{ color: '#D0E8B8' }}>|</span>
                </>
              )}
              {canAccess(user.role, 'reporting') && (
                <>
                  <Link to="/reporting" style={{ color: '#050505' }} className="hover:opacity-60 transition-opacity">Reports</Link>
                  <span style={{ color: '#D0E8B8' }}>|</span>
                </>
              )}
              {canAccess(user.role, 'summary') && (
                <>
                  <Link to="/summary" style={{ color: '#050505' }} className="hover:opacity-60 transition-opacity">All Centres</Link>
                  <span style={{ color: '#D0E8B8' }}>|</span>
                </>
              )}
              {canAccess(user.role, 'settings') && (
                <>
                  <Link to="/settings" style={{ color: '#050505' }} className="hover:opacity-60 transition-opacity">Settings</Link>
                  <span style={{ color: '#D0E8B8' }}>|</span>
                </>
              )}
              {/* Staff nav hidden — work in progress */}
              <span style={{ color: '#D0E8B8' }}>|</span>
              <a href="/guide" target="_blank" rel="noopener noreferrer" style={{ color: '#050505' }} className="hover:opacity-60 transition-opacity">Guide</a>
              <span style={{ color: '#D0E8B8' }}>|</span>
              <span style={{ color: '#596570' }}>{user.name}</span>
            </nav>
          )}
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="text-sm px-4 py-1.5 rounded-full font-semibold border transition-all hover:opacity-80"
            style={{ borderColor: '#2d5c18', color: '#5a9228', backgroundColor: '#F5FAF3' }}
          >
            Logout
          </button>
        </div>
      </header>

      <main style={{ flex: 1, width: '100%', maxWidth: '1600px', margin: '0 auto', padding: '24px 16px', boxSizing: 'border-box' }}>
        {children}
      </main>

      <footer className="no-print text-center py-3 text-xs" style={{ color: '#D0E8B8' }}>
        © {new Date().getFullYear()} The Grove Academy
      </footer>
    </div>
  );
}
