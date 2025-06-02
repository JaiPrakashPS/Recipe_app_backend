import express from "express";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Register a user
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    if (!username || !email || !password) {
      return res.status(400).json({ message: "Please fill all fields" });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({ username, email, password });
    const token = generateToken(user._id);
    console.log("User registered:", user._id, "Token:", token);
    res.status(201).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      token,
    });
  } catch (err) {
    console.error("Error registering user:", err.message, err.stack);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const token = generateToken(user._id);
    console.log("User logged in:", user._id, "Token:", token);
    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      token,
    });
  } catch (err) {
    console.error("Error logging in:", err.message, err.stack);
    res.status(500).json({ message: "Server error" });
  }
});

// Get current user
router.get("/me", protect, async (req, res) => {
  try {
    console.log("Fetching user data for:", req.user._id);
    res.status(200).json(req.user);
  } catch (err) {
    console.error("Error fetching user data:", err.message, err.stack);
    res.status(500).json({ message: "Server error" });
  }
});

// Logout (optional, for server-side token invalidation)
router.post("/logout", protect, async (req, res) => {
  try {
    console.log("User logged out:", req.user._id);
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Error logging out:", err.message, err.stack);
    res.status(500).json({ message: "Server error" });
  }
});

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

export default router;