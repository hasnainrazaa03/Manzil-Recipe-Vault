import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useDebounce from '../hooks/useDebounce';
import { toast } from 'react-toastify';
import ConfirmToast from '../components/ConfirmToast';
import RecipeCard from '../components/RecipeCard';
import RecipeModal from '../components/RecipeModal';

function HomePage({ 
  user, 
  recipes, 
  setRecipes, 
  onEdit, 
  view, 
  setView, 
  searchTerm, 
  setSearchTerm, 
  currentPage, 
  setCurrentPage, 
  totalPages,
  savedRecipeIds,
  onToggleSave,
  setRefetchTrigger
}) {
    const [selectedRecipe, setSelectedRecipe] = useState(null);
    const navigate = useNavigate();

    const handleRecipeUpdated = (updatedRecipe) => {
        setRecipes(prev => prev.map(r => r._id === updatedRecipe._id ? updatedRecipe : r));
        setSelectedRecipe(prev => prev?._id === updatedRecipe._id ? updatedRecipe : prev);
    };

    const handleDelete = (id) => {
        const proceedWithDelete = async () => {
            const token = await user.getIdToken();
            await fetch(`http://localhost:4000/api/recipes/${id}`, { 
                method: 'DELETE', 
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            toast.success('Recipe deleted!');

            if (recipes.length === 1 && currentPage > 1) {
                setCurrentPage(p => p - 1);
            } else {
                setRefetchTrigger(c => c + 1);
            }
        };

        toast.warn(<ConfirmToast 
            message="Are you sure you want to delete this recipe?" 
            onConfirm={proceedWithDelete} 
        />, {
            autoClose: false,
            closeOnClick: false,
            draggable: false,
        });
    };

    return (
        <>
            <nav className="view-toggle">
                <button onClick={() => setView('public')} className={view === 'public' ? 'active' : ''}>Public Recipes</button>
                {user && <button onClick={() => setView('private')} className={view === 'private' ? 'active' : ''}>My Recipes</button>}
            </nav>
            <div className="search-container">
                <input
                    type="text"
                    placeholder="Search for recipes by title..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />
            </div>
            <main id="recipe-grid">
                {recipes.map(recipe => (
                    <RecipeCard
                        key={recipe._id}
                        recipe={recipe}
                        onClick={() => setSelectedRecipe(recipe)}
                        user={user}
                        onDelete={handleDelete}
                        onEdit={onEdit}
                        isSaved={savedRecipeIds.has(recipe._id)}
                        onToggleSave={onToggleSave}
                    />
                ))}
            </main>

            {totalPages > 1 && (
                <div className="pagination-controls">
                    <button onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>Previous</button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>Next</button>
                </div>
            )}
            
            {selectedRecipe && (
                <RecipeModal
                    recipe={selectedRecipe}
                    onClose={() => setSelectedRecipe(null)}
                    user={user}
                    onCommentAdded={handleRecipeUpdated}
                />
            )}
        </>
    );
}

export default HomePage;