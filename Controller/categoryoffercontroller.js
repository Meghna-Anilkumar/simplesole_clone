const CategoryOffer = require('../models/categoryoffer');
const { updateCategoryOfferPrice } = require('./productcontroller');
const Category = require('../models/category');
const messages = require('../constants/messages');
const STATUS_CODES=require('../enums/statusCodes');

module.exports = {
  // Get category offers page
  getcategoryofferspage: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
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
        totalPages: Math.ceil(totalOffers / limit) || 1,
        limit,
      });
    } catch (error) {
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: messages.INTERNAL_SERVER_ERROR});
    }
  },

  // Save a new category offer
  saveCategoryOffer: async (req, res) => {
    try {
      const { categoryId, discountPercentage, startDate, expiryDate } = req.body;

      if (!categoryId) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Category is required' });
      }

      const categoryExists = await Category.findById(categoryId);
      if (!categoryExists) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Selected category does not exist' });
      }

      if (!discountPercentage || discountPercentage < 1 || discountPercentage > 100) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Discount percentage must be between 1 and 100' });
      }

      if (!startDate || !expiryDate) {
        return res.status(400).json({ message: 'Start date and expiry date are required' });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const expiry = new Date(expiryDate);

      if (isNaN(start.getTime()) || isNaN(expiry.getTime())) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid date format' });
      }

      if (start < today) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Start date cannot be in the past' });
      }

      if (expiry <= start) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Expiry date must be after start date' });
      }

      const categoryOffer = new CategoryOffer({
        category: categoryId,
        discountPercentage,
        startDate,
        expiryDate,
      });

      await categoryOffer.save();

      await updateCategoryOfferPrice(categoryId);

      res.json({ success: true, message: 'Category offer added successfully' });
    } catch (error) {
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message:messages.INTERNAL_SERVER_ERROR });
    }
  },

  // Update an existing category offer
  updateCategoryOffer: async (req, res) => {
    try {
      const { offerId, categoryId, discountPercentage, startDate, expiryDate } = req.body;

      if (!offerId) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Offer ID is required' });
      }

      if (!categoryId) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Category is required' });
      }

      const categoryExists = await Category.findById(categoryId);
      if (!categoryExists) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Selected category does not exist' });
      }

      if (!discountPercentage || discountPercentage < 1 || discountPercentage > 100) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({ message: 'Discount percentage must be between 1 and 100' });
      }

      if (!startDate || !expiryDate) {
        return res.status(400).json({ message: 'Start date and expiry date are required' });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const expiry = new Date(expiryDate);

      if (isNaN(start.getTime()) || isNaN(expiry.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }

      if (start < today) {
        return res.status(400).json({ message: 'Start date cannot be in the past' });
      }

      if (expiry <= start) {
        return res.status(400).json({ message: 'Expiry date must be after start date' });
      }

      const updatedOffer = await CategoryOffer.findByIdAndUpdate(
        offerId,
        {
          category: categoryId,
          discountPercentage,
          startDate,
          expiryDate,
        },
        { new: true }
      );

      if (!updatedOffer) {
        return res.status(STATUS_CODES.NOT_FOUND).json({ message: 'Category offer not found' });
      }

      await updateCategoryOfferPrice(categoryId);

      res.json({ success: true, message: 'Category offer updated successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },

  // Delete a category offer
  deleteCategoryOffer: async (req, res) => {
    try {
      const offerId = req.params.id;
      const categoryOffer = await CategoryOffer.findById(offerId);

      if (!categoryOffer) {
        return res.status(404).json({ message: 'Category offer not found' });
      }

      await CategoryOffer.findByIdAndDelete(offerId);
      await updateCategoryOfferPrice(categoryOffer.category);

      res.json({ success: true, message: 'Category offer deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: messages.INTERNAL_SERVER_ERROR });
    }
  },
};