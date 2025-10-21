# Manzil Recipe Vault 🍲

A full-stack, multi-user MERN application for saving, sharing, and discovering family recipes. This web app allows users to create accounts, manage a personal collection of recipes, and explore a public feed of recipes shared by others. It features a secure RESTful API back-end and a dynamic, responsive React front-end.

**[Live Demo](https://manzil-recipe-vault.vercel.app)** 

## 🛠️ Tech Stack

### Front-End
* **React (Vite):** A modern React framework for a fast, component-based UI.
* **React Router:** For all client-side routing and navigation.
* **React Hooks:** For all state management and side effects.
* **Tiptap:** A headless rich text editor for formatted recipe instructions.
* **React Toastify:** For modern, non-blocking user notifications.
* **CSS3:** Custom-styled with Flexbox, Grid, and media queries for a fully responsive design.

### Back-End
* **Node.js & Express.js:** To build and run the secure, RESTful API.
* **MongoDB (Mongoose):** A NoSQL database to store all user, recipe, and profile data.
* **Firebase Admin SDK:** For verifying user tokens on the back-end.

### Services & Authentication
* **Firebase Authentication:** For secure user sign-up, log in (email/password & Google), and password reset.
* **Cloudinary:** For cloud-based image hosting and uploads.
* **Git & GitHub:** For version control.
* **Deployment:** Vercel (Front-End) & Render (Back-End).

---

## ✨ Features

This application is feature-complete and includes:

### 1. User Authentication & Profiles
* User sign-up and log in with email and password.
* Secure social sign-in with **Google (OAuth)**.
* Full **password reset** functionality via email.
* Custom user profiles with the ability to edit display name, bio, and profile picture.
* Secure, token-based protected routes for all user-specific actions.

### 2. Recipe Management (Full CRUD)
* **Create** new recipes using a modal form.
* **Read** recipes in a clean, paginated grid.
* **Update** existing recipes (only by the original author).
* **Delete** recipes (only by the original author) with a toast confirmation.

### 3. Rich Content & Interaction
* **Rich Text Editor (Tiptap):** Add bold, italics, strikethrough, and lists to recipe instructions.
* **Image Uploads:** Upload images directly to Cloudinary or link via URL.
* **Comments System:** Logged-in users can comment on any recipe. Comments display the user's name and profile picture.
* **5-Star Rating System:** Users can add or update their rating for any recipe. The average rating is displayed on the card.
* **Bookmark/Save System:** Users can save their favorite recipes to a personal "Saved Recipes" page.

### 4. Dynamic Discovery & UI
* **Public & Private Feeds:** Toggle between a public feed of all recipes and a private "My Recipes" view.
* **Dynamic Search:** A real-time, debounced search bar to filter recipes by title.
* **Tag Filtering:** Add tags to recipes (e.g., "dessert", "quick", "vegan") and filter the main feed by clicking on a tag.
* **Pagination:** All recipe feeds (public, private, profile, saved) are paginated to ensure fast load times.
* **Polished UX:** Modern "toast" notifications for all user actions (save, delete, etc.) and enhanced loading/empty states with spinners and icons.
* **Fully Responsive Design:** A custom, mobile-first design that adapts to all screen sizes, from mobile phones to desktops.

---

## 🚀 Getting Started Locally

### Prerequisites
* Node.js (v18 or later)
* Git
* A MongoDB account (for your `MONGO_URI`)
* A Firebase project (for auth keys)
* A Cloudinary account (for image upload keys)

### 1. Set Up the Back-End Server
```bash
# Clone the repository
git clone [https://github.com/your-username/your-repo-name.git](https://github.com/your-username/your-repo-name.git)
cd your-repo-name

# Navigate to the server folder
cd server

# Install dependencies
npm install

# Create a .env file and add your secrets
touch .env