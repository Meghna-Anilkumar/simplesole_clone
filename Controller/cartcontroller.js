// Import necessary modules
const Cart = require('../models/cartSchema');
const Category = require('../models/category');
const Product = require('../models/product');
const ProductOffer = require('../models/productoffermodel');
const { calculateTotalPrice } = require('../utils/cartfunctions');
const CategoryOffer = require('../models/categoryoffer'); 
const Wishlist=require('../models/wishlist')

module.exports = {
  
 // Get cart
 getcart: async (req, res) => {
  try {
    const user = req.session.user;
    const cart = await Cart.findOne({ user }).populate('items.product').exec();
    const wishlist = await Wishlist.findOne({ user: user._id }).populate('items.product').exec(); 

    if (!cart) {
      return res.render('userviews/cart', { title: 'Cart', category: [], data: { total: 0 }, cart });
    }

    const categories = await Category.find();
    const productOffers = await ProductOffer.find();
    const categoryOffers = await CategoryOffer.find(); // Fetch category offers
    const totalPrice = await calculateTotalPrice(cart.items, productOffers, categoryOffers); // Pass categoryOffers to calculateTotalPrice

    if (isNaN(totalPrice)) {
      console.error('Total price is not a number:', totalPrice);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    cart.total = totalPrice;
    await cart.save();

    const data = {
      total: totalPrice,
    };

    // Check if item.product is defined
    if (cart.items && cart.items.length > 0 && cart.items[0].product) {
      const product = cart.items[0].product;
      res.render('userviews/cart', { title: 'Cart', category: categories, cart, data, productOffers, product ,wishlist});
    } else {
      res.render('userviews/cart', { title: 'Cart', category: categories, cart, data, productOffers,wishlist });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
},


  // Add to cart 
  addtocart: async (req, res) => {
    const { productId, quantity } = req.body;

    try {
      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const user = req.session.user;
      let cart = await Cart.findOne({ user: user });

      if (!cart) {
        cart = new Cart({ user: user, items: [] });
      }

      const existingItem = cart.items.find(item => item.product.equals(productId));

      if (existingItem) {
        const categories = await Category.find();
        return res.render('userviews/productdetails', { error: 'Item already in the cart', title: 'Product details', category: categories });
      } else {
        cart.items.push({ product: productId, quantity: parseInt(quantity) });
      }

      await cart.save();

      res.json({ message: 'Product added to cart successfully' });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }

  },

  // Update quantity in cart
  updatequantity: async (req, res) => {
    const { productId, change } = req.params;

    try {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const currentStock = product.stock;

      const cartItem = await Cart.findOne({ 'items.product': productId });
      if (!cartItem) {
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const currentQuantity = cartItem.items.find(item => item.product.toString() === productId).quantity;

      const newQuantity = parseInt(currentQuantity, 10) + parseInt(change, 10);

      if (newQuantity < 1) {
        return res.status(400).json({ error: 'Quantity cannot be less than 1' });
      }

      if (newQuantity > currentStock) {
        return res.status(400).json({ error: 'Quantity exceeds available stock' });
      }

      const updatedItem = await Cart.findOneAndUpdate(
        { 'items.product': productId },
        { $set: { 'items.$.quantity': newQuantity } },
        { new: true }
      );

      const updatedQuantity = updatedItem.items.find(item => item.product.toString() === productId).quantity;

      const productOffers = await ProductOffer.find();
      const total = await calculateTotalPrice(updatedItem.items, productOffers);
      
      res.json({ quantity: updatedQuantity, total });
    } catch (error) {
      console.error('Error updating quantity:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  // Delete an item from cart
  deleteitem: async (req, res) => {
    const { productId } = req.params;
    try {
      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId },
        { $pull: { items: { product: productId } } },
        { new: true }
      );

      if (!updatedCart) {
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      await updatedCart.save();

      res.json({ message: 'Item removed successfully' });
    } catch (error) {
      console.error('Error removing item:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};
