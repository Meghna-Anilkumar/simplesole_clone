const Wishlist = require("../models/wishlist");

module.exports = {
  wishlistCount: async (req, res, next) => {
    try {
      if (req.session.user && req.session.user._id) {
        const wishlist = await Wishlist.findOne({ user: req.session.user._id });
        const totalItems = wishlist && wishlist.items ? wishlist.items.length : 0;

        res.locals.wishlistCount = totalItems;
        res.locals.wishlist = wishlist;
      } else {
        res.locals.wishlistCount = 0;
        res.locals.wishlist = null;
      }
    } catch (error) {
      console.error("Error in wishlistCount middleware:", error);
      res.locals.wishlistCount = 0;
      res.locals.wishlist = null;
    }
    next();
  },
};