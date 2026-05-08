import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    const user = login(email, password);
    if (user) {
      navigate('/');
    } else {
      setError('Invalid email or password');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#1a2e1a' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 text-white font-bold text-xl" style={{ backgroundColor: '#4a7a3a' }}>
            TGA
          </div>
          <h1 className="text-2xl font-bold text-white">Plan of the Day</h1>
          <p className="text-sm mt-1" style={{ color: '#a0c090' }}>The Grove Academy</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold mb-6" style={{ color: '#1a2e1a' }}>Sign in</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#4a5a4a' }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border text-base focus:outline-none focus:ring-2 transition-all"
                style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
                onFocus={e => e.target.style.borderColor = '#4a7a3a'}
                onBlur={e => e.target.style.borderColor = '#c0d0c0'}
                placeholder="you@tga.edu.au"
                required
                autoComplete="email"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: '#4a5a4a' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border text-base focus:outline-none focus:ring-2 transition-all"
                style={{ borderColor: '#c0d0c0', color: '#1a2e1a' }}
                onFocus={e => e.target.style.borderColor = '#4a7a3a'}
                onBlur={e => e.target.style.borderColor = '#c0d0c0'}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="text-red-600 text-sm bg-red-50 rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl text-white font-semibold text-base transition-all active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: '#4a7a3a' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
