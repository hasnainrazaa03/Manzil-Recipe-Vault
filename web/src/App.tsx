import { lazy, Suspense, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './styles/index.css';

import { Header } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AddRecipeButton } from './components/AddRecipeButton';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { ScrollToTop } from './components/ScrollToTop';

import { useTheme } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import { useRecipeEditor } from './context/RecipeEditorContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useShoppingListSync } from './hooks/useShoppingListSync';
import { useNoOverlayOpen } from './context/OverlayContext';

import HomePage from './pages/HomePage';

// Split the routes a visitor may never open out of the initial bundle.
const RecipeDetailPage = lazy(() => import('./pages/RecipeDetailPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'));
const SavedRecipesPage = lazy(() => import('./pages/SavedRecipesPage'));
const ShoppingListPage = lazy(() => import('./pages/ShoppingListPage'));
const CollectionsPage = lazy(() => import('./pages/CollectionsPage'));
const CollectionDetailPage = lazy(() => import('./pages/CollectionDetailPage'));
const FeedPage = lazy(() => import('./pages/FeedPage'));
const FollowListPage = lazy(() => import('./pages/FollowListPage'));
const MealPlanPage = lazy(() => import('./pages/MealPlanPage'));
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
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user } = useAuth();
  const { openCreate } = useRecipeEditor();

  // Reconciles the local shopping list with the server on sign-in, and pushes
  // later changes. Mounted at the root so it runs wherever the user happens to
  // be when they sign in.
  useShoppingListSync();

  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  // Shortcuts stay silent while any dialog is open, so a bare letter cannot
  // stack a second modal on top of the first or navigate out from under one.
  const noOverlayOpen = useNoOverlayOpen();

  useKeyboardShortcuts(
    {
      meta: { k: () => setIsPaletteOpen((open) => !open) },
      keys: {
        '/': () => document.getElementById('recipe-search')?.focus(),
        '?': () => setIsHelpOpen(true),
        n: () => {
          if (user) openCreate();
        },
      },
      chords: {
        g: {
          h: () => navigate('/'),
          s: () => navigate('/saved-recipes'),
          l: () => navigate('/shopping-list'),
          p: () => user && navigate(`/profile/${user.uid}`),
          f: () => navigate('/feed'),
          c: () => navigate('/collections'),
          m: () => navigate('/meal-plan'),
        },
      },
    },
    noOverlayOpen && !isPaletteOpen,
  );

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

      <Header onOpenPalette={() => setIsPaletteOpen(true)} />

      <main id="main-content" tabIndex={-1}>
        {/* Keying the boundary on the path clears a caught error when the user
            navigates away, rather than stranding them on the fallback. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/recipe/:id" element={<RecipeDetailPage />} />
              <Route path="/shopping-list" element={<ShoppingListPage />} />
              <Route
                path="/profile/edit"
                element={<ProtectedRoute><EditProfilePage /></ProtectedRoute>}
              />
              <Route path="/profile/:userId" element={<ProfilePage />} />
              {/* Follower lists are public: they only ever show public profiles. */}
              <Route path="/profile/:userId/followers" element={<FollowListPage />} />
              <Route path="/profile/:userId/following" element={<FollowListPage />} />
              <Route
                path="/feed"
                element={<ProtectedRoute><FeedPage /></ProtectedRoute>}
              />
              <Route
                path="/collections"
                element={<ProtectedRoute><CollectionsPage /></ProtectedRoute>}
              />
              <Route
                path="/meal-plan"
                element={<ProtectedRoute><MealPlanPage /></ProtectedRoute>}
              />
              {/* Public, unlike the collections index. A public collection is
                  meant to be shareable, and the API serves it to anonymous
                  callers; requiring a sign-in here would have made the share
                  link useless to the person it was sent to. A private one still
                  returns 404 to anyone but its owner. */}
              <Route path="/collections/:id" element={<CollectionDetailPage />} />
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
      <ScrollToTop />

      <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
      <ShortcutsHelp isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
