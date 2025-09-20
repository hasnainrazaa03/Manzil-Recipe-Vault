const express = require('express');
const router = express.Router();
const Recipe = require('../models/Recipe');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/authMiddleware');

// === PUBLIC ROUTES ===
router.get('/public', async (req, res) => {
  try {
    const { search, page = 1, limit = 6 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let filter = {};
    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }

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

// === PROTECTED ROUTES ===
router.use(authMiddleware);

// GET /api/recipes - Get recipes for the logged-in user
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 6 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    let filter = { author: req.user.uid };
    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }
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
  const recipe = new Recipe({
    title: req.body.title, 
    image: req.body.image, 
    overview: req.body.overview,
    ingredients: req.body.ingredients, 
    instructions: req.body.instructions,
    author: req.user.uid,
    authorEmail: req.user.email
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
    const updatedRecipe = await Recipe.findByIdAndUpdate(
      req.params.id,
      req.body,
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

module.exports = router;