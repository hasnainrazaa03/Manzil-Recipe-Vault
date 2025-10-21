const express = require('express');
const router = express.Router();
const Recipe = require('../models/Recipe');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/authMiddleware');

// === PUBLIC ROUTES ===
router.get('/public', async (req, res) => {
  try {
    const { search, tag, page = 1, limit = 6 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let filter = {};
    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }
    if (tag) { filter.tags = tag; }
    const totalRecipes = await Recipe.countDocuments(filter);
    const recipes = await Recipe.find(filter)
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip);

    res.json({
      recipes,
      totalPages: Math.ceil(totalRecipes / limitNum),
      currentPage: pageNum,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/user/:userId', async (req, res) => {
    try {
        const recipes = await Recipe.find({ author: req.params.userId }).sort({ createdAt: -1 });
        res.json(recipes);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/tags', async (req, res) => {
  try {
    const tags = await Recipe.distinct('tags');
    res.json(tags.sort());
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ message: 'Failed to fetch tags' });
  }
});

// === PROTECTED ROUTES ===
router.use(authMiddleware);

// GET /api/recipes - Get recipes for the logged-in user
router.get('/', async (req, res) => {
  try {
    const { search, tag, page = 1, limit = 6 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    let filter = { author: req.user.uid};
    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }
    if (tag) { filter.tags = tag; }
    const totalRecipes = await Recipe.countDocuments(filter);
    const recipes = await Recipe.find(filter)
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip);
    res.json({
      recipes,
      totalPages: Math.ceil(totalRecipes / limitNum),
      currentPage: pageNum,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/recipes - Create a new recipe
router.post('/', async (req, res) => {
  const tagsArray = req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
  const recipe = new Recipe({
    title: req.body.title, 
    image: req.body.image, 
    overview: req.body.overview,
    ingredients: req.body.ingredients, 
    instructions: req.body.instructions,
    author: req.user.uid,
    authorEmail: req.user.email,
    tags: tagsArray
  });
  try {
    const newRecipe = await recipe.save();
    res.status(201).json(newRecipe);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

// DELETE /api/recipes/:id - Delete a recipe
router.delete('/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }
    if (recipe.author.toString() !== req.user.uid) {
      return res.status(403).json({ message: 'User not authorized to delete this recipe' });
    }
    await Recipe.findByIdAndDelete(req.params.id);
    res.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/recipes/:id - Update a recipe
router.put('/:id', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }
    if (recipe.author.toString() !== req.user.uid) {
      return res.status(403).json({ message: 'User not authorized to edit this recipe' });
    }
    
    const updateData = { ...req.body };
    if (req.body.tags) {
      updateData.tags = req.body.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
    } else {
      updateData.tags = [];
    }
    
    const updatedRecipe = await Recipe.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    res.json(updatedRecipe);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/recipes/:recipeId/comments - Add a comment to a recipe
router.post('/:recipeId/comments', async (req, res) => {
  try {
    const recipe = await Recipe.findById(req.params.recipeId);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }
    const authorProfile = await Profile.findOne({ user: req.user.uid });
    const newComment = {
      text: req.body.text,
      authorId: req.user.uid,
      authorEmail: req.user.email,
      authorDisplayName: authorProfile?.displayName || req.user.email,
      authorProfilePictureUrl: authorProfile?.profilePictureUrl || ''
    };
    recipe.comments.push(newComment);
    await recipe.save();
    res.status(201).json(recipe);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST /api/recipes/:recipeId/rate - Add or update a rating for a recipe
router.post('/:recipeId/rate', async (req, res) => {
  const { recipeId } = req.params;
  const { score } = req.body; // Expect a score (e.g., 1-5) in the body
  const { uid } = req.user; // User ID from authMiddleware

  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ message: 'Invalid score. Must be between 1 and 5.' });
  }

  try {
    const recipe = await Recipe.findById(recipeId);
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    // Find if the user has already rated this recipe
    const existingRatingIndex = recipe.ratings.findIndex(rating => rating.userId === uid);

    if (existingRatingIndex > -1) {
      // User has rated before - update their score
      recipe.ratings[existingRatingIndex].score = score;
    } else {
      // User is rating for the first time - add new rating
      recipe.ratings.push({ userId: uid, score });
    }

    // Recalculate average rating and count
    const totalScore = recipe.ratings.reduce((sum, rating) => sum + rating.score, 0);
    recipe.ratingCount = recipe.ratings.length;
    recipe.averageRating = recipe.ratingCount > 0 ? (totalScore / recipe.ratingCount) : 0;

    // Round average rating to one decimal place
    recipe.averageRating = Math.round(recipe.averageRating * 10) / 10;

    const updatedRecipe = await recipe.save();
    res.json(updatedRecipe); // Send back the full updated recipe

  } catch (error) {
    console.error("Error rating recipe:", error);
    res.status(500).json({ message: 'Failed to rate recipe.' });
  }
});

// GET /api/recipes/:recipeId/ratings - Get rating summary and user's score
router.get('/:recipeId/ratings', async (req, res) => {
  const { recipeId } = req.params;
  const { uid } = req.user; // User ID from authMiddleware

  try {
    const recipe = await Recipe.findById(recipeId).select('averageRating ratingCount ratings.userId ratings.score'); // Select only needed fields
    if (!recipe) {
      return res.status(404).json({ message: 'Recipe not found' });
    }

    // Find the current user's rating, if it exists
    const userRating = recipe.ratings.find(rating => rating.userId === uid);
    const userScore = userRating ? userRating.score : 0; // Default to 0 if not rated

    res.json({
      averageRating: recipe.averageRating,
      ratingCount: recipe.ratingCount,
      userScore: userScore,
    });

  } catch (error) {
    console.error("Error fetching ratings:", error);
    res.status(500).json({ message: 'Failed to fetch ratings.' });
  }
});

module.exports = router;