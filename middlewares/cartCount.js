const Cart = require("../models/cartSchema");

module.exports = {
  cartCount: async (req, res, next) => {
    if (req.session.user) {
      const cart = await Cart.findOne({ user: req.session.user._id });
      const totalQty = cart
        ? cart.items.reduce((sum, item) => sum + item.quantity, 0)
        : 0;

      res.locals.cartCount = totalQty;
    } else {
      res.locals.cartCount = 0;
    }
    next();
  },
};
