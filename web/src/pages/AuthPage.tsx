import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  type AuthError,
} from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/Icon';

type Mode = 'login' | 'signup' | 'reset';

/**
 * Firebase's raw error strings ("Firebase: Error (auth/invalid-credential).")
 * were being shown to users verbatim. These say what actually happened.
 */
const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password combination is not recognised.',
  'auth/invalid-email': 'That does not look like a valid email address.',
  'auth/user-not-found': 'No account exists for that email address.',
  'auth/wrong-password': 'That password is incorrect.',
  'auth/email-already-in-use': 'An account already exists for that email address.',
  'auth/weak-password': 'Choose a password of at least six characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
  'auth/network-request-failed': 'Could not reach the authentication service. Check your connection.',
};

function messageFor(error: unknown): string {
  const code = (error as AuthError)?.code;
  return ERROR_MESSAGES[code] ?? 'Something went wrong. Please try again.';
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => setError(null), [mode]);

  // Already signed in? Don't show a login form.
  if (!isLoading && user) return <Navigate to={from} replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
        toast.success('Welcome to Manzil Recipe Vault.');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      navigate(from, { replace: true });
    } catch (authError) {
      setError(messageFor(authError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsBusy(true);

    try {
      await sendPasswordResetEmail(auth, resetEmail);
      // Deliberately the same message whether or not the account exists, so
      // this form cannot be used to test which emails are registered.
      toast.success('If an account exists for that address, a reset link is on its way.');
      setMode('login');
      setResetEmail('');
    } catch (authError) {
      setError(messageFor(authError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setIsBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      navigate(from, { replace: true });
    } catch (authError) {
      setError(messageFor(authError));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="auth-container">
      {mode === 'reset' ? (
        <>
          <h1>Reset your password</h1>
          <form onSubmit={handleReset} noValidate>
            {error && (
              <p className="form-errors" role="alert">
                <Icon name="warning" size={18} />
                {error}
              </p>
            )}
            <div className="field">
              <label htmlFor="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary" disabled={isBusy}>
              {isBusy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <button type="button" onClick={() => setMode('login')} className="toggle-auth">
            Back to log in
          </button>
        </>
      ) : (
        <>
          <h1>{mode === 'signup' ? 'Create an account' : 'Log in'}</h1>

          <form onSubmit={handleSubmit} noValidate>
            {error && (
              <p className="form-errors" role="alert">
                <Icon name="warning" size={18} />
                {error}
              </p>
            )}

            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
              {mode === 'signup' && <span className="field-hint">At least six characters.</span>}
            </div>

            <button type="submit" className="btn-primary" disabled={isBusy}>
              {isBusy ? 'Please wait…' : mode === 'signup' ? 'Sign up' : 'Log in'}
            </button>
          </form>

          <div className="auth-links">
            {mode === 'login' && (
              <button type="button" onClick={() => setMode('reset')} className="forgot-password-btn">
                Forgot password?
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}
              className="toggle-auth"
            >
              {mode === 'signup' ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
            </button>
          </div>

          <div className="auth-separator">
            <span>or</span>
          </div>

          <button type="button" className="google-button" onClick={handleGoogle} disabled={isBusy}>
            <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>Continue with Google</span>
          </button>
        </>
      )}
    </div>
  );
}
