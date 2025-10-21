import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { Link } from 'react-router-dom';
import { Rating } from 'react-simple-star-rating';
import DOMPurify from 'dompurify';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function RecipeModal({ recipe, onClose, user, onCommentAdded }) {
  const defaultImageUrl = 'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';
  const [newComment, setNewComment] = useState('');
  const [ratingData, setRatingData] = useState({ average: 0, count: 0, userScore: 0 });
  const [isRatingLoading, setIsRatingLoading] = useState(false);

  useEffect(() => {
    const fetchRatings = async () => {
      if (!user || !recipe?._id) return;
      setIsRatingLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/recipes/${recipe._id}/ratings`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch ratings');
        const data = await response.json();
        setRatingData({
          average: data.averageRating || 0,
          count: data.ratingCount || 0,
          userScore: data.userScore || 0
        });
      } catch (error) {
        console.error("Error fetching ratings:", error);
      }
      setIsRatingLoading(false);
    };

    fetchRatings();
    setNewComment('');
  }, [recipe, user]); 

  const handleRating = async (newScore) => {
    if (!user || !recipe?._id) return;
    setIsRatingLoading(true); 
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${API_BASE_URL}/api/recipes/${recipe._id}/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ score: newScore })
      });
      if (!response.ok) throw new Error('Failed to submit rating');
      const updatedRecipe = await response.json(); 

      
      setRatingData({
        average: updatedRecipe.averageRating,
        count: updatedRecipe.ratingCount,
        userScore: newScore 
      });
      toast.success("Thank you for rating!");

      if (onCommentAdded) { 
         onCommentAdded(updatedRecipe);
      }

    } catch (error) {
      toast.error("Failed to submit rating.");
      console.error("Error submitting rating:", error);
    }
    setIsRatingLoading(false);
  };

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

  const cleanInstructionsHTML = DOMPurify.sanitize(recipe.instructions);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content recipe-modal-content" onClick={(e) => e.stopPropagation()}>
        <span className="close-button" onClick={onClose}>&times;</span>
        <img src={recipe.image || defaultImageUrl} alt={recipe.title} />
        <h2>{recipe.title}</h2>
        
        {recipe.author && recipe.authorEmail && (
            <p className="author-email">
              By: <Link to={`/profile/${recipe.author}`} onClick={onClose}>{recipe.authorEmail}</Link>
            </p>
        )}
        
        {recipe.tags && recipe.tags.length > 0 && (
          <div className="tags-container modal-tags-container">
            {recipe.tags.map(tag => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        )}
        <div className="modal-rating-section">
          <div className="average-rating">
            <Rating
              initialValue={ratingData.average}
              readonly
              size={24}
              allowFraction
              fillColor="#FFC107"
              emptyColor="#E4E5E9"
            />
            <span>{ratingData.average.toFixed(1)} ({ratingData.count} reviews)</span>
          </div>
          {user && (
            <div className="user-rating">
              <label>Your Rating:</label>
              <Rating
                initialValue={ratingData.userScore}
                onClick={handleRating}
                size={28}
                fillColor="#FFC107"
                emptyColor="#E4E5E9"
                transition
                allowHover={!isRatingLoading} 
                readonly={isRatingLoading} 
              />
            </div>
          )}
        </div>
        <h3>Ingredients</h3>
        <ul className="ingredient-list">
            {(recipe.ingredients ?? []).map((ing, index) => (
              ing.name ? (
                <li key={index}>
                  {ing.amount} <strong>{ing.name}</strong>
                </li>
              ) : null
            ))}
        </ul>

        <h3>Instructions</h3>
        <div
          className="instruction-content"
          dangerouslySetInnerHTML={{ __html: cleanInstructionsHTML }}
        />

        <hr />
        <div className="comments-section">
          <h3>Comments ({(recipe.comments ?? []).length})</h3>
          
          {user ? (
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
          ) : (
             <p className="login-to-comment">Please <Link to="/login" onClick={onClose}>log in</Link> to add comments.</p>
          )}

          <div className="comments-list">
            {(recipe.comments ?? []).length > 0 ? (
                (recipe.comments ?? []).map((comment) => (
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
                )).reverse()
            ) : (
                !user && <p>No comments yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecipeModal;