const Cart = require('../models/cartSchema')
const Category = require('../models/category')
const isAuth = require('../middlewares/isAuth')
const Product = require('../models/product')
const Address = require('../models/address')
const Order = require('../models/orderSchema')

const placeOrderHelper = async (user, selectedAddress, paymentMethod, cart) => {
  const newOrder = new Order({
    user,
    items: cart.items,
    shippingAddress: selectedAddress,
    totalAmount: cart.total,
    paymentMethod,
  });

  await Promise.all(cart.items.map(async item => {
    const product = await Product.findById(item.product._id);
    if (product) {
      product.stock -= item.quantity;
      await product.save();
    }
  }));

  await newOrder.save();

  cart.items = [];
  cart.total = 0;
  await cart.save();
};

module.exports = {
  placeOrderHelper,
}