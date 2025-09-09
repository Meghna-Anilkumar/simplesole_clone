const Cart = require('../models/cartSchema')
const Category = require('../models/category')
const isAuth = require('../middlewares/isAuth')
const Product = require('../models/product')
const Order = require('../models/orderSchema')
const Coupon = require('../models/coupon')
const Wishlist = require('../models/wishlist')
const { calculateTotalPrice } = require('../utils/cartfunctions')
const Address = require('../models/address')

module.exports = {
    checkoutpage: async (req, res) => {
  const user = req.session.user;
  const order = await Order.find();
  const coupon = await Coupon.find();
  const categories = await Category.find();
  const addresses = await Address.find({ user: user });
  const cart = await Cart.findOne({ user }).populate('items.product').exec();
  const wishlist = await Wishlist.findOne({ user }).populate('items.product');
  const discount = req.session.discount || 0;
  // Use cart.newTotal if available, else cart.total
  req.session.totalpay = cart.newTotal || cart.total;
  res.render('userviews/checkout', {
    title: 'Checkout Page',
    category: categories,
    cart,
    addresses,
    order,
    wishlist,
    discount,
  });
},
}