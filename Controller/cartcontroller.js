const mongoose = require('mongoose');
const Cart = require('../models/cartSchema');
const Category = require('../models/category');
const Product = require('../models/product');
const ProductOffer = require('../models/productoffermodel');
const { calculateTotalPrice } = require('../utils/cartfunctions');
const CategoryOffer = require('../models/categoryoffer');
const Wishlist = require('../models/wishlist');

module.exports = {
  getcart: async (req, res) => {
    try {
      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate('items.product')
        .exec();
      const wishlist = await Wishlist.findOne({ user: user._id })
        .populate('items.product')
        .exec();

      if (!cart) {
        return res.render('userviews/cart', {
          title: 'Cart',
          category: [],
          data: { total: 0 },
          cart,
          wishlist,
        });
      }

      const categories = await Category.find();
      const productOffers = await ProductOffer.find();
      const categoryOffers = await CategoryOffer.find();
      const totalPrice = await calculateTotalPrice(cart.items, productOffers, categoryOffers);

      if (isNaN(totalPrice)) {
        console.error('Total price is not a number:', totalPrice);
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      cart.total = totalPrice;
      await cart.save();

      const data = { total: totalPrice };
      let product;
      if (cart.items && cart.items.length > 0 && cart.items[0].product) {
        product = cart.items[0].product;
        console.log('Product:', product);
      }

      res.render('userviews/cart', {
        title: 'Cart',
        category: categories,
        cart,
        data,
        productOffers,
        product,
        wishlist,
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  addtocart: async (req, res) => {
    const { productId, quantity } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(productId).session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ 
          success: false, 
          error: 'Product not found' 
        });
      }

      const requestedQuantity = parseInt(quantity);
      const availableStock = product.stock - product.reserved;

      // Check if product is completely out of stock
      if (availableStock < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          success: false, 
          error: 'Product is currently out of stock' 
        });
      }

      // Check if requested quantity exceeds available stock
      if (availableStock < requestedQuantity) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          success: false, 
          error: `Only ${availableStock} item${availableStock > 1 ? 's' : ''} available in stock` 
        });
      }

      const user = req.session.user;
      let cart = await Cart.findOne({ user }).session(session);

      if (!cart) {
        cart = new Cart({ user, items: [] });
      }

      // Check if item already exists in cart
      const existingItem = cart.items.find((item) => item.product.equals(productId));
      if (existingItem) {
        // Check if adding more quantity would exceed available stock
        const totalQuantityAfterAdd = existingItem.quantity + requestedQuantity;
        if (totalQuantityAfterAdd > availableStock + existingItem.quantity) {
          await session.abortTransaction();
          session.endSession();
          const maxAdditional = availableStock;
          return res.status(400).json({ 
            success: false, 
            error: `You already have ${existingItem.quantity} in cart. You can add maximum ${maxAdditional} more item${maxAdditional !== 1 ? 's' : ''}` 
          });
        }
        
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          success: false, 
          error: 'Item already exists in cart. Please update quantity from cart page.' 
        });
      }

      // Reserve the stock
      product.reserved += requestedQuantity;
      product.version += 1;
      await product.save({ session });

      // Determine the price to use
      let price = product.price;
      if (product.categoryofferprice && product.categoryofferprice < product.price) {
        price = product.categoryofferprice;
      } else if (product.productOffer && product.productOffer.newPrice < product.price) {
        price = product.productOffer.newPrice;
      }

      // Add item to cart
      cart.items.push({
        product: productId,
        quantity: requestedQuantity,
        price,
        reservedAt: new Date(),
      });

      await cart.save({ session });
      await session.commitTransaction();
      session.endSession();

      res.json({ 
        success: true, 
        message: 'Product added to cart successfully' 
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error adding to cart:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal Server Error' 
      });
    }
  },

  updatequantity: async (req, res) => {
    const { productId, change } = req.params;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const product = await Product.findById(productId).session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Product not found' });
      }

      const cartItem = await Cart.findOne({ 'items.product': productId })
        .populate('items.product')
        .session(session);
      if (!cartItem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const item = cartItem.items.find((item) => item.product._id.toString() === productId);
      const currentQuantity = item.quantity;
      const changeAmount = parseInt(change, 10);
      const newQuantity = currentQuantity + changeAmount;

      if (newQuantity < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Quantity cannot be less than 1' });
      }

      // Calculate available stock (including currently reserved quantity for this item)
      const availableStock = product.stock - product.reserved + currentQuantity;
      
      if (newQuantity > availableStock) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available in stock` 
        });
      }

      // Update product reservation
      product.reserved += changeAmount;
      product.version += 1;
      await product.save({ session });

      // Update cart item
      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId },
        { 
          $set: { 
            'items.$.quantity': newQuantity, 
            'items.$.reservedAt': new Date() 
          } 
        },
        { new: true }
      ).populate('items.product').session(session);

      const updatedItem = updatedCart.items.find(
        (item) => item.product._id.toString() === productId
      );

      // Calculate prices with offers
      const productOffers = await ProductOffer.find();
      const categoryOffers = await CategoryOffer.find();
      let itemPrice = updatedItem.product.price;

      // Apply product offers
      if (productOffers && Array.isArray(productOffers)) {
        const productOffersFiltered = productOffers.filter(
          (offer) =>
            offer.product.toString() === productId &&
            new Date() >= offer.startDate &&
            new Date() <= offer.expiryDate
        );
        if (productOffersFiltered.length > 0) {
          itemPrice = productOffersFiltered[0].newPrice;
        }
      }

      // Apply category offers if no product offer
      if (categoryOffers && Array.isArray(categoryOffers) && 
          !productOffers.some((offer) => 
            offer.product.toString() === productId &&
            new Date() >= offer.startDate &&
            new Date() <= offer.expiryDate
          )) {
        const category = await Category.findById(updatedItem.product.category);
        if (category) {
          const categoryOffersFiltered = categoryOffers.filter(
            (offer) =>
              offer.category.toString() === category._id.toString() &&
              new Date() >= offer.startDate &&
              new Date() <= offer.expiryDate
          );
          if (categoryOffersFiltered.length > 0) {
            itemPrice -= (itemPrice * categoryOffersFiltered[0].discountPercentage) / 100;
          }
        }
      }

      // Fallback to categoryofferprice if available
      if (!productOffers.some((offer) => 
            offer.product.toString() === productId &&
            new Date() >= offer.startDate &&
            new Date() <= offer.expiryDate
          ) &&
          updatedItem.product.categoryofferprice &&
          updatedItem.product.categoryofferprice < updatedItem.product.price) {
        itemPrice = updatedItem.product.categoryofferprice;
      }

      const totalItemPrice = itemPrice * newQuantity;
      const cartTotal = await calculateTotalPrice(updatedCart.items, productOffers, categoryOffers);

      await session.commitTransaction();
      session.endSession();

      res.json({
        quantity: newQuantity,
        itemPrice: totalItemPrice,
        total: cartTotal,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error updating quantity:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  deleteitem: async (req, res) => {
    const { productId } = req.params;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const cart = await Cart.findOne({ 'items.product': productId }).session(session);
      if (!cart) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const item = cart.items.find((item) => item.product.toString() === productId);
      if (!item) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const product = await Product.findById(productId).session(session);
      if (product) {
        product.reserved -= item.quantity;
        product.version += 1;
        await product.save({ session });
      }

      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId },
        { $pull: { items: { product: productId } } },
        { new: true }
      ).session(session);

      await session.commitTransaction();
      session.endSession();

      res.json({ message: 'Item removed successfully' });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error removing item:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  getCartTotal: async (req, res) => {
    try {
      const user = req.session.user;
      const cart = await Cart.findOne({ user }).populate('items.product').exec();

      if (!cart) {
        return res.status(404).json({ success: false, error: 'Cart not found' });
      }

      res.json({
        success: true,
        total: cart.total,
        newTotal: cart.newTotal,
      });
    } catch (error) {
      console.error('Error fetching cart total:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },
};