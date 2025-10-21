import React from 'react';
import { Link } from 'react-router-dom';
import { Rating } from 'react-simple-star-rating';

function RecipeCard({ recipe, onClick, user, onDelete, onEdit, isSaved, onToggleSave }) {

  const defaultImageUrl = 'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';
  

  const isAuthor = user && recipe && user.uid === recipe.author;

  return (
    <div className="recipe-card">
       <div className="card-image-container">
        <img src={recipe.image || defaultImageUrl} alt={recipe.title} onClick={onClick} />
        {user && typeof onToggleSave === 'function' && (
            <button onClick={() => onToggleSave(recipe._id)} className={`save-btn ${isSaved ? 'saved' : ''}`}>
              {isSaved ? <i className="fa fa-star"></i> : <i className="fa fa-star-o"></i>}
          </button>
        )}
      </div>
      <div className="card-content">
        <h2 onClick={onClick}>{recipe.title}</h2>
        <div className="card-rating">
          <Rating
            initialValue={recipe.averageRating || 0}
            readonly
            size={20}
            allowFraction
            fillColor="#FFC107" 
            emptyColor="#E4E5E9"
          />
          <span className="rating-count">({recipe.ratingCount || 0})</span>
        </div>
        {recipe.author && recipe.authorEmail && (
            <p className="author-email">
                By: <Link to={`/profile/${recipe.author}`}>{recipe.authorEmail}</Link>
            </p>
        )}
        <p onClick={onClick}>{recipe.overview}</p>
        {recipe.tags && recipe.tags.length > 0 && (
            <div className="tags-container">
                {recipe.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                ))}
            </div>
        )}
        {isAuthor && (
          <div className="card-actions">
            <button onClick={() => onEdit(recipe)}>Edit</button>
            <button onClick={() => onDelete(recipe._id)}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RecipeCard;