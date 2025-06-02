import express from "express";
import mongoose from "mongoose";
import Recipe from "../models/Recipe.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import asyncHandler from "express-async-handler";
import dotenv from "dotenv";

dotenv.config();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

const router = express.Router();

// Update user profile photo
router.put(
  "/users/profile/photo",
  protect,
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      console.error("No file uploaded in request");
      res.status(400);
      throw new Error("No file uploaded");
    }

    console.log("Uploading profile photo to Cloudinary:", req.file.originalname);
    try {
      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: "recipe-app/profiles", resource_type: "image" },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error.message);
              reject(error);
            } else {
              console.log("Cloudinary upload successful:", result.secure_url);
              resolve(result);
            }
          }
        );
        uploadStream.end(req.file.buffer);
      });

      // If user already has a profile photo, delete the old one
      if (req.user.profilePhoto?.public_id) {
        console.log("Deleting old profile photo:", req.user.profilePhoto.public_id);
        await cloudinary.uploader.destroy(req.user.profilePhoto.public_id);
      }

      // Update user with new photo
      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
          profilePhoto: {
            url: result.secure_url,
            public_id: result.public_id,
          },
        },
        { new: true, select: "-password" }
      );

      console.log("User profile updated with new photo:", updatedUser.profilePhoto.url);
      res.json({
        profilePhoto: updatedUser.profilePhoto,
        message: "Profile photo updated successfully",
      });
    } catch (error) {
      console.error("Profile photo upload failed:", error.message);
      res.status(500);
      throw new Error("Failed to upload photo to Cloudinary");
    }
  })
);

// Create recipe
router.post(
  "/",
  protect,
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const { title, ingredients, instructions, category, cookingTime } = req.body;

    if (
      !title ||
      !ingredients ||
      !instructions ||
      !category ||
      !cookingTime ||
      !req.file
    ) {
      res.status(400);
      throw new Error("Please fill all fields and upload a photo");
    }

    try {
      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "recipe-app/recipes", resource_type: "image" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      const recipe = await Recipe.create({
        title,
        ingredients: JSON.parse(ingredients),
        instructions,
        category,
        cookingTime,
        photo: {
          public_id: result.public_id,
          url: result.secure_url,
        },
        createdBy: req.user._id,
      });

      const populatedRecipe = await Recipe.findById(recipe._id).populate("createdBy", "username");
      res.status(201).json(populatedRecipe);
    } catch (error) {
      console.error("Recipe creation failed:", error.message);
      res.status(500);
      throw new Error("Failed to create recipe");
    }
  })
);

// Get all recipes
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { category } = req.query;
    const query = category ? { category } : {};
    const recipes = await Recipe.find(query).populate("createdBy", "username");

    // If user is authenticated, mark favorited recipes
    if (req.user) {
      const user = await User.findById(req.user._id);
      if (!user) {
        res.status(404);
        throw new Error("User not found");
      }
      const favoritedRecipeIds = user.favorites.map((id) => id.toString());
      const recipesWithFavoriteStatus = recipes.map((recipe) => ({
        ...recipe.toJSON(),
        isFavorited: favoritedRecipeIds.includes(recipe._id.toString()),
      }));
      return res.json(recipesWithFavoriteStatus);
    }

    res.json(recipes);
  })
);

// Get user's favorite recipes
router.get(
  "/favorites",
  protect,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).populate({
      path: "favorites",
      populate: { path: "createdBy", select: "username" },
    });

    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }

    res.json(user.favorites || []);
  })
);

// Get user's own recipes (existing endpoint)
router.get(
  "/my-recipes",
  protect,
  asyncHandler(async (req, res) => {
    const recipes = await Recipe.find({ createdBy: req.user._id }).populate(
      "createdBy",
      "username"
    );

    res.json(recipes);
  })
);

// New endpoint: Get recipes by user ID
router.get(
  "/users/:userId/recipes",
  protect,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400);
      throw new Error("Invalid user ID");
    }

    // Optional: Restrict access to only the user's own recipes
    if (userId !== req.user._id.toString()) {
      res.status(403);
      throw new Error("Not authorized to view this user's recipes");
    }

    const recipes = await Recipe.find({ createdBy: userId })
      .populate("createdBy", "username")
      .select("title category photo _id");

    res.json(recipes);
  })
);

// Get a single recipe
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }

    const recipe = await Recipe.findById(req.params.id)
      .populate("createdBy", "username")
      .populate("reviews.user", "username")
      .populate("reviews.replies.user", "username");

    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    if (req.user) {
      const user = await User.findById(req.user._id);
      if (!user) {
        res.status(404);
        throw new Error("User not found");
      }
      const isFavorited = user.favorites.some(
        (favId) => favId.toString() === recipe._id.toString()
      );
      return res.json({ ...recipe.toJSON(), isFavorited });
    }

    res.json(recipe);
  })
);

// Update a recipe
router.put(
  "/:id",
  protect,
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const { title, ingredients, instructions, category, cookingTime } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }

    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    if (recipe.createdBy.toString() !== req.user._id.toString()) {
      res.status(401);
      throw new Error("Not authorized");
    }

    if (req.file) {
      // Delete old photo if it exists
      if (recipe.photo?.public_id) {
        await cloudinary.uploader.destroy(recipe.photo.public_id);
      }

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "recipe-app/recipes", resource_type: "image" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      recipe.photo = {
        public_id: result.public_id,
        url: result.secure_url,
      };
    }

    recipe.title = title || recipe.title;
    recipe.ingredients = ingredients
      ? JSON.parse(ingredients)
      : recipe.ingredients;
    recipe.instructions = instructions || recipe.instructions;
    recipe.category = category || recipe.category;
    recipe.cookingTime = cookingTime || recipe.cookingTime;

    const updatedRecipe = await recipe.save();
    const populatedRecipe = await Recipe.findById(updatedRecipe._id).populate(
      "createdBy",
      "username"
    );
    res.json(populatedRecipe);
  })
);

// Delete a recipe
router.delete(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }

    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    if (recipe.createdBy.toString() !== req.user._id.toString()) {
      res.status(401);
      throw new Error("Not authorized");
    }

    if (recipe.photo?.public_id) {
      await cloudinary.uploader.destroy(recipe.photo.public_id);
    }
    await recipe.deleteOne();
    res.json({ message: "Recipe deleted" });
  })
);

// Add a review
router.post(
  "/:id/reviews",
  protect,
  asyncHandler(async (req, res) => {
    const { rating, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }

    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    if (!rating || rating < 1 || rating > 10) {
      res.status(400);
      throw new Error("Rating must be between 1 and 10");
    }

    if (!description || description.trim() === "") {
      res.status(400);
      throw new Error("Description is required");
    }

    const alreadyReviewed = recipe.reviews.some(
      (review) => review.user.toString() === req.user._id.toString()
    );
    if (alreadyReviewed) {
      res.status(400);
      throw new Error("You have already reviewed this recipe");
    }

    const review = {
      rating: Number(rating),
      description,
      user: req.user._id,
    };

    recipe.reviews.push(review);
    await recipe.save();

    const updatedRecipe = await Recipe.findById(req.params.id)
      .populate("createdBy", "username")
      .populate("reviews.user", "username")
      .populate("reviews.replies.user", "username");

    res.status(201).json(updatedRecipe);
  })
);

// Add a reply to a review
router.post(
  "/:id/reviews/:reviewId/replies",
  protect,
  asyncHandler(async (req, res) => {
    const { description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.reviewId)) {
      res.status(400);
      throw new Error("Invalid review ID");
    }

    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    const review = recipe.reviews.id(req.params.reviewId);
    if (!review) {
      res.status(404);
      throw new Error("Review not found");
    }

    if (!description || description.trim() === "") {
      res.status(400);
      throw new Error("Reply description is required");
    }

    const reply = {
      description,
      user: req.user._id,
    };

    review.replies.push(reply);
    await recipe.save();

    const updatedRecipe = await Recipe.findById(req.params.id)
      .populate("createdBy", "username")
      .populate("reviews.user", "username")
      .populate("reviews.replies.user", "username");

    res.status(201).json(updatedRecipe);
  })
);

// Add to favorites
router.post(
  "/:id/favorite",
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }

    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }

    if (user.favorites.includes(recipe._id)) {
      res.status(400);
      throw new Error("Recipe already in favorites");
    }

    user.favorites.push(recipe._id);
    await user.save();

    res.json({ message: "Recipe added to favorites", isFavorited: true });
  })
);

// Remove from favorites
router.delete(
  "/:id/favorite",
  protect,
  asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400);
      throw new Error("Invalid recipe ID");
    }

    const recipe = await Recipe.findById(req.params.id);
    if (!recipe) {
      res.status(404);
      throw new Error("Recipe not found");
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }

    if (!user.favorites.includes(recipe._id)) {
      res.status(400);
      throw new Error("Recipe not in favorites");
    }

    user.favorites = user.favorites.filter(
      (favId) => favId.toString() !== recipe._id.toString()
    );
    await user.save();

    res.json({ message: "Recipe removed from favorites", isFavorited: false });
  })
);

export default router;