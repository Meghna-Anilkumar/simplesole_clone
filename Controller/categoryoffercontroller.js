const CategoryOffer = require('../models/categoryoffer');
const { updateCategoryOfferPrice } = require('./productcontroller');
const Category=require('../models/category')

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

  saveCategoryOffer: async (req, res) => {
    try {
      const { categoryId, discountPercentage, startDate, expiryDate } = req.body;

      if (discountPercentage < 1 || discountPercentage > 100) {
        return res.status(400).json({ message: 'Discount percentage must be between 1 and 100' });
      }

      if (new Date(startDate) < new Date()) {
        return res.status(400).json({ message: 'Start date cannot be in the past' });
      }

      if (new Date(expiryDate) <= new Date(startDate)) {
        return res.status(400).json({ message: 'Expiry date must be after start date' });
      }

      const categoryOffer = new CategoryOffer({
        category: categoryId,
        discountPercentage,
        startDate,
        expiryDate,
      });

      await categoryOffer.save();

      // Update categoryofferprice for all products in the category
      await updateCategoryOfferPrice(categoryId);

      res.json({ success: true, message: 'Category offer added successfully' });
    } catch (error) {
      console.error('Error saving category offer:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },

  // Update an existing category offer
  updateCategoryOffer: async (req, res) => {
    try {
      const { offerId, categoryId, discountPercentage, startDate, expiryDate } = req.body;

      if (discountPercentage < 1 || discountPercentage > 100) {
        return res.status(400).json({ message: 'Discount percentage must be between 1 and 100' });
      }

      if (new Date(startDate) < new Date()) {
        return res.status(400).json({ message: 'Start date cannot be in the past' });
      }

      if (new Date(expiryDate) <= new Date(startDate)) {
        return res.status(400).json({ message: 'Expiry date must be after start date' });
      }

      await CategoryOffer.findByIdAndUpdate(offerId, {
        category: categoryId,
        discountPercentage,
        startDate,
        expiryDate,
      });

      // Update categoryofferprice for all products in the category
      await updateCategoryOfferPrice(categoryId);

      res.json({ success: true, message: 'Category offer updated successfully' });
    } catch (error) {
      console.error('Error updating category offer:', error);
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

      // Update categoryofferprice for all products in the category
      await updateCategoryOfferPrice(categoryOffer.category);

      res.json({ success: true, message: 'Category offer deleted successfully' });
    } catch (error) {
      console.error('Error deleting category offer:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },
};