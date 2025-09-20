import React from 'react';
import { Link } from 'react-router-dom';

function RecipeCard({ recipe, onClick, user, onDelete, onEdit, isSaved, onToggleSave }) {

  const defaultImageUrl = 'https://images.pexels.com/photos/262959/pexels-photo-262959.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1';
  

  const isAuthor = user && recipe && user.uid === recipe.author;

  return (
    <div className="recipe-card">
       <div className="card-image-container">
        <img src={recipe.image || defaultImageUrl} alt={recipe.title} onClick={onClick} />
        {user && typeof onToggleSave === 'function' && (
            <button onClick={() => onToggleSave(recipe._id)} className={`save-btn ${isSaved ? 'saved' : ''}`}>
                {isSaved ? '★' : '☆'}
            </button>
        )}
      </div>
      <div className="card-content">
        <h2 onClick={onClick}>{recipe.title}</h2>
        {recipe.author && recipe.authorEmail && (
            <p className="author-email">
                By: <Link to={`/profile/${recipe.author}`}>{recipe.authorEmail}</Link>
            </p>
        )}
        <p onClick={onClick}>{recipe.overview}</p>
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