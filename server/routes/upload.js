const express = require('express');
const cloudinary = require('cloudinary').v2;
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

// Configure Cloudinary with your credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Protected endpoint to get a signature for client-side upload
router.post('/image-signature', authMiddleware, (req, res) => {
  // Create a timestamp and signature
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET },
    process.env.CLOUDINARY_API_SECRET
  );
  res.json({ timestamp, signature });
});

module.exports = router;
