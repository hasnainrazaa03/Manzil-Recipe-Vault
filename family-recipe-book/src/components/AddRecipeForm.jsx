import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

function AddRecipeForm({ user, onRecipeAdded, recipeToEdit, onRecipeUpdated, onCancelEdit }) {
  const [formData, setFormData] = useState({
    title: '', image: '', overview: '', ingredients: '', instructions: '', tags: ''
  });
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMethod, setUploadMethod] = useState('file');

  useEffect(() => {
    if (recipeToEdit) {
      const tagsString = Array.isArray(recipeToEdit.tags) ? recipeToEdit.tags.join(', ') : '';
      setFormData({...recipeToEdit, tags: tagsString });
      setImageFile(null);
      if (recipeToEdit.image) {
        setUploadMethod('url');
      }
    } else {
      setFormData({ title: '', image: '', overview: '', ingredients: '', instructions: '', tags: '' });
      setUploadMethod('file');
    }
  }, [recipeToEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevData => ({ ...prevData, [name]: value }));
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

    const finalFormData = { ...formData, image: imageUrl };

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
        <input name="title" value={formData.title} onChange={handleChange} placeholder="Recipe Title" required />
        
        <div className="image-upload-toggle">
            <label>Image:</label>
            <button type="button" onClick={() => setUploadMethod('file')} className={uploadMethod === 'file' ? 'active' : ''}>Upload File</button>
            <button type="button" onClick={() => setUploadMethod('url')} className={uploadMethod === 'url' ? 'active' : ''}>Use URL</button>
        </div>
        
        {uploadMethod === 'file' ? (
            <input type="file" onChange={handleImageChange} accept="image/png, image/jpeg" />
        ) : (
            <input name="image" value={formData.image} onChange={handleChange} placeholder="Paste Image URL" />
        )}

        <textarea name="overview" value={formData.overview} onChange={handleChange} placeholder="Brief Overview" required />
        <textarea name="ingredients" value={formData.ingredients} onChange={handleChange} placeholder="Ingredients (comma separated)" required />
        <textarea name="instructions" value={formData.instructions} onChange={handleChange} placeholder="Instructions" required />
        
        <label>Tags (comma-separated):</label>
        <input name="tags" value={formData.tags} onChange={handleChange} placeholder="e.g., dessert, quick, vegan" />

        <button type="submit" disabled={isUploading}>
            {isUploading ? 'Uploading Image...' : (recipeToEdit ? 'Update Recipe' : 'Add Recipe')}
        </button>
        {recipeToEdit && <button type="button" onClick={onCancelEdit} disabled={isUploading}>Cancel</button>}
      </form>
    </div>
  );
}

export default AddRecipeForm;