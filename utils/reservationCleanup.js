const mongoose = require('mongoose');
const Cart = require('../models/cartSchema');
const Product = require('../models/product');
const cron = require('node-cron');

cron.schedule('* * * * *', async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const expiredCarts = await Cart.find({
      'items.reservedAt': { $lt: new Date(Date.now() - 10 * 60 * 1000) },
    }).session(session);

    for (const cart of expiredCarts) {
      for (const item of cart.items) {
        if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
          await Product.findByIdAndUpdate(
            item.product,
            { $inc: { reserved: -item.quantity, version: 1 } },
            { session }
          );
          cart.items = cart.items.filter((i) => i.product.toString() !== item.product.toString());
        }
      }
      await cart.save({ session });
    }
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error releasing reservations:', error);
  } finally {
    session.endSession();
  }
});