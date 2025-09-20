import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function RecipeModal({ recipe, onClose, user, onCommentAdded }) {
  const defaultImageUrl = 'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
      setNewComment('');
  }, [recipe]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !user) return;

    try {
      const token = await user.getIdToken();
      const response = await fetch(`${API_BASE_URL}/api/recipes/${recipe._id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text: newComment })
      });

      if (!response.ok) throw new Error('Failed to post comment');
      
      const updatedRecipe = await response.json();
      
      if (onCommentAdded) {
        onCommentAdded(updatedRecipe);
      }
      
      setNewComment('');
    } catch (error) {
      toast.error("Error posting comment.");
      console.error("Error posting comment:", error);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <span className="close-button" onClick={onClose}>&times;</span>
        <img src={recipe.image || defaultImageUrl} alt={recipe.title} />
        <h2>{recipe.title}</h2>
        <h3>Ingredients</h3>
        <p>{recipe.ingredients}</p>
        <h3>Instructions</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{recipe.instructions}</p>
        
        <hr />
        <div className="comments-section">
          <h3>Comments ({(recipe.comments ?? []).length})</h3>
          
          {user && (
            <form onSubmit={handleCommentSubmit} className="comment-form">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                rows="3"
                required
              />
              <button type="submit">Post Comment</button>
            </form>
          )}

          <div className="comments-list">
            {(recipe.comments ?? []).map((comment) => (
              <div key={comment._id} className="comment">
                <div className="comment-author-info">
                  <img 
                    src={comment.authorProfilePictureUrl || 'https://i.imgur.com/346c9kE.png'} 
                    alt="author avatar" 
                    className="comment-avatar"
                  />
                  <span className="comment-author-name">
                    {comment.authorDisplayName || comment.authorEmail}
                  </span>
                </div>
                <p className="comment-text">{comment.text}</p>
                <p className="comment-date">
                  {new Date(comment.createdAt).toLocaleDateString()}
                </p>
              </div>
            )).reverse()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecipeModal;