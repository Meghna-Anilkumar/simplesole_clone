const Category = require('../models/category')
const isAuth = require('../middlewares/isAuth')
const Product = require('../models/product')
const Order = require('../models/orderSchema')
const User = require('../models/user')
const CategoryOffer = require('../models/categoryoffer')
const mongoose = require('mongoose');
const { calculateCategoryOfferPrice } = require('../utils/categoryofferprice');


module.exports = {

    //get category offers page
    getcategoryofferspage: async (req, res) => {
        try {
            const categories = await Category.find().lean();
            const categoryOffers = await CategoryOffer.find().populate('category')

            res.render('adminviews/categoryoffer', { title: 'Category Offers', categories: categories, categoryOffers: categoryOffers });
        } catch (error) {
            console.error(error);
            res.status(500).send('Internal Server Error');
        }
    },


    savecategoryoffer: async (req, res) => {
        try {
            const { categoryId, discountPercentage, startDate, expiryDate } = req.body;

            const categoryProducts = await Product.find({ category: categoryId });

            for (const product of categoryProducts) {
                
                const categoryOfferPrice = calculateCategoryOfferPrice(product.price, discountPercentage);
               
                await Product.findByIdAndUpdate(product._id, { categoryofferprice: categoryOfferPrice });
            }

            const categoryOffer = new CategoryOffer({
                category: categoryId,
                discountPercentage,
                startDate,
                expiryDate,
            });
            const savedCategoryOffer = await categoryOffer.save();

            res.status(200).json(savedCategoryOffer);
        } catch (error) {
            console.error('Error saving category offer:', error);
            res.status(500).json({ error: 'Failed to save category offer' });
        }
    },



    //edit category offer
    editcategoryoffer: async (req, res) => {
        try {
            const categoryId = req.body.categoryId;
            const discountPercentage = req.body.discountPercentage;
            const startDate = req.body.startDate;
            const expiryDate = req.body.expiryDate;

            const categoryOfferId = req.params.id;

            const categoryProducts = await Product.find({ category: categoryId });

            for (const product of categoryProducts) {
                const averageProductPrice = product.price;
                const discountAmount = (averageProductPrice * discountPercentage) / 100;
                const newPrice = averageProductPrice - discountAmount;

                await Product.findByIdAndUpdate(product._id, {
                    categoryofferprice: newPrice
                });
            }

            const updatedCategoryOffer = await CategoryOffer.findByIdAndUpdate(categoryOfferId, {
                category: categoryId,
                discountPercentage: discountPercentage,
                startDate: startDate,
                expiryDate: expiryDate
            }, { new: true });

            res.redirect('/categoryoffer');
        } catch (error) {
            console.error('Error updating category offer:', error);
            res.status(500).json({ error: 'Failed to update category offer' });
        }
    },


    // delete category offer
    deletecategoryoffer: async (req, res) => {
        const categoryOfferId = req.params.id;

        try {
            const deletedCategoryOffer = await CategoryOffer.findByIdAndDelete(categoryOfferId);

            if (!deletedCategoryOffer) {
                return res.status(404).json({ error: 'Category offer not found' });
            }

            const categoryId = deletedCategoryOffer.category;
            const categoryProducts = await Product.find({ category: categoryId });

            
            for (const product of categoryProducts) {
                await Product.findByIdAndUpdate(product._id, {
                    categoryofferprice: product.price 
                });
            }

            res.redirect('/categoryoffer');

        } catch (error) {
            console.error('Error deleting category offer:', error);
            res.status(500).json({ error: 'Failed to delete category offer' });
        }
    },

}