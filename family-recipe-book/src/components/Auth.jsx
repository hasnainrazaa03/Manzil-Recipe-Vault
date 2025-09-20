import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { auth } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';

function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

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

  return (
    <div className="auth-container">
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
      <button onClick={() => setIsSignUp(!isSignUp)} className="toggle-auth">
        {isSignUp ? 'Already have an account? Log In' : "Don't have an account? Sign Up"}
      </button>
    </div>
  );
}

export default Auth;