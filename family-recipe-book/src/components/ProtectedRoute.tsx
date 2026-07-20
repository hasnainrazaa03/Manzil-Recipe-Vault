import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  // Without this, a refresh on a protected page bounces to /login before
  // Firebase has finished restoring the session.
  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  // `state.from` lets the login page send the user back where they meant to go.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return <>{children}</>;
}
