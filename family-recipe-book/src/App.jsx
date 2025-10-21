import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import useDebounce from './hooks/useDebounce';
import './App.css';
import { auth } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ConfirmToast from './components/ConfirmToast';
import HomePage from './pages/HomePage';
import ProfilePage from './pages/ProfilePage';
import AuthPage from './pages/AuthPage';
import EditProfilePage from './pages/EditProfilePage';
import ProtectedRoute from './components/ProtectedRoute';
import AddRecipeForm from './components/AddRecipeForm';
import SavedRecipesPage from './pages/SavedRecipesPage';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function App() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [view, setView] = useState('public');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 500);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [savedRecipeIds, setSavedRecipeIds] = useState(new Set());
  const [selectedTag, setSelectedTag] = useState(null);
  const [availableTags, setAvailableTags] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchUserSavedRecipes = async () => {
      if (user) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/users/profile/${user.uid}`);
          const data = await response.json();
          if (data && data.user && data.user.savedRecipes) {
            setSavedRecipeIds(new Set(data.user.savedRecipes));
          }
        } catch (error) { console.error("Could not fetch user profile for saved recipes", error); }
      } else {
        setSavedRecipeIds(new Set());
      }
    };
    fetchUserSavedRecipes();
  }, [user, refetchTrigger]);

  useEffect(() => {
    const fetchRecipes = async () => {
        let baseUrl = `${API_BASE_URL}/api/recipes`;
        const headers = {};
        let url;
        if (view === 'public') { url = `${baseUrl}/public`; }
        else if (user) {
            url = baseUrl;
            const token = await user.getIdToken();
            headers['Authorization'] = `Bearer ${token}`;
        } else { setRecipes([]); setTotalPages(0); return; }
        const params = new URLSearchParams();
        if (debouncedSearchTerm) { params.append('search', debouncedSearchTerm); }
        if (selectedTag) { params.append('tag', selectedTag); }
        params.append('page', currentPage);
        url += `?${params.toString()}`;
        try {
            const response = await fetch(url, { headers });
            const data = await response.json();
            setRecipes(Array.isArray(data.recipes) ? data.recipes : []);
            setTotalPages(data.totalPages || 0);
        } catch (error) { console.error("Failed to fetch recipes:", error); setRecipes([]); setTotalPages(0); }
    };
    if (view === 'private' && !user) { navigate('/login'); }
    else { fetchRecipes(); }
  }, [user, view, debouncedSearchTerm, currentPage, navigate, refetchTrigger, selectedTag]);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/recipes/tags`);
        const data = await response.json();
        if (Array.isArray(data)) {
          setAvailableTags(data);
        }
      } catch (error) {
        console.error("Failed to fetch tags:", error);
      }
    };
    fetchTags();
  }, [refetchTrigger]);

  useEffect(() => { setCurrentPage(1); setSelectedTag(null);}, [view, debouncedSearchTerm]);

  const handleRecipeAdded = () => { setIsFormModalOpen(false); setRefetchTrigger(c => c + 1); toast.success('Recipe added successfully!'); };
  const handleRecipeUpdated = (updatedRecipe) => { setRecipes(prev => prev.map(r => r._id === updatedRecipe._id ? updatedRecipe : r)); setEditingRecipe(null); setRefetchTrigger(c => c + 1); toast.success('Recipe updated successfully!'); };
  const handleEditClick = (recipe) => setEditingRecipe(recipe);
  const handleCancelForm = () => { setIsFormModalOpen(false); setEditingRecipe(null); };
  const handleLogout = async () => { await signOut(auth); navigate('/login'); };
  const handleToggleSave = async (recipeId) => {
    if (!user) return;
    const token = await user.getIdToken();
    const wasSaved = savedRecipeIds.has(recipeId);
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/save/${recipeId}`, { 
          method: 'PUT', 
          headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
          throw new Error("Failed to save recipe");
      }
      const updatedProfile = await response.json();
      setSavedRecipeIds(new Set(updatedProfile.savedRecipes));
      if (wasSaved) {
          toast.info('Recipe removed from saved!');
      } else {
          toast.success('Recipe saved!');
      }
      setRefetchTrigger(c => c + 1);
    } catch (error) {
      toast.error("Failed to update saved recipes.");
      console.error("Error toggling save:", error);
    }
  };
    const handleDelete = (id, currentRecipes) => {
    const proceedWithDelete = async () => {
        const token = await user.getIdToken();
        await fetch(`${API_BASE_URL}/api/recipes/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        toast.success('Recipe deleted!');

        if (currentRecipes.length === 1 && currentPage > 1) {
            setCurrentPage(p => p - 1);
        } else {
            setRefetchTrigger(c => c + 1);
        }
    };

    toast.warn(<ConfirmToast
        message="Are you sure you want to delete this recipe?"
        onConfirm={proceedWithDelete}
    />, {
        position: "top-center",
        autoClose: false,
        closeOnClick: false,
        draggable: false,
        closeButton: false,
        theme: "colored",
    });
  };

  if (isLoading) return (
    <div className="loading-container">
      <div className="spinner"></div>
      Loading Application...
    </div>
  );

  return (
    <div className="App">
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
      <header>
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }} onClick={() => setView('public')}>
          <img src="/logo.png" alt="Manzil Recipe Vault Logo" className="header-logo" />
        </Link>
        {user ? (
          <div className="user-info">
            <Link to="/saved-recipes" className="nav-link">Saved Recipes</Link>
            <Link to={`/profile/${user.uid}`} className="nav-link">My Profile</Link>
            <span>Welcome, {user.email}!</span>
            <button onClick={handleLogout} className="logout-button">Logout</button>
          </div>
        ) : ( <Link to="/login"><button className="login-button">Login</button></Link> )}
      </header>

      <Routes>
        <Route path="/" element={
          <HomePage
            user={user}
            recipes={recipes}
            setRecipes={setRecipes}
            onEdit={handleEditClick}
            view={view}
            setView={setView}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
            savedRecipeIds={savedRecipeIds}
            onToggleSave={handleToggleSave}
            handleDelete={handleDelete}
            selectedTag={selectedTag}
            setSelectedTag={setSelectedTag}
            availableTags={availableTags}
            setIsFormModalOpen={setIsFormModalOpen}
            setEditingRecipe={setEditingRecipe}
          />}
        />
        <Route path="/profile/:userId" element={
          <ProfilePage
            user={user}
            onEdit={handleEditClick}
            refetchTrigger={refetchTrigger}
            setRefetchTrigger={setRefetchTrigger}
            savedRecipeIds={savedRecipeIds}
            onToggleSave={handleToggleSave}
            handleDelete={handleDelete}
            setIsFormModalOpen={setIsFormModalOpen}
            setEditingRecipe={setEditingRecipe}
          />}
        />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/saved-recipes" element={<ProtectedRoute user={user}><SavedRecipesPage user={user} savedRecipeIds={savedRecipeIds} onToggleSave={handleToggleSave} /></ProtectedRoute>} />
        <Route path="/profile/edit" element={ <ProtectedRoute user={user}><EditProfilePage user={user} /></ProtectedRoute> } />
      </Routes>
      
      {user && (
        <button onClick={() => { setIsFormModalOpen(true); setEditingRecipe(null); }} className="floating-add-btn">
          <span className="text">Add Recipe</span>
          <span className="plus-icon">+</span>
        </button>
      )}
      {(isFormModalOpen || editingRecipe) && (
        <div className="modal">
          <div className="modal-content">
            <span className="close-button" onClick={handleCancelForm}>&times;</span>
            <AddRecipeForm user={user} onRecipeAdded={handleRecipeAdded} recipeToEdit={editingRecipe} onRecipeUpdated={handleRecipeUpdated} onCancelEdit={handleCancelForm} />
          </div>
        </div>
      )}
    </div>
  );
}
export default App;