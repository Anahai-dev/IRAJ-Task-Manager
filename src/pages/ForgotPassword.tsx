import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { LayoutDashboard } from 'lucide-react';
import { apiPost } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [devTokenLink, setDevTokenLink] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      setSuccessMsg('');
      setDevTokenLink('');
      setLoading(true);

      const data = await apiPost<{ error?: string; message: string; resetLink?: string }>(
        '/api/auth/forgot-password',
        { email }
      );

      setSuccessMsg(data.message);
      if (data.resetLink) setDevTokenLink(data.resetLink); // Show for dev purposes
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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

      {/* Actual recover card with sleek glassmorphism design */}
      <div className="relative z-10 w-full max-w-sm space-y-6 rounded-xl bg-surface/80 backdrop-blur-xl border border-border-strong/50 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)] border-t-white/10 hover:border-blue-500/40 transition-all duration-500 flex flex-col items-center">
        <div className="flex flex-col items-center space-y-2 mb-2 w-full">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-strong font-bold mb-2">
            Σ
          </div>
          <h2 className="text-sm font-bold tracking-tight text-strong uppercase">Recover Password</h2>
          <p className="text-[10px] text-subtle tracking-widest uppercase">DevTeam Task Manager</p>
        </div>
        
        <p className="text-center text-[10px] text-subtle uppercase tracking-widest pb-2 border-b border-border-subtle/40 w-full">
          Enter your email to receive a password reset link.
        </p>

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          {error && (
            <div className="rounded border border-red-500/20 bg-red-500/10 p-2 text-xs font-bold text-red-500 uppercase text-center">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="rounded border border-green-500/20 bg-green-500/10 p-2 text-xs font-bold text-green-500 uppercase text-center flex flex-col space-y-2">
              <span>{successMsg}</span>
              {devTokenLink && (
                <Link to={new URL(devTokenLink).pathname} className="text-[10px] bg-green-500/20 px-2 py-1 rounded border border-green-500/30 text-green-400 hover:bg-green-500/30 transition-colors">
                  [Dev] Click to test reset link
                </Link>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[9px] font-bold text-subtle uppercase tracking-widest block">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded bg-surface-dim border border-border-subtle px-3 py-2 text-xs text-strong placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              placeholder="you@company.com"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-blue-600 px-4 py-2 text-[10px] font-bold tracking-wider text-strong hover:bg-blue-500 focus:outline-none shadow-sm hover:shadow-[0_4px_14px_rgba(37,99,235,0.4)] hover:-translate-y-0.5 transition-all duration-300 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'SENDING...' : 'SEND RESET LINK'}
          </button>
        </form>

        <div className="w-full pt-4 mt-4 border-t border-border-subtle text-center">
          <Link
            to="/login"
            className="text-[10px] font-bold tracking-widest text-blue-400 hover:text-blue-300 uppercase transition-colors block"
          >
            BACK TO LOGIN
          </Link>
        </div>
      </div>
    </div>
  );
}
