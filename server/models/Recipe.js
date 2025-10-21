const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  authorId: { type: String, required: true },
  authorEmail: { type: String, required: true },
  authorDisplayName: { type: String },
  authorProfilePictureUrl: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const ratingSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  score: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  image: { type: String, required: false },
  overview: { type: String, required: true },
  ingredients: { type: String, required: true },
  instructions: { type: String, required: true },
  author: { type: String, required: true },
  authorEmail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  tags: [{ type: String }],
  ratings: [ratingSchema],
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  ratingCount: {
    type: Number,
    default: 0,
  },
  comments: [commentSchema]
});

module.exports = mongoose.model('Recipe', recipeSchema);