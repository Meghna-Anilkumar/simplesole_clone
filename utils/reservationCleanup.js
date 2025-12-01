const mongoose = require('mongoose');
const Cart = require('../models/cartSchema');
const Product = require('../models/product');
const cron = require('node-cron');

cron.schedule("* * * * *", async () => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const expiredTime = new Date(Date.now() - 10 * 60 * 1000);
    const carts = await Cart.find({ "items.reservedAt": { $lt: expiredTime } }).session(session);

    for (const cart of carts) {
      for (const item of cart.items) {
        if (item.reservedAt < expiredTime) {
          await Product.findOneAndUpdate(
            { _id: item.product, "variants.size": item.size },
            { $inc: { "variants.$.reserved": -item.quantity, reserved: -item.quantity, version: 1 } },
            { session }
          );
          cart.items = cart.items.filter(i => !(i.product.toString() === item.product.toString() && i.size === item.size));
        }
      }
      if (cart.items.length === 0) await Cart.deleteOne({ _id: cart._id }).session(session);
      else await cart.save({ session });
    }
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    console.error("Cron reservation release failed:", err);
  } finally {
    session.endSession();
  }
});