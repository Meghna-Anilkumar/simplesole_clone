const Cart = require('../models/cartSchema')
const Category = require('../models/category')
const isAuth = require('../middlewares/isAuth')
const Product = require('../models/product')
const Wishlist=require('../models/wishlist')

module.exports = {

    //get wishlist page
    getwishlistpage: async (req, res) => {
        try {
            const user = req.session.user;
    
            if (!user) {
                return res.redirect('/login');
            }
    
            const wishlist = await Wishlist.findOne({ user: user._id }).populate('items.product');
            const categories = await Category.find();
            const cart = await Cart.findOne({ user }).populate('items.product').exec();
    
            let allProducts = [];
            if (wishlist) {
                allProducts = wishlist.items.map(item => item.product);
            }
    
            res.render('userviews/wishlist', { wishlist: wishlist, allProducts: allProducts, title: 'Wishlist', category: categories, cart: cart });
        } catch (error) {
            console.error(error);
            res.status(500).send('Internal Server Error');
        }
    },
    
    
    

    //add to wishlist
    addtowishlist: async (req, res) => {
        try {
            console.log('Request received for adding to wishlist');
            const user = req.session.user;
            console.log(user, 'pppppp');
            const { productId } = req.body;
    
            if (!user) {
                return res.status(401).json({ message: 'User not authenticated' });
            }

            let wishlist = await Wishlist.findOne({ user: user._id });
    
            if (!wishlist) {
                wishlist = new Wishlist({ user: user._id, items: [] });
            }
    
            const existingProduct = wishlist.items.find(item => item.product.toString() === productId);
    
            if (existingProduct) {
                return res.status(400).json({ message: 'Product already exists in the wishlist' })
            }
    
            wishlist.items.push({ product: productId });
            await wishlist.save();
    
            res.status(200).json({ message: 'Product added to wishlist successfully' })
        } catch (error) {
            console.error('Error adding product to wishlist:', error)
            res.status(500).json({ message: 'Internal Server Error' })
        }
    },

    //remove from wishlist
    removefromwishlist:async (req, res) => {
        try {
            const { productId } = req.body;
            const user = req.session.user;
            const wishlist = await Wishlist.findOne({ user: user._id });
    
            if (!wishlist) {
                return res.status(404).json({ message: 'Wishlist not found' });
            }
    
            wishlist.items = wishlist.items.filter(item => item.product.toString() !== productId);
            await wishlist.save();
    
            res.status(200).json({ message: 'Product removed from wishlist successfully', productId });
        } catch (error) {
            console.error('Error removing product from wishlist:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    }
    


}