require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const recipeRoutes = require('./routes/recipes');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: [
    'http://localhost:5173', //local development URL
    'https://manzil-recipe-vault.vercel.app' //Vercel URL
  ]
}));
app.use(express.json());

//API Routes
app.use('/api/recipes', recipeRoutes);
app.use('/api/users', userRoutes);

//Basic root route for testing connection
app.get('/', (req, res) => {
  res.json({ message: "Recipe API Server Connected!" });
});

//Connect to Database and Start Server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Successfully connected to MongoDB!");
    app.listen(PORT, () => {
      console.log(`🎉 Server is running on port: ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Error connecting to MongoDB:", error.message);
  });