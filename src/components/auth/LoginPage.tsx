import { useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Layers3, Landmark, Loader2, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useSignIn } from '@/hooks/useAuth';

export function LoginPage() {
  const navigate = useNavigate();
  const signIn   = useSignIn();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await signIn.mutateAsync({
        username: username.trim(),
        password,
      });
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }

  return (
    <div className="login-shell">
      {/* Left panel — branding */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <div className="brand-mark" style={{ width: 48, height: 48, borderRadius: 12, fontSize: 22 }}>
              <Layers3 size={26} />
            </div>
            <div>
              <div className="login-logo-name">KJET<span>.</span></div>
              <div className="login-logo-sub">ENTERPRISE TRANSFORMATION</div>
            </div>
          </div>

          <div className="login-brand-text">
            <h1>Co-Investment Portfolio Dashboard</h1>
            <p>
              Kenya Jobs and Economic Transformation · Cohort 1<br />
              85 beneficiary MSE clusters across Kenya
            </p>
          </div>

          <div className="login-brand-badges">
            <div className="login-badge">
              <Landmark size={13} />
              <span>Implemented by MSEA</span>
            </div>
            <div className="login-badge">
              <span>Republic of Kenya</span>
            </div>
            <div className="login-badge">
              <span>World Bank Funded · Component 2</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — sign in form */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          <div className="login-form-header">
            <h2>Sign in</h2>
            <p>Access the KJET Cohort 1 portfolio dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            {/* Error message */}
            {error && (
              <div className="login-error" role="alert">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            {/* Username */}
            <div className="login-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                placeholder="Enter your username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={signIn.isPending}
              />
            </div>

            {/* Password */}
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="login-password-wrap">
                <input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={signIn.isPending}
                />
                <button
                  type="button"
                  className="login-pwd-toggle"
                  onClick={() => setShowPwd(s => !s)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="login-btn"
              disabled={signIn.isPending || !username.trim() || !password}
            >
              {signIn.isPending ? (
                <><Loader2 size={16} className="animate-spin" />Signing in...</>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


