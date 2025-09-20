const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
    unique: true, 
  },
  displayName: {
    type: String,
    required: true,
  },
  bio: {
    type: String,
    default: '',
  },
  profilePictureUrl: {
    type: String,
    default: '', 
  },
  savedRecipes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipe'
  }]
});

module.exports = mongoose.model('Profile', profileSchema);