// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB3Etq4c6xo3EFfTNF2GPKhfUkC8O-0tjU",
  authDomain: "family-recipe-book-fc936.firebaseapp.com",
  projectId: "family-recipe-book-fc936",
  storageBucket: "family-recipe-book-fc936.firebasestorage.app",
  messagingSenderId: "1088383543679",
  appId: "1:1088383543679:web:8e31af4b8c3c018363d24a"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the auth service
export const auth = getAuth(app);