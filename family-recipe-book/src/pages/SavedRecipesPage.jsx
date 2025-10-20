import React, { useState, useEffect } from 'react';
import { auth } from '../firebase';
import RecipeCard from '../components/RecipeCard';
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function SavedRecipesPage({ user, savedRecipeIds, onToggleSave }) {
  const [recipes, setRecipes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    const fetchSavedRecipes = async () => {
      if (!user) return;
      setIsLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/users/saved-recipes?page=${currentPage}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        setRecipes(data.recipes);
        setTotalPages(data.totalPages);
      } catch (error) {
        console.error("Failed to fetch saved recipes:", error);
      }
      setIsLoading(false);
    };

    fetchSavedRecipes();
  }, [user, currentPage]);

  if (isLoading) {
   return (
     <div className="loading-container">
       <div className="spinner"></div>
       Loading Saved Recipes...
     </div>
   );
 }

  return (
    <div className="saved-recipes-page">
      <h2>My Saved Recipes</h2>
      {recipes.length > 0 ? (
        <main id="recipe-grid">
          {recipes.map(recipe => (
            <RecipeCard 
              key={recipe._id} 
              recipe={recipe} 
              user={user} 
              isSaved={savedRecipeIds.has(recipe._id)}
              onToggleSave={onToggleSave}
            />
          ))}
        </main>
      ) : (
       <div className="empty-state">
        <i className="fa fa-star-o" aria-hidden="true"></i>
        <p>You haven't saved any recipes yet.</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination-controls">
          <button onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>Previous</button>
          <span>Page {currentPage} of {totalPages}</span>
          <button onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>Next</button>
        </div>
      )}
    </div>
  );
}

export default SavedRecipesPage;