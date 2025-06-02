import User from "../models/User.js";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";

export const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.id) {
        console.error("Token missing id:", decoded);
        res.status(401);
        throw new Error("Not authorized, invalid token");
      }

      // Fetch user and exclude password
      const user = await User.findById(decoded.id).select("-password");
      if (!user) {
        console.error("User not found for id:", decoded.id);
        res.status(401);
        throw new Error("Not authorized, user not found");
      }

      req.user = user;
      next();
    } catch (error) {
      console.error("Token verification failed:", error.message);
      res.status(401);
      throw new Error("Not authorized, token failed");
    }
  } else {
    console.warn("No token provided in request headers");
    res.status(401);
    throw new Error("Not authorized, no token");
  }
});