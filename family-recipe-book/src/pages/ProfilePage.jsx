import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import ConfirmToast from '../components/ConfirmToast';
import RecipeCard from '../components/RecipeCard';
import RecipeModal from '../components/RecipeModal';

function ProfilePage({ user, onEdit, refetchTrigger, setRefetchTrigger, savedRecipeIds, onToggleSave }) {
  const [profileData, setProfileData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const { userId } = useParams();

  useEffect(() => {
    const fetchProfileData = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`http://localhost:4000/api/users/profile/${userId}?page=${currentPage}`);
        const data = await response.json();
        setProfileData(data);
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
    setProfileData(prevData => ({
        ...prevData,
        recipes: prevData.recipes.map(r => r._id === updatedRecipe._id ? updatedRecipe : r)
    }));
    setSelectedRecipe(updatedRecipe);
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

  if (isLoading) return <div className="loading-container">Loading Profile...</div>;
  if (!profileData || !profileData.user) return <div>User not found.</div>;

  return (
    <div className="profile-page">
      <div className="profile-header">
        {isOwner && <Link to="/profile/edit" className="edit-profile-btn">Edit Profile</Link>}
        <div className="profile-info">
            {profileData.user.profilePictureUrl && 
                <img src={profileData.user.profilePictureUrl} alt="Profile" className="profile-avatar" />
            }
            <div>
                <h2>{profileData.user.displayName || profileData.user.email}</h2>
                <p className="profile-bio">{profileData.user.bio}</p>
            </div>
        </div>
      </div>

      <main id="recipe-grid">
        {profileData.recipes.map(recipe => (
          <RecipeCard 
            key={recipe._id} 
            recipe={recipe} 
            user={user} 
            onClick={() => setSelectedRecipe(recipe)}
            onDelete={isOwner ? handleDelete : null}
            onEdit={isOwner ? onEdit : null}
            isSaved={savedRecipeIds.has(recipe._id)}
            onToggleSave={onToggleSave}
          />
        ))}
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