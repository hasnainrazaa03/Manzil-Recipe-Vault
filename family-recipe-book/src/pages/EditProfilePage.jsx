import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';

function EditProfilePage() {
  const [profileData, setProfileData] = useState({ displayName: '', bio: '' });
  const [profilePictureFile, setProfilePictureFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const user = auth.currentUser;
  
  useEffect(() => {
    if (user) {
      fetch(`http://localhost:4000/api/users/profile/${user.uid}`)
        .then(res => res.json())
        .then(data => {
          setProfileData({
            displayName: data.user.displayName || '',
            bio: data.user.bio || '',
            profilePictureUrl: data.user.profilePictureUrl || ''
          });
        });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setProfilePictureFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    let profilePictureUrl = profileData.profilePictureUrl;


    if (profilePictureFile) {
      const data = new FormData();
      data.append('file', profilePictureFile);
      data.append('upload_preset', 'rku9fzct');  

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/dhnhsdgr9/image/upload`, 
        { method: 'POST', body: data }
      );
      const fileData = await response.json();
      profilePictureUrl = fileData.secure_url;
    }

  
    const token = await user.getIdToken();
    await fetch('http://localhost:4000/api/users/me', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        displayName: profileData.displayName,
        bio: profileData.bio,
        profilePictureUrl: profilePictureUrl
      })
    });

    setIsLoading(false);
  
    navigate(`/profile/${user.uid}`);
  };

  return (
    <div className="form-container">
      <h2>Edit Profile</h2>
      <form onSubmit={handleSubmit}>
        <label>Display Name:</label>
        <input name="displayName" value={profileData.displayName} onChange={handleChange} placeholder="Your Name" required />
        
        <label>Bio:</label>
        <textarea name="bio" value={profileData.bio} onChange={handleChange} placeholder="A little about yourself" />
        
        <label>Profile Picture:</label>
        <input type="file" onChange={handleFileChange} accept="image/png, image/jpeg" />
        {profileData.profilePictureUrl && !profilePictureFile && (
            <img src={profileData.profilePictureUrl} alt="Current profile" style={{width: '100px', height: '100px', borderRadius: '50%', marginTop: '10px'}}/>
        )}
        
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

export default EditProfilePage;