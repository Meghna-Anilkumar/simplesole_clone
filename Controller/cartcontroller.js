const mongoose = require('mongoose');
const Cart = require('../models/cartSchema');
const Product = require('../models/product');
const ProductOffer = require('../models/productoffermodel');
const CategoryOffer = require('../models/categoryoffer');
const Wishlist = require('../models/wishlist');
const { calculateTotalPrice } = require('../utils/cartfunctions');
const Category = require('../models/category');

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

      let unavailableItems = [];
      let canProceedToCheckout = true;

      if (cart && cart.items && cart.items.length > 0) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          for (const item of cart.items) {
            const product = await Product.findOne({ _id: item.product._id, version: { $exists: true } })
              .session(session);
            if (!product) {
              unavailableItems.push({
                productId: item.product._id,
                name: item.product.name,
                size: item.size,
                reason: 'Product not found',
              });
              continue;
            }

            const variant = product.variants.find((v) => v.size === item.size);
            if (!variant) {
              unavailableItems.push({
                productId: item.product._id,
                name: item.product.name,
                size: item.size,
                reason: `Size ${item.size} not available`,
              });
              continue;
            }

            const availableStock = variant.stock - (variant.reserved || 0);
            if (availableStock < item.quantity) {
              unavailableItems.push({
                productId: item.product._id,
                name: item.product.name,
                size: item.size,
                reason: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available for size ${item.size}`,
              });
            }

            if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
              unavailableItems.push({
                productId: item.product._id,
                name: item.product.name,
                size: item.size,
                reason: `Reservation expired for size ${item.size}`,
              });
              variant.reserved = (variant.reserved || 0) - item.quantity;
              product.reserved = (product.reserved || 0) - item.quantity;
              product.version += 1;
              await product.save({ session });
              cart.items = cart.items.filter(
                (i) => !(i.product._id.toString() === item.product._id.toString() && i.size === item.size)
              );
            }
          }

          if (unavailableItems.length > 0) {
            canProceedToCheckout = false;
            await cart.save({ session });
          }

          await session.commitTransaction();
          session.endSession();
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          console.error('Error validating stock in getcart:', {
            error: error.message,
            stack: error.stack,
          });
          throw error;
        }
      }

      if (!cart) {
        return res.render('userviews/cart', {
          title: 'Cart',
          category: [],
          data: { total: 0 },
          cart,
          wishlist,
          productOffers: [],
          unavailableItems,
          canProceedToCheckout: false,
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
      if (!req.session.couponCode) {
        cart.newTotal = totalPrice;
      }
      await cart.save();

      console.log('Cart state:', { total: cart.total, newTotal: cart.newTotal });

      res.render('userviews/cart', {
        title: 'Cart',
        category: categories,
        cart,
        data: { total: totalPrice },
        productOffers,
        wishlist,
        unavailableItems,
        canProceedToCheckout,
      });
    } catch (error) {
      console.error('Error fetching cart:', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  addtocart: async (req, res) => {
    const { productId, quantity, size } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (!mongoose.Types.ObjectId.isValid(productId) || !size || !quantity || isNaN(quantity) || quantity < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: 'Invalid product ID, size, or quantity',
        });
      }

      const product = await Product.findOne({ _id: productId, version: { $exists: true } })
        .session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: 'Product not found',
        });
      }

      const variant = product.variants.find((v) => v.size === size);
      if (!variant) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: `Size ${size} not available`,
        });
      }

      const availableStock = variant.stock - (variant.reserved || 0);
      const requestedQuantity = parseInt(quantity);

      if (availableStock < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: `Size ${size} is currently out of stock`,
        });
      }

      if (availableStock < requestedQuantity) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: `Only ${availableStock} item${availableStock > 1 ? 's' : ''} available for size ${size}`,
        });
      }

      const user = req.session.user;
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.redirect('/login');
      }

      let cart = await Cart.findOne({ user }).session(session);
      if (!cart) {
        cart = new Cart({ user, items: [] });
      }

      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);

      const existingItem = cart.items.find(
        (item) => item.product.equals(productId) && item.size === size
      );
      if (existingItem) {
        const totalQuantityAfterAdd = existingItem.quantity + requestedQuantity;
        if (totalQuantityAfterAdd > availableStock) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            error: `You already have ${existingItem.quantity} in cart for size ${size}. You can add maximum ${availableStock - existingItem.quantity} more item${availableStock - existingItem.quantity !== 1 ? 's' : ''}`,
          });
        }
        existingItem.quantity = totalQuantityAfterAdd;
        existingItem.reservedAt = new Date();
        let price = product.price;
        if (productOffers.length > 0) {
          price = productOffers[0].newPrice;
        } else if (product.categoryofferprice && product.categoryofferprice < product.price) {
          price = product.categoryofferprice;
        }
        existingItem.price = price;
      } else {
        let price = product.price;
        if (productOffers.length > 0) {
          price = productOffers[0].newPrice;
        } else if (product.categoryofferprice && product.categoryofferprice < product.price) {
          price = product.categoryofferprice;
        }

        cart.items.push({
          product: productId,
          quantity: requestedQuantity,
          size,
          price,
          reservedAt: new Date(),
        });
      }

      variant.reserved = (variant.reserved || 0) + requestedQuantity;
      product.reserved = (product.reserved || 0) + requestedQuantity;
      product.version += 1;
      await product.save({ session });

      const totalPrice = await calculateTotalPrice(
        cart.items,
        productOffers,
        await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(session)
      );
      cart.total = totalPrice;
      if (!req.session.couponCode) {
        cart.newTotal = totalPrice;
      }
      await cart.save({ session });

      console.log('Cart updated (addtocart):', {
        total: cart.total,
        newTotal: cart.newTotal,
      });

      await session.commitTransaction();
      session.endSession();

      res.json({
        success: true,
        message: 'Product added to cart successfully',
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error adding to cart:', {
        error: error.message,
        stack: error.stack,
        productId,
        quantity,
        size,
      });
      res.status(500).json({
        success: false,
        error: error.message || 'Internal Server Error',
      });
    }
  },

  updatequantity: async (req, res) => {
    const { productId, change } = req.params;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (!mongoose.Types.ObjectId.isValid(productId) || isNaN(parseInt(change))) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Invalid product ID or change value' });
      }

      const product = await Product.findOne({ _id: productId, version: { $exists: true } })
        .session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Product not found' });
      }

      const cart = await Cart.findOne({ 'items.product': productId })
        .populate('items.product')
        .session(session);
      if (!cart) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const item = cart.items.find((item) => item.product._id.toString() === productId);
      if (!item) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const variant = product.variants.find((v) => v.size === item.size);
      if (!variant) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: `Size ${item.size} not available` });
      }

      const currentQuantity = item.quantity;
      const changeAmount = parseInt(change, 10);
      const newQuantity = currentQuantity + changeAmount;

      if (newQuantity < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Quantity cannot be less than 1' });
      }

      const availableStock = variant.stock - (variant.reserved - currentQuantity);
      if (newQuantity > availableStock) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available for size ${item.size}`,
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

      variant.reserved += changeAmount;
      product.reserved += changeAmount;
      product.version += 1;
      await product.save({ session });

      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId, 'items.size': item.size },
        {
          $set: {
            'items.$.quantity': newQuantity,
            'items.$.price': itemPrice,
            'items.$.reservedAt': new Date(),
          },
        },
        { new: true }
      ).populate('items.product').session(session);

      if (!updatedCart) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: 'Failed to update cart' });
      }

      const cartTotal = await calculateTotalPrice(
        updatedCart.items,
        productOffers,
        await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(session)
      );
      updatedCart.total = cartTotal;
      if (!req.session.couponCode) {
        updatedCart.newTotal = cartTotal;
      }
      await updatedCart.save({ session });

      console.log('Cart updated (updatequantity):', {
        total: updatedCart.total,
        newTotal: updatedCart.newTotal,
      });

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
      console.error('Error updating quantity:', {
        error: error.message,
        stack: error.stack,
        productId,
        change,
      });
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  },

  deleteitem: async (req, res) => {
    const { productId } = req.params;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Invalid product ID' });
      }

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

      const product = await Product.findOne({ _id: productId, version: { $exists: true } })
        .session(session);
      if (product) {
        const variant = product.variants.find((v) => v.size === item.size);
        if (variant) {
          variant.reserved = (variant.reserved || 0) - item.quantity;
          product.reserved = (product.reserved || 0) - item.quantity;
          product.version += 1;
          await product.save({ session });
        }
      }

      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId, 'items.size': item.size },
        { $pull: { items: { product: productId, size: item.size } } },
        { new: true }
      ).session(session);

      const totalPrice = await calculateTotalPrice(
        updatedCart.items,
        await ProductOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(session),
        await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(session)
      );
      updatedCart.total = totalPrice;
      if (!req.session.couponCode) {
        updatedCart.newTotal = totalPrice;
      }
      await updatedCart.save({ session });

      console.log('Cart updated (deleteitem):', {
        total: updatedCart.total,
        newTotal: updatedCart.newTotal,
      });

      await session.commitTransaction();
      session.endSession();

      res.json({ message: 'Item removed successfully' });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error removing item:', {
        error: error.message,
        stack: error.stack,
        productId,
      });
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
      if (!req.session.couponCode) {
        cart.newTotal = total;
      }
      await cart.save();

      console.log('Cart state (getCartTotal):', {
        total: cart.total,
        newTotal: cart.newTotal,
      });

      res.json({
        success: true,
        total,
        newTotal: cart.newTotal,
      });
    } catch (error) {
      console.error('Error fetching cart total:', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },

  updateSize: async (req, res) => {
    const { productId, newSize } = req.params;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (!mongoose.Types.ObjectId.isValid(productId) || !newSize) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: 'Invalid product ID or size' });
      }

      const product = await Product.findOne({ _id: productId, version: { $exists: true } })
        .session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Product not found' });
      }

      const cart = await Cart.findOne({ 'items.product': productId })
        .populate('items.product')
        .session(session);
      if (!cart) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const item = cart.items.find((item) => item.product._id.toString() === productId);
      if (!item) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: 'Item not found in the cart' });
      }

      const oldVariant = product.variants.find((v) => v.size === item.size);
      const newVariant = product.variants.find((v) => v.size === newSize);
      if (!newVariant) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: `Size ${newSize} not available` });
      }

      const availableStock = newVariant.stock - (newVariant.reserved || 0);
      if (availableStock < item.quantity) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available for size ${newSize}`,
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

      if (oldVariant) {
        oldVariant.reserved = (oldVariant.reserved || 0) - item.quantity;
        product.reserved = (product.reserved || 0) - item.quantity;
      }
      newVariant.reserved = (newVariant.reserved || 0) + item.quantity;
      product.reserved = (product.reserved || 0) + item.quantity;
      product.version += 1;
      await product.save({ session });

      const updatedCart = await Cart.findOneAndUpdate(
        { 'items.product': productId, 'items.size': item.size },
        {
          $set: {
            'items.$.size': newSize,
            'items.$.price': itemPrice,
            'items.$.reservedAt': new Date(),
          },
        },
        { new: true }
      ).populate('items.product').session(session);

      const cartTotal = await calculateTotalPrice(
        updatedCart.items,
        productOffers,
        await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(session)
      );
      updatedCart.total = cartTotal;
      if (!req.session.couponCode) {
        updatedCart.newTotal = cartTotal;
      }
      await updatedCart.save({ session });

      console.log('Cart updated (updateSize):', {
        total: updatedCart.total,
        newTotal: updatedCart.newTotal,
      });

      await session.commitTransaction();
      session.endSession();

      res.json({
        quantity: item.quantity,
        itemPrice: itemPrice * item.quantity,
        total: cartTotal,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error updating size:', {
        error: error.message,
        stack: error.stack,
        productId,
        newSize,
      });
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  },

  validateStockBeforeCheckout: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate('items.product')
        .session(session);

      if (!cart || !cart.items.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, error: 'Cart is empty' });
      }

      const unavailableItems = [];

      for (const item of cart.items) {
        const product = await Product.findOne({ _id: item.product._id, version: { $exists: true } })
          .session(session);
        if (!product) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: 'Product not found',
          });
          continue;
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Size ${item.size} not available`,
          });
          continue;
        }

        const availableStock = variant.stock - (variant.reserved || 0);
        if (availableStock < item.quantity) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available for size ${item.size}`,
          });
        }

        if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Reservation expired for size ${item.size}`,
          });
          variant.reserved = (variant.reserved || 0) - item.quantity;
          product.reserved = (product.reserved || 0) - item.quantity;
          product.version += 1;
          await product.save({ session });
          cart.items = cart.items.filter(
            (i) => !(i.product._id.toString() === item.product._id.toString() && i.size === item.size)
          );
        }
      }

      if (unavailableItems.length > 0) {
        await cart.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: 'Some items are unavailable',
          unavailableItems,
        });
      }

      cart.items.forEach((item) => {
        item.reservedAt = new Date();
      });
      await cart.save({ session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: 'Stock validated successfully' });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('Error validating stock:', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },
};
