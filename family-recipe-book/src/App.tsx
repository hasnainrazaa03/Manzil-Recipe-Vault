import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './styles/index.css';

import { Header } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AddRecipeButton } from './components/AddRecipeButton';
import { useTheme } from './context/ThemeContext';

import HomePage from './pages/HomePage';

// Split the routes a visitor may never open out of the initial bundle.
const RecipeDetailPage = lazy(() => import('./pages/RecipeDetailPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'));
const SavedRecipesPage = lazy(() => import('./pages/SavedRecipesPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageFallback() {
  return (
    <div className="loading-container">
      <div className="spinner" />
      <p>Loading…</p>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const { theme } = useTheme();

  return (
    <div className="App">
      <ToastContainer
        position="bottom-right"
        autoClose={4000}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme={theme}
      />

      <Header />

      <main id="main-content" tabIndex={-1}>
        {/* Keying the boundary on the path clears a caught error when the user
            navigates away, rather than stranding them on the fallback. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/recipe/:id" element={<RecipeDetailPage />} />
              <Route path="/profile/edit" element={<ProtectedRoute><EditProfilePage /></ProtectedRoute>} />
              <Route path="/profile/:userId" element={<ProfilePage />} />
              <Route
                path="/saved-recipes"
                element={<ProtectedRoute><SavedRecipesPage /></ProtectedRoute>}
              />
              <Route path="/login" element={<AuthPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>

      <AddRecipeButton />
    </div>
  );
}
