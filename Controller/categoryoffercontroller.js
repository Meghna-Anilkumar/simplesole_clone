const Category = require('../models/category');
const isAuth = require('../middlewares/isAuth');
const Product = require('../models/product');
const Order = require('../models/orderSchema');
const User = require('../models/user');
const CategoryOffer = require('../models/categoryoffer');
const mongoose = require('mongoose');
const { calculateCategoryOfferPrice } = require('../utils/categoryofferprice');

module.exports = {
  // Get category offers page
  getcategoryofferspage: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6; // Show 6 offers per page
      const skip = (page - 1) * limit;

      const categories = await Category.find().lean();
      const totalOffers = await CategoryOffer.countDocuments();
      const categoryOffers = await CategoryOffer.find()
        .populate('category')
        .skip(skip)
        .limit(limit)
        .lean();

      res.render('adminviews/categoryoffer', {
        title: 'Category Offers',
        categories,
        categoryOffers,
        currentPage: page,
        totalPages: Math.ceil(totalOffers / limit) || 1, // Ensure at least 1 page
        limit,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },

  // Create new category offer
  savecategoryoffer: async (req, res) => {
    try {
      const { categoryId, discountPercentage, startDate, expiryDate } = req.body;

      // Validate inputs
      if (!categoryId || !discountPercentage || !startDate || !expiryDate) {
        return res.status(400).json({ message: 'All fields are required' });
      }

      // Check if a category offer already exists for the selected category
      const existingCategoryOffer = await CategoryOffer.findOne({ category: categoryId });

      if (existingCategoryOffer) {
        return res.status(400).json({ message: 'This category already has an offer' });
      }

      const categoryProducts = await Product.find({ category: categoryId });

      for (const product of categoryProducts) {
        const categoryOfferPrice = calculateCategoryOfferPrice(product.price, discountPercentage);
        await Product.findByIdAndUpdate(product._id, { categoryofferprice: categoryOfferPrice });
      }

      const categoryOffer = new CategoryOffer({
        category: categoryId,
        discountPercentage,
        startDate: new Date(startDate),
        expiryDate: new Date(expiryDate),
      });

      const savedCategoryOffer = await categoryOffer.save();

      res.status(200).json({
        message: 'Category offer added successfully',
        offer: savedCategoryOffer,
      });
    } catch (error) {
      console.error('Error saving category offer:', error);
      res.status(500).json({ message: 'Failed to save category offer' });
    }
  },

  // Edit category offer
  editcategoryoffer: async (req, res) => {
    try {
      const { categoryId, discountPercentage, startDate, expiryDate } = req.body;
      const categoryOfferId = req.params.id;

      // Validate inputs
      if (!categoryId || !discountPercentage || !startDate || !expiryDate || !categoryOfferId) {
        return res.status(400).json({ message: 'All fields are required' });
      }

      // Check if another offer exists for the category (excluding the current offer)
      const existingCategoryOffer = await CategoryOffer.findOne({
        category: categoryId,
        _id: { $ne: categoryOfferId },
      });

      if (existingCategoryOffer) {
        return res.status(400).json({ message: 'This category already has another offer' });
      }

      const categoryProducts = await Product.find({ category: categoryId });

      for (const product of categoryProducts) {
        const categoryOfferPrice = calculateCategoryOfferPrice(product.price, discountPercentage);
        await Product.findByIdAndUpdate(product._id, {
          categoryofferprice: categoryOfferPrice,
        });
      }

      const updatedCategoryOffer = await CategoryOffer.findByIdAndUpdate(
        categoryOfferId,
        {
          category: categoryId,
          discountPercentage,
          startDate: new Date(startDate),
          expiryDate: new Date(expiryDate),
        },
        { new: true }
      );

      if (!updatedCategoryOffer) {
        return res.status(404).json({ message: 'Category offer not found' });
      }

      res.status(200).json({
        message: 'Category offer updated successfully',
        offer: updatedCategoryOffer,
      });
    } catch (error) {
      console.error('Error updating category offer:', error);
      res.status(500).json({ message: 'Failed to update category offer' });
    }
  },

  // Delete category offer
  deletecategoryoffer: async (req, res) => {
    try {
      const categoryOfferId = req.params.id;

      const deletedCategoryOffer = await CategoryOffer.findByIdAndDelete(categoryOfferId);

      if (!deletedCategoryOffer) {
        return res.status(404).json({ message: 'Category offer not found' });
      }

      const categoryId = deletedCategoryOffer.category;
      const categoryProducts = await Product.find({ category: categoryId });

      for (const product of categoryProducts) {
        await Product.findByIdAndUpdate(product._id, {
          categoryofferprice: 0,
        });
      }

      res.status(200).json({
        message: 'Category offer deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting category offer:', error);
      res.status(500).json({ message: 'Failed to delete category offer' });
    }
  },
};