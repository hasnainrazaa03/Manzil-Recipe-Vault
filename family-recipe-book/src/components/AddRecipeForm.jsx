import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import RichTextEditor from './RichTextEditor';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

function AddRecipeForm({ user, onRecipeAdded, recipeToEdit, onRecipeUpdated, onCancelEdit }) {
  const [formData, setFormData] = useState({
    title: '', image: '', overview: '', tags: ''
  });
  const [ingredients, setIngredients] = useState([{ amount: '', name: '' }]);
  const [instructionsContent, setInstructionsContent] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMethod, setUploadMethod] = useState('file');

  useEffect(() => {
    if (recipeToEdit) {
      const { ingredients: editIngredients, instructions: editInstructions, tags: editTags, ...restData } = recipeToEdit;
      const tagsString = Array.isArray(editTags) ? editTags.join(', ') : '';
      setFormData({...restData, tags: tagsString });
      setInstructionsContent(editInstructions || '');
      setIngredients(editIngredients && editIngredients.length > 0 ? editIngredients : [{ amount: '', name: '' }]);
      setImageFile(null);
      if (recipeToEdit.image) {
        setUploadMethod('url');
      }
    } else {
      setFormData({ title: '', image: '', overview: '', tags: '' });
      setInstructionsContent('');
      setIngredients([{ amount: '', name: '' }]);
      setUploadMethod('file');
    }
  }, [recipeToEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevData => ({ ...prevData, [name]: value }));
  };
  
  const handleIngredientChange = (index, field, value) => {
    const newIngredients = [...ingredients];
    newIngredients[index][field] = value;
    setIngredients(newIngredients);
  };

  const addIngredientField = () => {
    setIngredients([...ingredients, { amount: '', name: '' }]);
  };

  const removeIngredientField = (index) => {
    const newIngredients = [...ingredients];
    newIngredients.splice(index, 1);
    setIngredients(newIngredients);
  };

  const handleInstructionsChange = (content) => {
    setInstructionsContent(content);
  };

  const handleImageChange = (e) => {
    setImageFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    let imageUrl = formData.image;

    if (uploadMethod === 'file' && imageFile) {
      setIsUploading(true);
      const data = new FormData();
      data.append('file', imageFile);
      data.append('upload_preset', CLOUDINARY_UPLOAD_PRESET); 

      try {
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, 
          { method: 'POST', body: data }
        );
        const fileData = await response.json();
        imageUrl = fileData.secure_url;
      } catch (error) {
        console.error("Image upload failed:", error);
        toast.error("Image upload failed. Please try again.");
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    } else if (uploadMethod === 'url') {
        imageUrl = formData.image;
    } else {
        imageUrl = '';
    }

    const finalFormData = { ...formData, image: imageUrl, instructions: instructionsContent, ingredients: ingredients.filter(ing => ing.name.trim() !== '') };

    const token = await user.getIdToken();
    const isEditing = !!recipeToEdit;
    const url = isEditing ? `${API_BASE_URL}/api/recipes/${recipeToEdit._id}` : `${API_BASE_URL}/api/recipes`;
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(finalFormData),
      });

      if (!response.ok) throw new Error('Request failed');
      
      const result = await response.json();
      
      if (isEditing) {
        onRecipeUpdated(result);
      } else {
        onRecipeAdded(result);
      }
    } catch (error) {
      toast.error("Failed to save recipe.");
      console.error("Error submitting recipe:", error);
    }
  };

  return (
    <div className="form-container">
      <h2>{recipeToEdit ? 'Edit Recipe' : 'Add a New Recipe'}</h2>
      <form onSubmit={handleSubmit}>
        <input name="title" value={formData.title || ''} onChange={handleChange} placeholder="Recipe Title" required />
        
        <div className="image-upload-toggle">
            <label>Image:</label>
            <button type="button" onClick={() => setUploadMethod('file')} className={uploadMethod === 'file' ? 'active' : ''}>Upload File</button>
            <button type="button" onClick={() => setUploadMethod('url')} className={uploadMethod === 'url' ? 'active' : ''}>Use URL</button>
        </div>
        
        {uploadMethod === 'file' ? (
            <input type="file" onChange={handleImageChange} accept="image/png, image/jpeg" />
        ) : (
            <input name="image" value={formData.image || ''} onChange={handleChange} placeholder="Paste Image URL" />
        )}

        <textarea name="overview" value={formData.overview || ''} onChange={handleChange} placeholder="Brief Overview" required />
        
        <label>Ingredients:</label>
        <div className="ingredients-list">
          {ingredients.map((ing, index) => (
            <div className="ingredient-field" key={index}>
              <input
                type="text"
                name="amount"
                placeholder="Amount (e.g., 1 cup)"
                value={ing.amount || ''}
                onChange={(e) => handleIngredientChange(index, 'amount', e.target.value)}
                className="ingredient-amount"
              />
              <input
                type="text"
                name="name"
                placeholder="Ingredient Name (e.g., Flour)"
                value={ing.name || ''}
                onChange={(e) => handleIngredientChange(index, 'name', e.target.value)}
                className="ingredient-name"
                required={index === 0}
              />
              {ingredients.length > 1 && (
                <button 
                  type="button" 
                  onClick={() => removeIngredientField(index)}
                  className="remove-ingredient-btn"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          <button 
            type="button" 
            onClick={addIngredientField}
            className="add-ingredient-btn"
          >
            + Add Ingredient
          </button>
        </div>
        <label>Instructions:</label>
        <RichTextEditor
            content={instructionsContent}
            onChange={handleInstructionsChange}
            placeholder="Write the recipe steps..."
        />
        
        <label>Tags (comma-separated):</label>
        <input name="tags" value={formData.tags || ''} onChange={handleChange} placeholder="e.g., dessert, quick, vegan" />

        <button type="submit" disabled={isUploading}>
            {isUploading ? 'Uploading Image...' : (recipeToEdit ? 'Update Recipe' : 'Add Recipe')}
        </button>
        {recipeToEdit && <button type="button" onClick={onCancelEdit} disabled={isUploading}>Cancel</button>}
      </form>
    </div>
  );
}

export default AddRecipeForm;