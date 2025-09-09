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
      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });
      const totalPrice = await calculateTotalPrice(cart.items, productOffers, categoryOffers);

      if (isNaN(totalPrice)) {
        console.error('Total price is not a number:', totalPrice);
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      cart.total = totalPrice;
      // Reset newTotal unless a coupon is actively applied in the session
      if (!req.session.couponCode) {
        cart.newTotal = totalPrice;
      }
      await cart.save();

      console.log('Cart state:', { total: cart.total, newTotal: cart.newTotal });

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

      if (availableStock < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          success: false, 
          error: 'Product is currently out of stock' 
        });
      }

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

      const existingItem = cart.items.find((item) => item.product.equals(productId));
      if (existingItem) {
        const totalQuantityAfterAdd = existingItem.quantity + requestedQuantity;
        if (totalQuantityAfterAdd > availableStock) {
          await session.abortTransaction();
          session.endSession();
          const maxAdditional = availableStock - existingItem.quantity;
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

      let price = product.price;
      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);
      if (productOffers.length > 0) {
        price = productOffers[0].newPrice;
      } else if (product.categoryofferprice && product.categoryofferprice < product.price) {
        price = product.categoryofferprice;
      }

      product.reserved += requestedQuantity;
      product.version += 1;
      await product.save({ session });

      cart.items.push({
        product: productId,
        quantity: requestedQuantity,
        price,
        reservedAt: new Date(),
      });

      const totalPrice = await calculateTotalPrice(cart.items, productOffers, await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }));
      cart.total = totalPrice;
      // Reset newTotal unless a coupon is actively applied
      if (!req.session.couponCode) {
        cart.newTotal = totalPrice;
      }
      await cart.save({ session });

      console.log('Cart updated (addtocart):', { total: cart.total, newTotal: cart.newTotal });

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

      const availableStock = product.stock - product.reserved + currentQuantity;
      
      if (newQuantity > availableStock) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available in stock` 
        });
      }

      let itemPrice = product.price;
      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);
      if (productOffers.length > 0) {
        itemPrice = productOffers[0].newPrice;
      } else if (product.categoryofferprice && product.categoryofferprice < product.price) {
        itemPrice = product.categoryofferprice;
      }

      product.reserved += changeAmount;
      product.version += 1;
      await product.save({ session });

      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId },
        { 
          $set: { 
            'items.$.quantity': newQuantity, 
            'items.$.price': itemPrice,
            'items.$.reservedAt': new Date() 
          } 
        },
        { new: true }
      ).populate('items.product').session(session);

      const updatedItem = updatedCart.items.find(
        (item) => item.product._id.toString() === productId
      );

      const cartTotal = await calculateTotalPrice(updatedCart.items, productOffers, await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }));
      updatedCart.total = cartTotal;
      // Reset newTotal unless a coupon is actively applied
      if (!req.session.couponCode) {
        updatedCart.newTotal = cartTotal;
      }
      await updatedCart.save({ session });

      console.log('Cart updated (updatequantity):', { total: updatedCart.total, newTotal: updatedCart.newTotal });

      await session.commitTransaction();
      session.endSession();

      res.json({
        quantity: newQuantity,
        itemPrice: itemPrice * newQuantity,
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

      const totalPrice = await calculateTotalPrice(updatedCart.items, await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }), await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }));
      updatedCart.total = totalPrice;
      // Reset newTotal unless a coupon is actively applied
      if (!req.session.couponCode) {
        updatedCart.newTotal = totalPrice;
      }
      await updatedCart.save({ session });

      console.log('Cart updated (deleteitem):', { total: updatedCart.total, newTotal: updatedCart.newTotal });

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

      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });
      const total = await calculateTotalPrice(cart.items, productOffers, categoryOffers);

      cart.total = total;
      // Reset newTotal unless a coupon is actively applied
      if (!req.session.couponCode) {
        cart.newTotal = total;
      }
      await cart.save();

      console.log('Cart state (getCartTotal):', { total: cart.total, newTotal: cart.newTotal });

      res.json({
        success: true,
        total,
        newTotal: cart.newTotal,
      });
    } catch (error) {
      console.error('Error fetching cart total:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },
};