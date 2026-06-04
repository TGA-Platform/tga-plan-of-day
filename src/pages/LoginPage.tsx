import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginAsync, refreshAccessCache } from '../auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const user = await loginAsync(email, password);
    if (user) {
      await refreshAccessCache();
      navigate('/');
    } else {
      setError('Invalid email or password');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#F5FAF3' }}>
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/tga-logo.jpg"
            alt="The Grove Academy"
            className="h-24 w-auto object-contain mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold" style={{ color: '#2d5c18' }}>Plan of the Day</h1>
          <p className="text-sm mt-1" style={{ color: '#596570' }}>Ratio Dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg p-8 border" style={{ borderColor: '#E2F1DA' }}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#5a7050' }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border text-base focus:outline-none focus:ring-2 transition-all"
                style={{ borderColor: '#D0E8B8', color: '#2d3a28' }}
                onFocus={e => { e.target.style.borderColor = '#5a9228'; e.target.style.boxShadow = '0 0 0 3px #e8f5d4'; }}
                onBlur={e => { e.target.style.borderColor = '#D0E8B8'; e.target.style.boxShadow = 'none'; }}
                placeholder="you@tga.edu.au"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#5a7050' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border text-base focus:outline-none transition-all"
                style={{ borderColor: '#D0E8B8', color: '#2d3a28' }}
                onFocus={e => { e.target.style.borderColor = '#5a9228'; e.target.style.boxShadow = '0 0 0 3px #e8f5d4'; }}
                onBlur={e => { e.target.style.borderColor = '#D0E8B8'; e.target.style.boxShadow = 'none'; }}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="text-sm rounded-xl px-4 py-3" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl text-white font-semibold text-base transition-all active:scale-95 disabled:opacity-50 mt-2"
              style={{ backgroundColor: '#5a9228' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#596570' }}>
          © {new Date().getFullYear()} The Grove Academy
        </p>
      </div>
    </div>
  );
}
