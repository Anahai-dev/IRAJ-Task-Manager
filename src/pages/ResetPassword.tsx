import React, { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { LayoutDashboard, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { apiPost } from '../lib/api';

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setError('');
      setLoading(true);

      await apiPost('/api/auth/reset-password', { token, newPassword: password });

      setSuccess(true);
      toast("Password reset successfully. You can now login.", 'success');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-page-bg p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-surface p-8 rounded-2xl shadow-2xl border border-border-subtle relative z-10 flex flex-col items-center">
        <div className="h-16 w-16 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-6 shadow-lg shadow-blue-500/20">
          <LayoutDashboard size={32} />
        </div>
        
        <h1 className="text-3xl font-bold text-strong mb-2 tracking-tight">Set New Password</h1>
        <p className="text-subtle text-sm mb-8 text-center max-w-xs">
          Please enter your new password below.
        </p>

        {success ? (
            <div className="w-full text-center p-8 bg-green-500/10 border border-green-500/20 rounded-xl">
                <span className="text-green-500 font-bold block mb-4">Password Reset!</span>
                <Link to="/login" className="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg font-bold tracking-widest hover:bg-blue-700 transition-colors">
                    GO TO LOGIN
                </Link>
            </div>
        ) : (
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center font-medium animate-in fade-in slide-in-from-top-2">
              {error}
            </div>
          )}

          <div className="space-y-4">
             <div>
                <label className="block text-xs font-bold tracking-wider text-muted uppercase mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg bg-surface-dim border border-border-strong px-4 py-3 text-sm text-strong focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-muted pr-10"
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-strong transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold tracking-wider text-muted uppercase mb-1">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-lg bg-surface-dim border border-border-strong px-4 py-3 text-sm text-strong focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder-muted pr-10"
                    placeholder="••••••••"
                    required
                    minLength={8}
                  />
                </div>
              </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-[12px] font-bold tracking-widest text-white hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-surface transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'RESETTING...' : 'RESET PASSWORD'}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
