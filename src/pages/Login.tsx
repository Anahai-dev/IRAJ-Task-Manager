import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, Eye, EyeOff, Gitlab, Github, Chrome } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin is from an expected host (run.app or localhost)
      const origin = event.origin;
      if (origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        login(undefined, event.data.user);
        navigate('/');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [login, navigate]);

  const handleGitLabLogin = async () => {
    try {
      const data = await apiGet<{ url: string }>(`/api/auth/gitlab/url?origin=${encodeURIComponent(window.location.origin)}`);
      
      const authWindow = window.open(data.url, 'gitlab_oauth', 'width=600,height=700');
      if (!authWindow) {
        alert('Please allow popups to sign in with GitLab.');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const data = await apiGet<{ url: string }>(`/api/auth/google/url?origin=${encodeURIComponent(window.location.origin)}`);
      
      const authWindow = window.open(data.url, 'google_oauth', 'width=600,height=700');
      if (!authWindow) {
        alert('Please allow popups to sign in with Google.');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGitHubLogin = async () => {
    try {
      const data = await apiGet<{ url: string }>(`/api/auth/github/url?origin=${encodeURIComponent(window.location.origin)}`);
      
      const authWindow = window.open(data.url, 'github_oauth', 'width=600,height=700');
      if (!authWindow) {
        alert('Please allow popups to sign in with GitHub.');
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await apiPost<{ user: Parameters<typeof login>[1] }>('/api/auth/login', { email, password });
      login(undefined, data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-page-bg px-4 py-12 font-sans text-primary overflow-hidden">
      {/* Dynamic Mesh Gradient Background */}
      <div className="absolute inset-0 z-0 bg-[#07090e]">
        {/* Glowing floating ambient light orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/20 blur-[120px] animate-float-slow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-600/20 blur-[130px] animate-float-reverse" />
        <div className="absolute top-[40%] left-[30%] w-[45%] h-[45%] rounded-full bg-indigo-500/15 blur-[150px] animate-pulse-slow" />
        <div className="absolute bottom-[20%] left-[-5%] w-[35%] h-[35%] rounded-full bg-cyan-500/10 blur-[110px] animate-float-slow" />

        {/* Crisp high-tech geometric grid pattern overlay */}
        <div 
          className="absolute inset-0 opacity-[0.12]" 
          style={{
            backgroundImage: `
              radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.25) 1.5px, transparent 0),
              linear-gradient(to right, rgba(148, 163, 184, 0.02) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(148, 163, 184, 0.02) 1px, transparent 1px)
            `,
            backgroundSize: '24px 24px, 24px 24px, 24px 24px'
          }}
        />

        {/* Subtle radial overlay for depth */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-transparent to-transparent opacity-80" />
      </div>

      {/* Actual login card with sleek glassmorphism design */}
      <div className="relative z-10 w-full max-w-sm space-y-6 rounded-xl bg-surface/80 backdrop-blur-xl border border-border-strong/50 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)] border-t-white/10 hover:border-blue-500/40 transition-all duration-500">
        <div className="flex flex-col items-center space-y-2">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-strong font-bold mb-2">
            Σ
          </div>
          <h2 className="text-sm font-bold tracking-tight text-strong uppercase">System Access</h2>
          <p className="text-[10px] text-subtle tracking-widest uppercase">DevTeam Task Manager</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded border border-red-500/20 bg-red-500/10 p-2 text-xs font-bold text-red-500 uppercase">{error}</div>}
          
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Email Identity</label>
            <input
              type="email"
              required
              className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-xs text-strong placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Authorization Key</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 pr-10 text-xs text-strong placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted hover:text-strong focus:outline-none transition-colors"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="flex justify-end mt-1">
              <Link to="/forgot-password" className="text-[10px] text-blue-500 hover:text-blue-400 font-bold block transition-colors">
                Forgot password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded bg-blue-600 px-4 py-2 text-[10px] font-bold tracking-wider text-strong hover:bg-blue-500 focus:outline-none shadow-sm hover:shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:-translate-y-0.5 transition-all duration-300"
          >
            INITIALIZE SESSION
          </button>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-border-subtle/40"></div>
            <span className="flex-shrink mx-4 text-[8px] text-subtle font-bold tracking-wider uppercase">Or connect via</span>
            <div className="flex-grow border-t border-border-subtle/40"></div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full rounded bg-white hover:bg-[#f8fafc] border border-[#dadce0] hover:border-[#c6c8cc] text-[#3c4043] px-4 py-2 text-[10px] font-bold tracking-wider focus:outline-none shadow-sm hover:shadow-[0_4px_14px_rgba(66,133,244,0.35)] hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center space-x-2"
            >
              <Chrome size={14} className="text-[#4285F4]" />
              <span>CONTINUE WITH GOOGLE</span>
            </button>

            <button
              type="button"
              onClick={handleGitHubLogin}
              className="w-full rounded bg-[#6f42c1] hover:bg-[#5f34ac] border border-[#562d99] text-white px-4 py-2 text-[10px] font-bold tracking-wider focus:outline-none shadow-sm hover:shadow-[0_4px_14px_rgba(111,66,193,0.35)] hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center space-x-2"
            >
              <Github size={14} className="text-white" />
              <span>CONTINUE WITH GITHUB</span>
            </button>

            <button
              type="button"
              onClick={handleGitLabLogin}
              className="w-full rounded bg-[#fc6d26] px-4 py-2 text-[10px] font-bold tracking-wider text-white hover:bg-[#e24329] focus:outline-none shadow-sm hover:shadow-[0_4px_14px_rgba(252,109,38,0.35)] hover:-translate-y-0.5 transition-all duration-300 flex items-center justify-center space-x-2"
            >
              <Gitlab size={14} />
              <span>CONTINUE WITH GITLAB</span>
            </button>
          </div>
        </form>

        <p className="text-center text-[10px] text-subtle uppercase tracking-widest pt-4 border-t border-border-subtle">
          No account?{' '}
          <Link to="/register" className="font-bold text-blue-400 hover:text-blue-300">
            Create Profile
          </Link>
        </p>
      </div>
    </div>
  );
}
