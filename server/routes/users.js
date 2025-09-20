const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const Recipe = require('../models/Recipe');
const Profile = require('../models/Profile');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 6 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const userRecord = await admin.auth().getUser(userId);
    const userProfile = await Profile.findOne({ user: userId });
    
    const totalRecipes = await Recipe.countDocuments({ author: userId });
    const userRecipes = await Recipe.find({ author: userId })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip);

    res.json({
      user: {
        email: userRecord.email,
        displayName: userProfile?.displayName || userRecord.displayName || userRecord.email,
        bio: userProfile?.bio || '',
        profilePictureUrl: userProfile?.profilePictureUrl || '',
        savedRecipes: userProfile?.savedRecipes || []
      },
      recipes: userRecipes,
      totalPages: Math.ceil(totalRecipes / limitNum),
      currentPage: pageNum,
    });

  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Failed to fetch user profile." });
  }
});

router.put('/me', authMiddleware, async (req, res) => {
  try {
    const { displayName, bio, profilePictureUrl } = req.body;
    const { uid } = req.user;

    const updatedProfile = await Profile.findOneAndUpdate(
      { user: uid },
      { displayName, bio, profilePictureUrl },
      { new: true, upsert: true }
    );

    await admin.auth().updateUser(uid, { displayName });

    res.json(updatedProfile);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: 'Failed to update profile.' });
  }
});

router.put('/save/:recipeId', authMiddleware, async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { uid, email, name } = req.user;

    let profile = await Profile.findOne({ user: uid });

    if (!profile) {
      profile = new Profile({
        user: uid,
        displayName: name || email,
      });
    }

    const isSaved = profile.savedRecipes.includes(recipeId);

    if (isSaved) {
      profile.savedRecipes.pull(recipeId);
    } else {
      profile.savedRecipes.push(recipeId);
    }

    await profile.save();
    res.json(profile);
  } catch (error) {
    console.error('Error updating saved recipes:', error);
    res.status(500).json({ message: 'Error updating saved recipes.' });
  }
});

router.get('/saved-recipes', authMiddleware, async (req, res) => {
    try {
        const { uid } = req.user;
        const { page = 1, limit = 6 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const profile = await Profile.findOne({ user: uid });
        if (!profile) {
            return res.json({ recipes: [], totalPages: 0, currentPage: 1 });
        }

        const totalRecipes = profile.savedRecipes.length;
        
        const recipes = await Recipe.find({
            '_id': { $in: profile.savedRecipes }
        }).sort({ createdAt: -1 }).limit(limitNum).skip(skip);

        res.json({
            recipes,
            totalPages: Math.ceil(totalRecipes / limitNum),
            currentPage: pageNum,
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching saved recipes' });
    }
});

module.exports = router;