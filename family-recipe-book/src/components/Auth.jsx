import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup} from 'firebase/auth';

function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const [resetEmail, setResetEmail] = useState('');
  const [showResetForm, setShowResetForm] = useState(false);
  
  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      navigate('/');
    } catch (error) {
      toast.error(error.message);
      console.error('Authentication error:', error);
    }
  };

  const handlePasswordReset = async (e) => {
      e.preventDefault();
      if (!resetEmail) {
          toast.error("Please enter your email address.");
          return;
      }
      try {
          await sendPasswordResetEmail(auth, resetEmail);
          toast.success("Password reset email sent! Check your inbox.");
          setShowResetForm(false);
          setResetEmail(''); 
      } catch (error) {
          toast.error(error.message);
          console.error("Password reset error:", error);
      }
  };

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider(); 
    try {
      await signInWithPopup(auth, provider); 
      navigate('/');
    } catch (error) {
      toast.error(error.message);
      console.error('Google sign-in error:', error);
    }
  };

return (
    <div className="auth-container">
      {showResetForm ? (
        <>
          <h2>Reset Password</h2>
          <form onSubmit={handlePasswordReset}>
            <input 
              type="email" 
              value={resetEmail} 
              onChange={(e) => setResetEmail(e.target.value)} 
              placeholder="Enter your account email" 
              required 
            />
            <button type="submit">Send Reset Email</button>
          </form>
          <button onClick={() => setShowResetForm(false)} className="toggle-auth">
            Back to Log In
          </button>
        </>
      ) : (
        <>
          <h2>{isSignUp ? 'Sign Up' : 'Log In'}</h2>
          <form onSubmit={handleAuth}>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="Email" 
              required 
            />
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="Password" 
              required 
            />
            <button type="submit">{isSignUp ? 'Sign Up' : 'Log In'}</button>
          </form>
         <div className="auth-links">
          {!isSignUp && (
            <button onClick={() => setShowResetForm(true)} className="forgot-password-btn">
                Forgot Password?
            </button>
          )}

          <button onClick={() => setIsSignUp(!isSignUp)} className="toggle-auth">
            {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
          </button>
          </div>

           <div className="auth-separator"><span>OR</span></div>

           <button className="gsi-material-button" onClick={handleGoogleSignIn}>
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlnsXlink="http://www.w3.org/1999/xlink" style={{display: 'block'}}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents">Sign in with Google</span>
              <span style={{display: 'none'}}>Sign in with Google</span>
            </div>
          </button>
        </>
      )}
    </div>
  );
}

export default Auth;