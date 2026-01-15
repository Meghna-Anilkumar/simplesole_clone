const Coupon = require("../models/coupon");
const Cart = require("../models/cartSchema");
const Category = require("../models/category");
const isAuth = require("../middlewares/isAuth");
const Product = require("../models/product");
const Order = require("../models/orderSchema");
const User = require("../models/user");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const messages = require('../constants/messages');
const STATUS_CODES=require('../enums/statusCodes');

module.exports = {
  // Get product offer page
  getproductofferpage: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6; 
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
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: messages.INTERNAL_SERVER_ERROR });
    }
  },

  // Create new offer by admin
  saveProductOffer: async (req, res) => {
    try {
      const { productId, discountPercentage, startDate, expiryDate } = req.body;
      if (!productId || !discountPercentage || !startDate || !expiryDate) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const discountPercentageValue = parseInt(discountPercentage);
      if (isNaN(discountPercentageValue) || discountPercentageValue < 1 || discountPercentageValue > 100) {
        return res.status(400).json({ message: "Discount percentage must be between 1 and 100" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0); 
      const start = new Date(startDate);
      const end = new Date(expiryDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      if (start < today) {
        return res.status(400).json({ message: "Start date cannot be in the past" });
      }

      if (end <= start) {
        return res.status(400).json({ message: "End date must be after start date" });
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
        return res.status(STATUS_CODES.NOT_FOUND).json({ message: "Product not found" });
      }

      const discountAmount = (product.price * discountPercentage) / 100;
      const newPrice = product.price - discountAmount;

      const productOffer = new ProductOffer({
        product: productId,
        discountPercentage,
        startDate: start,
        expiryDate: end,
        newPrice,
      });

      const savedOffer = await productOffer.save();

      res.status(STATUS_CODES.CREATED).json({
        message: "Product offer added successfully",
        offer: savedOffer,
      });
    } catch (error) {
      console.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: messages.INTERNAL_SERVER_ERROR });
    }
  },

  // Get offers on product offers page
  getproductoffers: async (req, res) => {
    try {
      const products = await Product.find({}, "name");
      const offers = await ProductOffer.find().populate("product");
      res.render("adminviews/productoffer", {
        title: "Product offer",
        products,
        offers,
      });
    } catch (error) {
      console.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message:messages.INTERNAL_SERVER_ERROR });
    }
  },

  // Update product offer
  updateProductOffer: async (req, res) => {
    try {
      const { offerId, productId, discountPercentage, startDate, expiryDate } = req.body;

      // Validate inputs
      if (!offerId || !productId || !discountPercentage || !startDate || !expiryDate) {
        return res.status(400).json({ message: "All fields are required" });
      }


      const existingOffer=await ProductOffer.findOne({product:productId,_id:{$ne:offerId}})
      if(existingOffer){
        return res.status(400).json({message:'Offer already exists for this product'})
      }

      // Validate discount percentage
      const discountPercentageValue = parseInt(discountPercentage);
      if (isNaN(discountPercentageValue) || discountPercentageValue < 1 || discountPercentageValue > 100) {
        return res.status(400).json({ message: "Discount percentage must be between 1 and 100" });
      }

      // Validate dates
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to midnight
      const start = new Date(startDate);
      const end = new Date(expiryDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      if (start < today) {
        return res.status(400).json({ message: "Start date cannot be in the past" });
      }

      if (end <= start) {
        return res.status(400).json({ message: "End date must be after start date" });
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
          startDate: start,
          expiryDate: end,
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

  // Delete product offer
  deleteproductoffer: async (req, res) => {
    try {
      const offerId = req.params.id;
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