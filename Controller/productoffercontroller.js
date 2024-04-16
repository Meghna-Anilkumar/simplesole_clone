const Coupon = require('../models/coupon')
const Cart = require('../models/cartSchema')
const Category = require('../models/category')
const isAuth = require('../middlewares/isAuth')
const Product = require('../models/product')
const Order = require('../models/orderSchema')
const User = require('../models/user')
const ProductOffer = require('../models/productoffermodel')
const CategoryOffer = require('../models/categoryoffer')


module.exports = {

// Get product offer page
getproductofferpage: async (req, res) => {
    try {
        
        const products = await Product.find({}, 'name category').populate('category').lean();
   
        const categoriesWithOffers = await CategoryOffer.find({}, 'category');
        
        const filteredProducts = products.filter(product => {
            return !categoriesWithOffers.some(categoryOffer => product.category._id.equals(categoryOffer.category));
        });
        
        const offers = await ProductOffer.find().populate('product');
        
        res.render('adminviews/productoffer', { title: 'Product offer', products: filteredProducts, offers: offers });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
},


    // Create new offer by admin
    saveProductOffer: async (req, res) => {
        try {
            const { productId, discountPercentage, startDate, expiryDate } = req.body;

            const product = await Product.findById(productId);

            const discountAmount = (product.price * discountPercentage) / 100;
            const newPrice = product.price - discountAmount;

            const productOffer = new ProductOffer({
                product: productId,
                discountPercentage,
                startDate,
                expiryDate,
                newPrice,
            });

            await productOffer.save()

            res.redirect('/productoffer');
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    },


    // Get offers on product offers page
    getproductoffers: async (req, res) => {
        try {
            const products = await Product.find({}, 'name');
            const offers = await ProductOffer.find().populate('product')
            console.log(offers,'llllll')
            res.render('adminviews/productoffer', { title: 'Product offer', products, offers })
        } catch (error) {
            console.error(error)
            res.status(500).json({ message: 'Internal Server Error' })
        }
    },


    //update product offer
    updateProductOffer: async (req, res) => {
        try {
            const { offerId, productId, discountPercentage, startDate, expiryDate } = req.body;
            
            const product = await Product.findById(productId);
            const discountAmount = (product.price * discountPercentage) / 100;
            const newPrice = product.price - discountAmount;
    

            const updatedOffer = await ProductOffer.findByIdAndUpdate(offerId, {
                product: productId,
                discountPercentage,
                startDate,
                expiryDate,
                newPrice,
            }, { new: true });
    
            res.redirect('/productoffer');
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    },


    //delete product offer
    deleteproductoffer:async(req,res)=>{
        try {
            const offerId = req.params.id;
            console.log(offerId,'kkkkkkkk');
            const deletedOffer = await ProductOffer.findByIdAndDelete(offerId);
            if (!deletedOffer) {
              return res.status(404).json({ message: 'Offer not found' });
            }
            res.json({ message: 'Offer deleted successfully' });
          } catch (error) {
            console.error('Error:', error);
            res.status(500).json({ message: 'Internal server error' });
          }
    },
    
    
}

