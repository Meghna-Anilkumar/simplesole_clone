const Coupon = require("../models/coupon");
const Cart = require("../models/cartSchema");
const Category = require("../models/category");
const isAuth = require("../middlewares/isAuth");
const Product = require("../models/product");
const Order = require("../models/orderSchema");
const User = require("../models/user");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");

module.exports = {
  // Get product offer page
  getproductofferpage: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6; // Show 6 offers per page
      const skip = (page - 1) * limit;

      const products = await Product.find({}, "name category")
        .populate("category")
        .lean();
      const categoriesWithOffers = await CategoryOffer.find({}, "category");

      const filteredProducts = products.filter((product) => {
        return !categoriesWithOffers.some((categoryOffer) =>
          product.category._id.equals(categoryOffer.category)
        );
      });

      const totalOffers = await ProductOffer.countDocuments();
      const offers = await ProductOffer.find()
        .populate("product")
        .skip(skip)
        .limit(limit)
        .lean();

      res.render("adminviews/productoffer", {
        title: "Product offer",
        products: filteredProducts,
        offers,
        currentPage: page,
        totalPages: Math.ceil(totalOffers / limit),
        limit,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  // Create new offer by admin
saveProductOffer: async (req, res) => {
    try {
      const { productId, discountPercentage, startDate, expiryDate } = req.body;

      // Validate inputs
      if (!productId || !discountPercentage || !startDate || !expiryDate) {
        return res.status(400).json({ message: "All fields are required" });
      }

      // Check if there's an existing product offer for the specified product
      const existingOffer = await ProductOffer.findOne({ product: productId });

      if (existingOffer) {
        return res
          .status(400)
          .json({ message: "This product already has a product offer." });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const discountAmount = (product.price * discountPercentage) / 100;
      const newPrice = product.price - discountAmount;

      const productOffer = new ProductOffer({
        product: productId,
        discountPercentage,
        startDate: new Date(startDate),
        expiryDate: new Date(expiryDate),
        newPrice,
      });

      const savedOffer = await productOffer.save();

      res.status(200).json({
        message: "Product offer added successfully",
        offer: savedOffer,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  // Get offers on product offers page
  getproductoffers: async (req, res) => {
    try {
      const products = await Product.find({}, "name");
      const offers = await ProductOffer.find().populate("product");
      console.log(offers, "llllll");
      res.render("adminviews/productoffer", {
        title: "Product offer",
        products,
        offers,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  //update product offer
  updateProductOffer: async (req, res) => {
    try {
      const { offerId, productId, discountPercentage, startDate, expiryDate } =
        req.body;

      // Validate inputs
      if (
        !offerId ||
        !productId ||
        !discountPercentage ||
        !startDate ||
        !expiryDate
      ) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const discountAmount = (product.price * discountPercentage) / 100;
      const newPrice = product.price - discountAmount;

      const updatedOffer = await ProductOffer.findByIdAndUpdate(
        offerId,
        {
          product: productId,
          discountPercentage,
          startDate: new Date(startDate),
          expiryDate: new Date(expiryDate),
          newPrice,
        },
        { new: true }
      );

      if (!updatedOffer) {
        return res.status(404).json({ message: "Offer not found" });
      }

      res.json({
        message: "Offer updated successfully",
        offer: updatedOffer,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  //delete product offer
  deleteproductoffer: async (req, res) => {
    try {
      const offerId = req.params.id;
      console.log(offerId, "kkkkkkkk");
      const deletedOffer = await ProductOffer.findByIdAndDelete(offerId);
      if (!deletedOffer) {
        return res.status(404).json({ message: "Offer not found" });
      }
      res.json({ message: "Offer deleted successfully" });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
};
