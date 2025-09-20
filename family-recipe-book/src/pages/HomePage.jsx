import React, { useState } from 'react';
import RecipeCard from '../components/RecipeCard';
import RecipeModal from '../components/RecipeModal';

function HomePage({ 
  user, recipes, setRecipes, onEdit, view, setView, searchTerm, setSearchTerm, 
  currentPage, setCurrentPage, totalPages, savedRecipeIds, onToggleSave, handleDelete 
}) {
    const [selectedRecipe, setSelectedRecipe] = useState(null);

    const handleRecipeUpdated = (updatedRecipe) => {
        setRecipes(prev => prev.map(r => r._id === updatedRecipe._id ? updatedRecipe : r));
        setSelectedRecipe(prev => prev?._id === updatedRecipe._id ? updatedRecipe : prev);
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
                        onDelete={() => handleDelete(recipe._id, recipes)}
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