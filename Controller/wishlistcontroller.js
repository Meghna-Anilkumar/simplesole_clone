const mongoose = require("mongoose");
const Cart = require("../models/cartSchema");
const Category = require("../models/category");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const now = new Date();
const Product = require("../models/product");
const Wishlist = require("../models/wishlist");

module.exports = {
  // Get wishlist page with pagination and cart check
  getwishlistpage: async (req, res) => {
    try {
      const user = req.session.user;

      if (!user) {
        return res.redirect("/login");
      }

      // Pagination parameters
      const page = parseInt(req.query.page) || 1;
      const limit = 12; // 12 products per page (3 rows of 4)
      const skip = (page - 1) * limit;

      const wishlist = await Wishlist.findOne({ user: user._id }).populate({
        path: "items.product",
        model: "Product",
      });

      const categories = await Category.find();
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      let allProducts = [];
      let totalItems = 0;
      let totalPages = 1;

      if (wishlist && wishlist.items.length > 0) {
        totalItems = wishlist.items.length;
        totalPages = Math.ceil(totalItems / limit);

        // Apply pagination to wishlist items
        const paginatedItems = wishlist.items.slice(skip, skip + limit);
        allProducts = await Promise.all(
          paginatedItems.map(async (item) => {
            const product = await Product.findById(item.product._id);

            // Check if product is out of stock
            const isOutOfStock = product.variants.every(
              (variant) => variant.stock - (variant.reserved || 0) <= 0
            );

            // Check if product is in cart
            const inCart =
              cart &&
              cart.items.some(
                (cartItem) =>
                  cartItem.product._id.toString() ===
                  item.product._id.toString()
              );

            let newPrice = null;

            // Check for active product offer
            const productOffer = await ProductOffer.findOne({
              product: product._id,
              startDate: { $lte: now },
              expiryDate: { $gte: now },
            });

            if (productOffer) {
              newPrice = productOffer.newPrice;
            } else {
              // Check for active category offer
              const categoryOffer = await CategoryOffer.findOne({
                category: product.category,
                startDate: { $lte: now },
                expiryDate: { $gte: now },
              });
              if (categoryOffer) {
                newPrice =
                  product.price * (1 - categoryOffer.discountPercentage / 100);
              }
            }

            return {
              product,
              isOutOfStock,
              inCart,
              newPrice,
            };
          })
        );
      }

      res.render("userviews/wishlist", {
        wishlist,
        allProducts,
        title: "Wishlist",
        category: categories,
        cart,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching wishlist:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).send("Internal Server Error");
    }
  },

  // Add to wishlist
  addtowishlist: async (req, res) => {
    try {
      const user = req.session.user;
      const { productId } = req.body;

      if (!user) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      let wishlist = await Wishlist.findOne({ user: user._id });

      if (!wishlist) {
        wishlist = new Wishlist({ user: user._id, items: [] });
      }

      const existingProduct = wishlist.items.find(
        (item) => item.product.toString() === productId
      );

      if (existingProduct) {
        return res
          .status(400)
          .json({ message: "Product already in wishlist", inWishlist: true });
      }

      wishlist.items.push({ product: productId });
      await wishlist.save();

      res
        .status(200)
        .json({
          message: "Product added to wishlist successfully",
          inWishlist: true,
          wishlistCount: wishlist.items.length,
        });
    } catch (error) {
      console.error("Error adding product to wishlist:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  // Remove from wishlist
  removefromwishlist: async (req, res) => {
    try {
      const { productId } = req.body;
      const user = req.session.user;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const wishlist = await Wishlist.findOne({ user: user._id });

      if (!wishlist) {
        return res.status(404).json({ message: "Wishlist not found" });
      }

      const initialLength = wishlist.items.length;
      wishlist.items = wishlist.items.filter(
        (item) => item.product.toString() !== productId
      );

      if (wishlist.items.length === initialLength) {
        return res
          .status(404)
          .json({ message: "Product not found in wishlist" });
      }

      await wishlist.save();

      res
        .status(200)
        .json({
          message: "Product removed from wishlist successfully",
          inWishlist: false,
          productId,
          wishlistCount: wishlist.items.length,
        });
    } catch (error) {
      console.error("Error removing product from wishlist:", {
        error: error.message,
        stack: error.stack,
        productId,
      });
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
};
