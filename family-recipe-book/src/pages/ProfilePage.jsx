import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import RecipeCard from '../components/RecipeCard';
import RecipeModal from '../components/RecipeModal';

function ProfilePage({ user, onEdit, refetchTrigger, setRefetchTrigger, savedRecipeIds, onToggleSave, handleDelete }) {
  const [profileUser, setProfileUser] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const { userId } = useParams();
  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    const fetchProfileData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/users/profile/${userId}?page=${currentPage}`);
        const data = await response.json();
        setProfileUser(data.user);
        setRecipes(data.recipes);
        setTotalPages(data.totalPages || 0);
      } catch (error) {
        console.error("Failed to fetch profile data:", error);
      }
      setIsLoading(false);
    };

    if (userId) {
      fetchProfileData();
    }
  }, [userId, currentPage, refetchTrigger]);

  const isOwner = user && user.uid === userId;
  
  const handleRecipeUpdated = (updatedRecipe) => {
    setRecipes(prev => prev.map(r => r._id === updatedRecipe._id ? updatedRecipe : r));
    setSelectedRecipe(updatedRecipe);
  };
  
  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        Loading Profile...
      </div>
    );
  }
  if (!profileUser) return <div>User not found.</div>;

  return (
    <div className="profile-page">
      <div className="profile-header">
        {isOwner && <Link to="/profile/edit" className="edit-profile-btn">Edit Profile</Link>}
        <div className="profile-info">
            {profileUser.profilePictureUrl && 
                <img src={profileUser.profilePictureUrl} alt="Profile" className="profile-avatar" />
            }
            <div>
                <h2>{profileUser.displayName || profileUser.email}</h2>
                <p className="profile-bio">{profileUser.bio}</p>
            </div>
        </div>
      </div>

      <main id="recipe-grid">
        { recipes.length > 0 ? (
          recipes.map(recipe => (
            <RecipeCard
              key={recipe._id}
              recipe={recipe}
              user={user}
              onClick={() => setSelectedRecipe(recipe)}
              onDelete={isOwner ? () => handleDelete(recipe._id, recipes) : null}
              onEdit={isOwner ? onEdit : null}
              isSaved={savedRecipeIds.has(recipe._id)}
              onToggleSave={onToggleSave}
            />
          ))
        ) : (
          <div className="empty-state">
              <i className="fa fa-book" aria-hidden="true"></i>
              <p>This user hasn't added any recipes yet.</p>
          </div>
        )}
      </main>
      
      {totalPages > 1 && (
        <div className="pagination-controls">
            <button
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage === 1}
            >
                Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage === totalPages}
            >
                Next
            </button>
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
    </div>
  );
}

export default ProfilePage;