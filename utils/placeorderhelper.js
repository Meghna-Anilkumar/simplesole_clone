const mongoose = require('mongoose');
const Product = require('../models/product');
const Order = require('../models/orderSchema');
const Cart = require('../models/cartSchema');

module.exports = async (user, selectedAddress, paymentMethod, cart, couponCode) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    for (const item of cart.items) {
      const product = await Product.findById(item.product._id).session(session);
      if (!product || product.stock - product.reserved < item.quantity) {
        throw new Error(`Insufficient stock for product: ${product ? product.name : 'Unknown'}`);
      }
      if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
        await Product.findByIdAndUpdate(
          item.product._id,
          { $inc: { reserved: -item.quantity, version: 1 } },
          { session }
        );
        cart.items = cart.items.filter((i) => i.product.toString() !== item.product._id.toString());
        await cart.save({ session });
        throw new Error(`Reservation expired for product: ${product ? product.name : 'Unknown'}`);
      }
    }

    for (const item of cart.items) {
      const product = await Product.findById(item.product._id).session(session);
      product.stock -= item.quantity;
      product.reserved -= item.quantity;
      product.version += 1;
      await product.save({ session });
    }

    const newOrder = new Order({
      user,
      items: cart.items,
      shippingAddress: selectedAddress,
      totalAmount: cart.couponApplied && cart.newTotal ? cart.newTotal : cart.total,
      paymentMethod,
      couponApplied: couponCode || null,
      discountAmount: cart.couponApplied ? cart.total - cart.newTotal : 0,
      transactiontype: paymentMethod === 'WALLET' || paymentMethod === 'RAZORPAY' ? 'DEBIT' : undefined,
    });

    await newOrder.save({ session });

    cart.items = [];
    cart.total = 0;
    cart.newTotal = 0;
    cart.couponApplied = null;
    await cart.save({ session });

    await session.commitTransaction();
    return newOrder;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};