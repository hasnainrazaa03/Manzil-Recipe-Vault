import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RecipeCard from '../components/RecipeCard';
import RecipeModal from '../components/RecipeModal';

function HomePage({
  user, recipes, setRecipes, onEdit, view, setView, searchTerm, setSearchTerm,
  currentPage, setCurrentPage, totalPages, savedRecipeIds, onToggleSave, handleDelete,
  selectedTag, setSelectedTag, availableTags
}) {
    const [selectedRecipe, setSelectedRecipe] = useState(null);
    const navigate = useNavigate(); 

    const handleRecipeUpdated = (updatedRecipe) => {
        setRecipes(prev => prev.map(r => r._id === updatedRecipe._id ? updatedRecipe : r));
        setSelectedRecipe(prev => prev?._id === updatedRecipe._id ? updatedRecipe : prev);
    };

    console.log("HomePage received availableTags:", availableTags);

    return (
        <>
            <nav className="view-toggle">
                <button onClick={() => setView('public')} className={view === 'public' ? 'active' : ''}>Public Recipes</button>
                {user && <button onClick={() => setView('private')} className={view === 'private' ? 'active' : ''}>My Recipes</button>}
            </nav>
            <div className="search-container">
                <div className="search-input-wrapper">
                    <input
                        type="text"
                        placeholder="Search for recipes by title..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                    <span className="search-icon"><i className="fa fa-search search-icon" aria-hidden="true"></i></span>
                </div>
            </div>

            {availableTags && availableTags.length > 0 && (
                <div className="tag-filter-container">
                    <>
                        <span>Filter by Tag:</span>
                        {availableTags.map(tag => (
                            <button
                                key={tag}
                                onClick={() => setSelectedTag(tag)}
                                className={`tag-filter-btn ${selectedTag === tag ? 'active' : ''}`}
                            >
                                {tag}
                            </button>
                        ))}
                        {selectedTag && (
                            <button onClick={() => setSelectedTag(null)} className="tag-filter-btn clear">
                                Clear Filter
                            </button>
                        )}
                    </>
                </div>
            )}

            <main id="recipe-grid">
                {recipes.length > 0 ? (
                (recipes ?? []).map(recipe => (
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
                ))
            ) : (
                <div className="empty-state">
                    <i className="fa fa-folder-open-o" aria-hidden="true"></i>
                    <p>No recipes found matching your criteria.</p>
                </div>
                )}
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