require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const recipeRoutes = require('./routes/recipes');
const userRoutes = require('./routes/users');

const app = express();
const PORT = 4000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://manzil-recipe-vault.vercel.app' // Production
  ]
}));
app.use(express.json());

app.use('/api/recipes', recipeRoutes);
app.use('/api/users', userRoutes);

app.get('/', (req, res) => {
  res.json({ message: "Server connected!" });
});


mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Successfully connected to MongoDB!");


    app.listen(PORT, () => {
      console.log(`🎉 Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Error connecting to MongoDB:", error.message);
  });

app.get('/', (req, res) => {
  res.json({ message: "Server connected!" });
});