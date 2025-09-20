import React, { useState } from 'react';

function RecipeModal({ recipe, onClose, user, onCommentAdded }) {
  const defaultImageUrl = 'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';
  
  const [currentRecipe, setCurrentRecipe] = useState(recipe);
  const [newComment, setNewComment] = useState('');

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || !user) return;

    try {
      const token = await user.getIdToken();
      const response = await fetch(`http://localhost:4000/api/recipes/${currentRecipe._id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text: newComment })
      });

      if (!response.ok) throw new Error('Failed to post comment');
      
      const updatedRecipe = await response.json();
      setCurrentRecipe(updatedRecipe);
      
  
      if (onCommentAdded) {
        onCommentAdded(updatedRecipe);
      }
      
      setNewComment('');
    } catch (error) {
      console.error("Error posting comment:", error);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <span className="close-button" onClick={onClose}>&times;</span>
        <img src={currentRecipe.image || defaultImageUrl} alt={currentRecipe.title} />
        <h2>{currentRecipe.title}</h2>
        <h3>Ingredients</h3>
        <p>{currentRecipe.ingredients}</p>
        <h3>Instructions</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{currentRecipe.instructions}</p>
        
        <hr />
        <div className="comments-section">
          <h3>Comments ({(currentRecipe.comments ?? []).length})</h3>
          
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
            {(currentRecipe.comments ?? []).map((comment) => (
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