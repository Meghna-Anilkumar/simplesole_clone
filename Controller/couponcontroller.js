const Coupon = require("../models/coupon");
const Cart = require("../models/cartSchema");
const User = require("../models/user");

module.exports = {
  couponpage: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const skip = (page - 1) * limit;

      const totalCoupons = await Coupon.countDocuments();
      const coupons = await Coupon.find().skip(skip).limit(limit).lean();

      res.render("adminviews/coupon", {
        title: "Coupon Page",
        coupons,
        currentPage: page,
        totalPages: Math.ceil(totalCoupons / limit) || 1,
        limit,
      });
    } catch (error) {
      console.error("Error fetching coupons:", error);
      res.status(500).json({ message: "Error fetching coupons" });
    }
  },

  createcoupon: async (req, res) => {
    try {
      const { couponCode, discountRate, minPurchaseAmount, expiryDate } = req.body;

      if (!couponCode || !discountRate || !minPurchaseAmount || !expiryDate) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const discountRateValue = parseFloat(discountRate);
      const minPurchaseAmountValue = parseFloat(minPurchaseAmount);
      const expiryDateValue = new Date(expiryDate);
      const currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);

      if (couponCode.trim() === "" || couponCode.includes(" ")) {
        return res.status(400).json({ message: "Coupon code cannot be empty or contain spaces" });
      }

      if (isNaN(discountRateValue) || discountRateValue < 1 || discountRateValue > 100) {
        return res.status(400).json({ message: "Discount rate must be between 1 and 100" });
      }

      if (isNaN(minPurchaseAmountValue) || minPurchaseAmountValue < 0) {
        return res.status(400).json({ message: "Minimum purchase amount must be a non-negative number" });
      }

      if (expiryDateValue < currentDate) {
        return res.status(400).json({ message: "Expiry date cannot be before the current date" });
      }

      const existingCoupon = await Coupon.findOne({ couponCode });
      if (existingCoupon) {
        return res.status(400).json({ message: "Coupon code already exists" });
      }

      const newCoupon = new Coupon({
        couponCode,
        discountRate: discountRateValue,
        minimumPurchaseAmount: minPurchaseAmountValue,
        expiryDate: expiryDateValue,
      });

      const savedCoupon = await newCoupon.save();

      res.status(200).json({
        message: "Coupon added successfully",
        coupon: savedCoupon,
      });
    } catch (error) {
      console.error("Error creating coupon:", error);
      res.status(500).json({ message: "Error creating coupon" });
    }
  },

  getCoupons: async (req, res) => {
    try {
      const coupons = await Coupon.find().lean();
      res.render("adminviews/coupon", {
        title: "Coupon Page",
        coupons,
        currentPage: 1,
        totalPages: Math.ceil(coupons.length / 6) || 1,
        limit: 6,
      });
    } catch (error) {
      console.error("Error fetching coupons:", error);
      res.status(500).json({ message: "Error fetching coupons" });
    }
  },

  coupons: async (req, res) => {
    try {
      const userId = req.session.user._id;
      console.log(userId, "User ID for coupon fetch");

      const user = await User.findById(userId);
      const cart = await Cart.findOne({ user: userId });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentDate = new Date();
      const coupons = await Coupon.find({
        expiryDate: { $gte: currentDate },
        _id: { $nin: user.usedCoupons || [] },
      }).sort({ discountRate: -1 });

      res.json(coupons);
    } catch (error) {
      console.error("Error fetching coupons:", error);
      res.status(500).json({ message: "Error fetching coupons" });
    }
  },

  applyCoupon: async (req, res) => {
    try {
      const { couponCode } = req.body;
      const userId = req.session.user._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const cart = await Cart.findOne({ user: userId })
        .populate("items.product")
        .exec();

      if (!couponCode) {
        cart.newTotal = cart.total; // Reset newTotal if no coupon code provided
        await cart.save();
        return res.status(400).json({ message: "Coupon code is required" });
      }

      const coupon = await Coupon.findOne({ couponCode });

      if (!coupon) {
        cart.newTotal = cart.total; // Reset newTotal if coupon is invalid
        await cart.save();
        return res.status(400).json({ message: "Invalid or expired coupon code" });
      }

      if (cart.total < coupon.minimumPurchaseAmount) {
        cart.newTotal = cart.total; // Reset newTotal if minimum purchase not met
        await cart.save();
        return res.status(400).json({ message: "Minimum purchase amount not met for this coupon" });
      }

      if (user.usedCoupons && user.usedCoupons.includes(coupon._id)) {
        cart.newTotal = cart.total; // Reset newTotal if coupon already used
        await cart.save();
        return res.status(400).json({ message: "Coupon already used" });
      }

      const discount = (cart.total * coupon.discountRate) / 100;
      const newTotal = cart.total - discount;
      cart.newTotal = newTotal;
      cart.couponApplied = couponCode; // Store the applied coupon code
      await cart.save();

      console.log('Coupon applied:', { couponCode, discount, newTotal, total: cart.total });

      req.session.couponCode = couponCode;
      req.session.discount = discount;
      req.session.totalpay = newTotal;

      return res.json({ success: true, newTotal, coupon, discount });
    } catch (error) {
      console.error('Error applying coupon:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },

  removeCoupon: async (req, res) => {
    try {
      const userId = req.session.user._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const cart = await Cart.findOne({ user: userId })
        .populate("items.product")
        .exec();

      cart.newTotal = cart.total;
      cart.couponApplied = null; // Clear the applied coupon
      await cart.save();

      console.log('Coupon removed:', { total: cart.total, newTotal: cart.newTotal });

      req.session.couponCode = "";
      req.session.discount = 0;
      req.session.totalpay = cart.total;

      return res.json({ success: true, newTotal: cart.total });
    } catch (error) {
      console.error('Error removing coupon:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  },

  editCoupon: async (req, res) => {
    try {
      const {
        editCouponId,
        editCouponCode,
        editDiscountRate,
        editMinPurchaseAmount,
        editExpiryDate,
      } = req.body;

      if (
        !editCouponId ||
        !editCouponCode ||
        !editDiscountRate ||
        !editMinPurchaseAmount ||
        !editExpiryDate
      ) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const discountRateValue = parseFloat(editDiscountRate);
      const minPurchaseAmountValue = parseFloat(editMinPurchaseAmount);
      const expiryDateValue = new Date(editExpiryDate);
      const currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);

      if (editCouponCode.trim() === "" || editCouponCode.includes(" ")) {
        return res.status(400).json({ message: "Coupon code cannot be empty or contain spaces" });
      }

      if (isNaN(discountRateValue) || discountRateValue < 1 || discountRateValue > 100) {
        return res.status(400).json({ message: "Discount rate must be between 1 and 100" });
      }

      if (isNaN(minPurchaseAmountValue) || minPurchaseAmountValue < 0) {
        return res.status(400).json({ message: "Minimum purchase amount must be a non-negative number" });
      }

      if (expiryDateValue < currentDate) {
        return res.status(400).json({ message: "Expiry date cannot be before the current date" });
      }

      const existingCoupon = await Coupon.findOne({
        couponCode: editCouponCode,
        _id: { $ne: editCouponId },
      });
      if (existingCoupon) {
        return res.status(400).json({ message: "Coupon code already exists" });
      }

      const updatedCoupon = await Coupon.findByIdAndUpdate(
        editCouponId,
        {
          couponCode: editCouponCode,
          discountRate: discountRateValue,
          minimumPurchaseAmount: minPurchaseAmountValue,
          expiryDate: expiryDateValue,
        },
        { new: true }
      );

      if (!updatedCoupon) {
        return res.status(404).json({ message: "Coupon not found" });
      }

      res.status(200).json({
        message: "Coupon updated successfully",
        coupon: updatedCoupon,
      });
    } catch (error) {
      console.error("Error updating coupon:", error);
      res.status(500).json({ message: "Error updating coupon" });
    }
  },

  deleteCoupon: async (req, res) => {
    try {
      const { id } = req.params;

      const deletedCoupon = await Coupon.findByIdAndDelete(id);
      if (!deletedCoupon) {
        return res.status(404).json({ message: "Coupon not found" });
      }

      res.status(200).json({
        message: "Coupon deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting coupon:", error);
      res.status(500).json({ message: "Error deleting coupon" });
    }
  },
};