import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';

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
          setShowResetForm(false); // Close the reset form
          setResetEmail(''); // Clear the input
      } catch (error) {
          toast.error(error.message);
          console.error("Password reset error:", error);
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
          
          {!isSignUp && (
            <button onClick={() => setShowResetForm(true)} className="forgot-password-btn">
                Forgot Password?
            </button>
          )}

          <button onClick={() => setIsSignUp(!isSignUp)} className="toggle-auth">
            {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
          </button>
        </>
      )}
    </div>
  );
}

export default Auth;