import React, { useState, useEffect } from 'react';

function AddRecipeForm({ user, onRecipeAdded, recipeToEdit, onRecipeUpdated, onCancelEdit }) {
  const [formData, setFormData] = useState({
    title: '', image: '', overview: '', ingredients: '', instructions: ''
  });
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // --- NEW: State to toggle between upload methods ---
  const [uploadMethod, setUploadMethod] = useState('file'); // 'file' or 'url'

  useEffect(() => {
    if (recipeToEdit) {
      setFormData(recipeToEdit);
      setImageFile(null);
      // If the existing recipe has an image URL, default to URL method
      if (recipeToEdit.image) {
        setUploadMethod('url');
      }
    } else {
      setFormData({ title: '', image: '', overview: '', ingredients: '', instructions: '' });
      setUploadMethod('file');
    }
  }, [recipeToEdit]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevData => ({
      ...prevData,
      [name]: value
    }));
  };
  
  const handleImageChange = (e) => {
    setImageFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    let imageUrl = formData.image;

    // --- UPDATED: Only upload to Cloudinary if 'file' method is selected ---
    if (uploadMethod === 'file' && imageFile) {
      setIsUploading(true);
      const data = new FormData();
      data.append('file', imageFile);
      data.append('upload_preset', 'rku9fzct'); 

      try {
        const response = await fetch(
          'https://api.cloudinary.com/v1_1/dhnhsdgr9/image/upload', 
          {
            method: 'POST',
            body: data,
          }
        );
        const fileData = await response.json();
        imageUrl = fileData.secure_url;
      } catch (error) {
        console.error("Image upload failed:", error);
        alert("Image upload failed. Please try again.");
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    } else if (uploadMethod === 'url') {
        imageUrl = formData.image; // The URL is already in the form state
    } else {
        imageUrl = ''; // No image provided
    }

    const finalFormData = { ...formData, image: imageUrl };

    // This part remains the same
    const token = await user.getIdToken();
    const isEditing = !!recipeToEdit;
    const url = isEditing ? `http://localhost:4000/api/recipes/${recipeToEdit._id}` : 'http://localhost:4000/api/recipes';
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
        setFormData({ title: '', image: '', overview: '', ingredients: '', instructions: '' });
        setImageFile(null);
      }
    } catch (error) {
      console.error("Error submitting recipe:", error);
    }
  };

  return (
    <div className="form-container">
      <h2>{recipeToEdit ? 'Edit Recipe' : 'Add a New Recipe'}</h2>
      <form onSubmit={handleSubmit}>
        <input name="title" value={formData.title} onChange={handleChange} placeholder="Recipe Title" required />
        
        {/* --- NEW: Toggle buttons for image input method --- */}
        <div className="image-upload-toggle">
            <label>Image:</label>
            <button type="button" onClick={() => setUploadMethod('file')} className={uploadMethod === 'file' ? 'active' : ''}>Upload File</button>
            <button type="button" onClick={() => setUploadMethod('url')} className={uploadMethod === 'url' ? 'active' : ''}>Use URL</button>
        </div>
        
        {/* --- NEW: Conditionally render the correct input field --- */}
        {uploadMethod === 'file' ? (
            <input type="file" onChange={handleImageChange} accept="image/png, image/jpeg" />
        ) : (
            <input name="image" value={formData.image} onChange={handleChange} placeholder="Paste Image URL" />
        )}

        <textarea name="overview" value={formData.overview} onChange={handleChange} placeholder="Brief Overview" required />
        <textarea name="ingredients" value={formData.ingredients} onChange={handleChange} placeholder="Ingredients (comma separated)" required />
        <textarea name="instructions" value={formData.instructions} onChange={handleChange} placeholder="Instructions" required />
        
        <button type="submit" disabled={isUploading}>
            {isUploading ? 'Uploading Image...' : (recipeToEdit ? 'Update Recipe' : 'Add Recipe')}
        </button>
        {recipeToEdit && <button type="button" onClick={onCancelEdit} disabled={isUploading}>Cancel</button>}
      </form>
    </div>
  );
}

export default AddRecipeForm;