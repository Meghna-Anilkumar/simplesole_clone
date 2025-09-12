const mongoose = require('mongoose');
const Product = require('../models/product');
const Order = require('../models/orderSchema');
const Cart = require('../models/cartSchema');

module.exports = async (user, selectedAddress, paymentMethod, cart, couponCode) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate cart items and their sizes
    for (const item of cart.items) {
      if (!item.size) {
        throw new Error(`Size is missing for product: ${item.product.name}`);
      }

      const product = await Product.findById(item.product._id).session(session);
      if (!product) {
        throw new Error(`Product not found: ${item.product._id}`);
      }

      const variant = product.variants.find((v) => v.size === item.size);
      if (!variant) {
        throw new Error(`Size ${item.size} not available for product: ${product.name}`);
      }

      const availableStock = variant.stock - (product.reserved || 0);
      if (availableStock < item.quantity) {
        throw new Error(`Insufficient stock for product: ${product.name}, size: ${item.size}. Only ${availableStock} available.`);
      }

      if (item.reservedAt && item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
        await Product.findByIdAndUpdate(
          item.product._id,
          { $inc: { reserved: -item.quantity, version: 1 } },
          { session }
        );
        cart.items = cart.items.filter((i) => 
          !(i.product._id.toString() === item.product._id.toString() && i.size === item.size)
        );
        await cart.save({ session });
        throw new Error(`Reservation expired for product: ${product.name}, size: ${item.size}`);
      }
    }

    // Update stock and reserved quantities for each variant
    for (const item of cart.items) {
      const product = await Product.findById(item.product._id).session(session);
      const variant = product.variants.find((v) => v.size === item.size);
      
      variant.stock -= item.quantity;
      if (product.reserved && product.reserved >= item.quantity) {
        product.reserved -= item.quantity;
      }
      
      product.version += 1;
      await product.save({ session });
    }

    // Create order items with proper size field
    const orderItems = cart.items.map(item => ({
      product: item.product._id,
      quantity: item.quantity,
      price: item.price,
      size: item.size,
    }));

    // Fetch coupon if applied
    let discountAmount = 0;
    if (couponCode) {
      const coupon = await Coupon.findOne({ couponCode }).session(session);
      if (coupon) {
        discountAmount = (cart.total * coupon.discountRate) / 100;
      }
    }

    // Create the order
    const newOrder = new Order({
      user: user._id,
      items: orderItems,
      shippingAddress: selectedAddress,
      totalAmount: cart.newTotal || cart.total,
      paymentMethod,
      couponCode: couponCode || null,
      discountAmount: discountAmount,
      transactiontype: paymentMethod === 'WALLET' || paymentMethod === 'RAZORPAY' ? 'DEBIT' : undefined,
    });

    await newOrder.save({ session });

    // Clear the cart
    cart.items = [];
    cart.total = 0;
    cart.newTotal = 0;
    cart.couponApplied = null;
    await cart.save({ session });

    await session.commitTransaction();
    return newOrder;
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in placeOrderHelper:', error);
    throw error;
  } finally {
    session.endSession();
  }
};