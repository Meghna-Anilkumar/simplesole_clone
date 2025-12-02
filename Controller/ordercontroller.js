const mongoose = require("mongoose");
const Cart = require("../models/cartSchema");
const Category = require("../models/category");
const Product = require("../models/product");
const Address = require("../models/address");
const Order = require("../models/orderSchema");
const Razorpay = require("razorpay");
const Wallet = require("../models/wallet");
const crypto = require("crypto");
const User = require("../models/user");
require("dotenv").config();
const PDFDocument = require("pdfkit");
const Wishlist = require("../models/wishlist");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const { calculateTotalPrice } = require("../utils/cartfunctions");
const Coupon = require("../models/coupon");

const instance = new Razorpay({
  key_id: process.env.key_id,
  key_secret: process.env.key_secret,
});

module.exports = {
  checkoutpage: async (req, res) => {
    try {
      const user = req.session.user;
      const order = await Order.find();
      const wallet = await Wallet.findOne({ user: user._id || user });
      const categories = await Category.find();
      const addresses = await Address.find({ user: user });
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();
      const wishlist = await Wishlist.findOne({ user }).populate(
        "items.product"
      );

      let discount = 0;

      if (cart) {
        const productOffers = await ProductOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        });
        const categoryOffers = await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        });
        const totalPrice = await calculateTotalPrice(
          cart.items,
          productOffers,
          categoryOffers
        );
        cart.total = totalPrice;

        if (
          req.session.couponCode &&
          cart.couponApplied === req.session.couponCode
        ) {
          const coupon = await Coupon.findOne({
            couponCode: req.session.couponCode,
          });
          if (coupon && cart.total >= coupon.minimumPurchaseAmount) {
            discount = (cart.total * coupon.discountRate) / 100;
            cart.newTotal = cart.total - discount;
            cart.couponApplied = req.session.couponCode;
          } else {
            cart.newTotal = cart.total;
            cart.couponApplied = null;
            req.session.couponCode = null;
            req.session.discount = 0;
          }
        } else {
          cart.newTotal = cart.total;
          cart.couponApplied = null;
          req.session.couponCode = null;
          req.session.discount = 0;
        }
        await cart.save();
        console.log("Checkout cart state:", {
          total: cart.total,
          newTotal: cart.newTotal,
          couponApplied: cart.couponApplied,
        });
      }

      req.session.totalpay = cart ? cart.newTotal || cart.total : 0;

      res.render("userviews/checkout", {
        title: "Checkout Page",
        category: categories,
        cart,
        addresses,
        order,
        wishlist,
        discount,
        wallet,
      });
    } catch (error) {
      console.error("Error in checkoutpage:", error);
      res
        .status(500)
        .render("userviews/error", { error: "Internal Server Error" });
    }
  },

  createRazorpayOrder: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { amount } = req.body;
      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .session(session);

      if (!cart || !cart.items.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, error: "Cart is empty" });
      }

      const unavailableItems = [];

      for (const item of cart.items) {
        const product = await Product.findById(item.product._id).session(
          session
        );
        if (!product || product.blocked) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: "Product unavailable",
          });
          continue;
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: "Size not available",
          });
          continue;
        }

        const userReservedQty = item.quantity;
        const othersReserved = Math.max(
          0,
          (variant.reserved || 0) - userReservedQty
        );
        const trulyAvailable = variant.stock - othersReserved;

        if (trulyAvailable < item.quantity) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Only ${trulyAvailable} available`,
          });
        }

        if (
          !item.reservedAt ||
          item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)
        ) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: "Reservation expired",
          });

          await Product.findOneAndUpdate(
            { _id: product._id, "variants.size": item.size },
            {
              $inc: {
                "variants.$.reserved": -item.quantity,
                reserved: -item.quantity,
                version: 1,
              },
            },
            { session }
          );

          cart.items = cart.items.filter(
            (i) => !(i.product.equals(product._id) && i.size === item.size)
          );
        }
      }

      if (unavailableItems.length > 0) {
        await cart.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: "Some items are no longer available",
          unavailableItems,
        });
      }

      cart.items.forEach((i) => (i.reservedAt = new Date()));
      await cart.save({ session });

      const totalPrice = cart.newTotal || cart.total;
      if (Math.abs(parseFloat(amount) - totalPrice) > 0.01) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: "Amount mismatch",
        });
      }

      const razorpayOrder = await instance.orders.create({
        amount: Math.round(totalPrice * 100),
        currency: "INR",
        receipt: `order_${Date.now()}_${user._id.toString().slice(-6)}`,
      });

      req.session.razorpayOrderId = razorpayOrder.id;

      await session.commitTransaction();
      session.endSession();

      res.json({
        success: true,
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("createRazorpayOrder error:", error);
      res.status(500).json({ success: false, error: "Failed to create order" });
    }
  },

  processPayment: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        payment_id,
        order_id,
        signature,
        paymentMethod,
        selectedAddress,
        appliedCouponCode,
      } = req.body;

      const user = req.session.user;
      if (!user) throw new Error("User not authenticated");

      const cart = await Cart.findOne({ user: user._id })
        .populate("items.product")
        .session(session);

      if (!cart || !cart.items.length) {
        throw new Error("Cart is empty");
      }

      const expectedSignature = crypto
        .createHmac("sha256", process.env.key_secret)
        .update(order_id + "|" + payment_id)
        .digest("hex");

      if (expectedSignature !== signature) {
        throw new Error("Invalid payment signature");
      }

      const unavailableItems = [];
      for (const item of cart.items) {
        const product = await Product.findById(item.product._id).session(
          session
        );
        if (!product || product.blocked) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: "Product unavailable",
          });
          continue;
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: "Size not available",
          });
          continue;
        }

        const othersReserved = Math.max(
          0,
          (variant.reserved || 0) - item.quantity
        );
        const trulyAvailable = variant.stock - othersReserved;

        if (trulyAvailable < item.quantity) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: `Only ${trulyAvailable} left`,
          });
        }
      }

      if (unavailableItems.length > 0) {
        for (const item of cart.items) {
          await Product.findOneAndUpdate(
            { _id: item.product._id, "variants.size": item.size },
            {
              $inc: {
                "variants.$.reserved": -item.quantity,
                reserved: -item.quantity,
                version: 1,
              },
            },
            { session }
          );
        }
        await cart.save({ session });
        await session.commitTransaction();
        session.endSession();

        return res.status(400).json({
          success: false,
          error: "Some items are no longer available",
          unavailableItems,
        });
      }

      const totalAmount = cart.newTotal || cart.total;
      const trimmedCouponCode = appliedCouponCode?.trim();
      let couponDoc = null;

      if (trimmedCouponCode) {
        couponDoc = await Coupon.findOne({
          couponCode: trimmedCouponCode,
        }).session(session);
      }

      const order = new Order({
        user: user._id,
        items: cart.items.map((i) => ({
          product: i.product._id,
          quantity: i.quantity,
          price: i.price,
          size: i.size,
        })),
        totalAmount,
        shippingAddress: selectedAddress,
        paymentMethod: "RAZORPAY",
        orderStatus: "PROCESSING",
        paymentStatus: "Completed",
        couponCode: trimmedCouponCode || null,
        discountAmount: trimmedCouponCode ? cart.total - totalAmount : 0,
      });

      await order.save({ session });

      for (const item of cart.items) {
        await Product.findOneAndUpdate(
          { _id: item.product._id, "variants.size": item.size },
          {
            $inc: {
              "variants.$.stock": -item.quantity,
              "variants.$.reserved": -item.quantity,
              reserved: -item.quantity,
              version: 1,
            },
          },
          { session }
        );
      }

      if (couponDoc) {
        await User.findByIdAndUpdate(
          user._id,
          { $addToSet: { usedCoupons: couponDoc._id } },
          { session }
        );
      }

      cart.items = [];
      cart.total = cart.newTotal = 0;
      cart.couponApplied = null;
      await cart.save({ session });

      req.session.couponCode = null;
      req.session.discount = 0;
      req.session.totalpay = 0;

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success: true,
        message: "Payment successful! Order placed.",
        redirectUrl: "/successpage",
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("processPayment error:", error.message);

      return res.status(400).json({
        success: false,
        error: error.message || "Payment processing failed",
      });
    }
  },

  razorpayFailure: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { razorpay_order_id, error, selectedAddress, appliedCouponCode } =
        req.body;
      const user = req.session.user;

      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .session(session);

      if (!cart || !cart.items.length) {
        await session.abortTransaction();
        session.endSession();
        return res.json({ success: false, error: "Cart empty" });
      }

      for (const item of cart.items) {
        const product = await Product.findById(item.product._id).session(
          session
        );
        if (product) {
          const variant = product.variants.find((v) => v.size === item.size);
          if (variant) {
            variant.reserved = Math.max(
              0,
              (variant.reserved || 0) - item.quantity
            );
            product.reserved = Math.max(
              0,
              (product.reserved || 0) - item.quantity
            );
            product.version += 1;
            await product.save({ session });
          }
        }
      }

      const totalAmount = cart.newTotal || cart.total;
      const failedOrder = new Order({
        user: user._id,
        items: cart.items.map((i) => ({
          product: i.product._id,
          quantity: i.quantity,
          price: i.price,
          size: i.size,
          itemstatus: "PENDING",
        })),
        shippingAddress: selectedAddress,
        totalAmount,
        paymentMethod: "RAZORPAY",
        orderStatus: "PAYMENT_FAILED",
        paymentError: error?.description || error?.reason || "Payment failed",
        couponCode: appliedCouponCode || null,
        discountAmount: cart.couponApplied ? cart.total - cart.newTotal : 0,
        razorpayOrderId: razorpay_order_id,
      });

      await failedOrder.save({ session });

      cart.items = [];
      cart.total = 0;
      cart.newTotal = 0;
      cart.couponApplied = null;
      await cart.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success: true,
        message: "Payment failed – order recorded as failed",
        redirect: "/myorders",
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.error("razorpayFailure error:", err);
      res.status(500).json({ success: false, error: "Server error" });
    }
  },

  placeorder: async (req, res) => {
    const mainSession = await mongoose.startSession();
    mainSession.startTransaction();

    try {
      const { paymentMethod, selectedAddress, appliedCouponCode } = req.body; 
      const user = req.session.user;

      console.log("=== PLACE ORDER START ===", {
        paymentMethod,
        userId: user?._id,
        appliedCouponCode,
      });

      if (!user) return res.redirect("/login");
      if (!selectedAddress || !paymentMethod) {
        const err = "Please select address and payment method";
        return req.xhr
          ? res.status(400).json({ success: false, error: err })
          : res
              .status(400)
              .send(`<script>alert("${err}"); window.history.back();</script>`);
      }

      const cart = await Cart.findOne({ user: user._id })
        .populate("items.product")
        .session(mainSession);

      if (!cart || cart.items.length === 0) {
        const err = "Your cart is empty";
        return req.xhr
          ? res.status(400).json({ success: false, error: err })
          : res
              .status(400)
              .send(
                `<script>alert("${err}"); window.location="/cart";</script>`
              );
      }

      const unavailableItems = [];

      for (const item of cart.items) {
        const product = await Product.findById(item.product._id).session(
          mainSession
        );
        if (!product || product.blocked) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: "Product unavailable",
          });
          continue;
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: "Size not available",
          });
          continue;
        }

        const userReserved = item.quantity;
        const othersReserved = Math.max(
          0,
          (variant.reserved || 0) - userReserved
        );
        const trulyAvailable = variant.stock - othersReserved;

        if (trulyAvailable < item.quantity) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: `Only ${trulyAvailable} left`,
          });
        }

        if (
          !item.reservedAt ||
          item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)
        ) {
          unavailableItems.push({
            name: item.product.name,
            size: item.size,
            reason: "Reservation expired",
          });
          await Product.findOneAndUpdate(
            { _id: product._id, "variants.size": item.size },
            {
              $inc: {
                "variants.$.reserved": -item.quantity,
                reserved: -item.quantity,
                version: 1,
              },
            },
            { session: mainSession }
          );
          cart.items = cart.items.filter(
            (i) => !(i.product._id.equals(product._id) && i.size === item.size)
          );
        }
      }

      if (unavailableItems.length > 0) {
        await cart.save({ session: mainSession });
        await mainSession.commitTransaction();
        mainSession.endSession();

        return req.xhr
          ? res.status(400).json({
              success: false,
              error: "Items unavailable",
              unavailableItems,
            })
          : res.send(`
          <script>
            alert("Some items are no longer available. Please review your cart.");
            window.location = "/cart";
          </script>
        `);
      }

      cart.items.forEach((i) => (i.reservedAt = new Date()));
      await cart.save({ session: mainSession });

      const totalPrice = cart.newTotal || cart.total;
      const trimmedCouponCode = appliedCouponCode?.trim();
      let couponDoc = null;

      if (trimmedCouponCode) {
        couponDoc = await Coupon.findOne({ couponCode: trimmedCouponCode });
      }

      const order = new Order({
        user: user._id,
        items: cart.items.map((i) => ({
          product: i.product._id,
          quantity: i.quantity,
          price: i.price,
          size: i.size,
        })),
        totalAmount: totalPrice,
        shippingAddress: selectedAddress,
        paymentMethod,
        orderStatus:
          paymentMethod === "CASH_ON_DELIVERY" || paymentMethod === "WALLET"
            ? "PROCESSING"
            : "PENDING",
        couponCode: trimmedCouponCode || null,
        discountAmount: trimmedCouponCode ? cart.total - totalPrice : 0,
      });

      await order.save({ session: mainSession });

      for (const item of cart.items) {
        await Product.findOneAndUpdate(
          { _id: item.product._id, "variants.size": item.size },
          {
            $inc: {
              "variants.$.stock": -item.quantity,
              "variants.$.reserved": -item.quantity,
              reserved: -item.quantity,
              version: 1,
            },
          },
          { session: mainSession }
        );
      }

      if (couponDoc) {
        await User.findByIdAndUpdate(
          user._id,
          { $addToSet: { usedCoupons: couponDoc._id } }, 
          { session: mainSession }
        );
      }

      if (paymentMethod === "WALLET") {
        const wallet = await Wallet.findOne({ user: user._id }).session(
          mainSession
        );
        if (!wallet || wallet.balance < totalPrice) {
          throw new Error("Insufficient wallet balance");
        }
        wallet.balance -= totalPrice;
        wallet.walletTransactions.push({
          type: "debit",
          amount: totalPrice,
          description: `Order #${order.orderId}`,
          date: new Date(),
          orderId: order._id,
        });
        await wallet.save({ session: mainSession });
        order.orderStatus = "PROCESSING";
        await order.save({ session: mainSession });
      }

      cart.items = [];
      cart.total = cart.newTotal = 0;
      cart.couponApplied = null;
      await cart.save({ session: mainSession });

      req.session.couponCode = null;
      req.session.discount = 0;
      req.session.totalpay = 0;

      await mainSession.commitTransaction();
      mainSession.endSession();

      console.log("ORDER SUCCESS:", order._id);

      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.json({
          success: true,
          message: "Order placed successfully!",
          orderId: order._id,
          redirectUrl: "/successpage",
        });
      } else {
        req.session.lastOrderId = order._id;
        return res.redirect("/successpage");
      }
    } catch (error) {
      await mainSession.abortTransaction();
      mainSession.endSession();
      console.error("PLACE ORDER ERROR:", error.message);

      return req.xhr || req.headers.accept?.includes("json")
        ? res
            .status(400)
            .json({ success: false, error: error.message || "Order failed" })
        : res.send(`
        <script>
          alert("${error.message || "Order failed. Please try again."}");
          window.history.back();
        </script>
      `);
    }
  },

  paymentFailure: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { productIds } = req.body;
      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .session(session);

      if (!cart || !cart.items.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, error: "Cart is empty" });
      }

      for (const item of cart.items) {
        if (productIds.includes(item.product._id.toString())) {
          const product = await Product.findById(item.product._id).session(
            session
          );
          if (product.reserved >= item.quantity) {
            await Product.findByIdAndUpdate(
              item.product._id,
              { $inc: { reserved: -item.quantity, version: 1 } },
              { session }
            );
          }
          cart.items = cart.items.filter(
            (i) => i.product._id.toString() !== item.product._id.toString()
          );
        }
      }

      const totalPrice = await calculateTotalPrice(
        cart.items,
        await ProductOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }),
        await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        })
      );
      cart.total = totalPrice;
      if (!req.session.couponCode) {
        cart.newTotal = totalPrice;
        cart.couponApplied = null;
      }
      await cart.save({ session });

      console.log("Cart updated (paymentFailure):", {
        total: cart.total,
        newTotal: cart.newTotal,
      });

      await session.commitTransaction();
      session.endSession();

      res.json({
        success: true,
        message: "Reserved stock released due to payment failure",
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error handling payment failure:", error);
      res.status(500).json({ success: false, error: "Internal Server Error" });
    }
  },

  createRazorpayRetryOrder: async (req, res) => {
    try {
      const { orderId, amount } = req.body;
      const userId = req.session.user._id;

      const order = await Order.findOne({ _id: orderId, user: userId });
      if (!order || order.orderStatus !== "PAYMENT_FAILED") {
        return res.json({ success: false, error: "Invalid order for retry" });
      }

      if (Math.abs(parseFloat(amount) - order.totalAmount) > 0.01) {
        return res.json({ success: false, error: "Amount mismatch" });
      }

      const receipt = `retry_${order._id.toString().slice(-10)}_${Date.now()
        .toString()
        .slice(-8)}`;

      const razorpayOrder = await instance.orders.create({
        amount: Math.round(order.totalAmount * 100),
        currency: "INR",
        receipt: receipt.substring(0, 40),
      });

      res.json({
        success: true,
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
      });
    } catch (err) {
      console.error("Retry order creation error:", err);
      res
        .status(500)
        .json({ success: false, error: err.message || "Server error" });
    }
  },

  verifyRetryPayment: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        orderId,
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature,
      } = req.body;
      const userId = req.session.user._id;

      const order = await Order.findOne({ _id: orderId, user: userId }).session(
        session
      );
      if (!order || order.orderStatus !== "PAYMENT_FAILED") {
        throw new Error("Invalid order");
      }

      const expectedSignature = crypto
        .createHmac("sha256", process.env.key_secret)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        throw new Error("Invalid payment signature");
      }

      for (const item of order.items) {
        const product = await Product.findById(item.product).session(session);
        if (product) {
          const variant = product.variants.find((v) => v.size === item.size);
          if (variant) {
            variant.stock -= item.quantity;
            product.version += 1;
            await product.save({ session });
          }
        }
      }

      order.orderStatus = "PROCESSING";
      order.paymentMethod = "RAZORPAY";
      order.paymentError = null;
      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();

      console.error("Retry payment failed:", err);
      res.json({ success: false, error: err.message });
    }
  },

  myorders: async (req, res) => {
    try {
      const user = req.session.user;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const ordersPromise = Order.find({ user })
        .populate("items.product")
        .sort({ orderdate: -1 })
        .skip(skip)
        .limit(limit)
        .exec();

      const totalOrdersPromise = Order.countDocuments({ user }).exec();

      const [orders, totalOrders] = await Promise.all([
        ordersPromise,
        totalOrdersPromise,
      ]);

      const cleanedOrders = orders.map((order) => {
        const validItems = order.items.filter((item) => {
          if (!item.product) {
            console.warn(
              `Found null product in order ${order._id}, item will be filtered out`
            );
            return false;
          }
          return true;
        });
        return { ...order.toObject(), items: validItems };
      });

      const totalPages = Math.ceil(totalOrders / limit);

      const categories = await Category.find();
      const wishlist = await Wishlist.findOne({ user }).populate(
        "items.product"
      );
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      res.render("userviews/myorders", {
        title: "My Orders",
        orders: cleanedOrders,
        category: categories,
        wishlist,
        cart,
        currentPage: page,
        totalPages,
        limit,
      });
    } catch (error) {
      console.error("Error in myorders:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  orderdetails: async (req, res) => {
    try {
      const user = req.session.user;
      const orderId = req.params.orderId;

      const order = await Order.findById(orderId)
        .populate("items.product")
        .populate("shippingAddress")
        .exec();
      const fullOrder = await Order.findById(orderId);
      console.log("full order:", fullOrder);
      const wishlist = await Wishlist.findOne({ user }).populate(
        "items.product"
      );
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      if (!order) {
        console.log("Order not found");
        return res.status(404).json({ error: "Order not found" });
      }

      const categories = await Category.find();
      res.render("userviews/orderdetails", {
        title: "My Orders",
        order,
        category: categories,
        wishlist,
        cart,
        user,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  confirmcancellation: async (req, res) => {
    const { orderId } = req.params;
    const { cancellationReason } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId)
        .populate("items.product")
        .session(session);

      if (!order) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.orderStatus === "CANCELLED") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Order is already cancelled" });
      }
      const subtotal = order.items.reduce((sum, item) => {
        if (item.itemstatus !== "CANCELLED") {
          return sum + item.price * item.quantity;
        }
        return sum;
      }, 0);

      let effectiveTotal = subtotal;
      if (order.couponCode && order.discountAmount > 0 && subtotal > 0) {
        effectiveTotal -= order.discountAmount;
      }

      const remainingRefund = Math.max(
        0,
        effectiveTotal - (order.refundedAmount || 0)
      );

      for (const item of order.items) {
        if (item.itemstatus === "CANCELLED") continue;

        item.itemstatus = "CANCELLED";
        item.cancellationReason = cancellationReason || "Order cancelled";

        const product = await Product.findById(item.product._id).session(
          session
        );
        if (product && Array.isArray(product.variants)) {
          const variant = product.variants.find((v) => v.size === item.size);
          if (variant) {
            variant.stock += item.quantity;
            variant.reserved = Math.max(
              0,
              (variant.reserved || 0) - item.quantity
            );
          }
          product.reserved = Math.max(
            0,
            (product.reserved || 0) - item.quantity
          );
          product.version += 1;
          await product.save({ session });
        }
      }

      if (
        remainingRefund > 0 &&
        (order.paymentMethod === "RAZORPAY" || order.paymentMethod === "WALLET")
      ) {
        let userWallet = await Wallet.findOne({ user: order.user }).session(
          session
        );
        if (!userWallet) {
          userWallet = new Wallet({
            user: order.user,
            balance: 0,
            walletTransactions: [],
          });
        }

        userWallet.balance += remainingRefund;
        userWallet.walletTransactions.push({
          type: "credit",
          amount: remainingRefund,
          description: `Refund for cancelled Order ${order.orderId}`,
          date: new Date(),
          orderId: order._id,
        });
        await userWallet.save({ session });

        order.refundedAmount = (order.refundedAmount || 0) + remainingRefund;
        order.transactiontype = "CREDIT";
      }

      order.orderStatus = "CANCELLED";
      order.cancellationReason = cancellationReason || "Order cancelled";
      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.json({
        message: "Order cancelled successfully",
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in confirmcancellation:", error);
      return res.status(500).json({ error: "Failed to cancel order" });
    }
  },

  confirmItemCancellation: async (req, res) => {
    const { orderId, index } = req.params;
    const { itemCancellationReason } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error("Order not found");

      const itemIndex = parseInt(index, 10);
      const item = order.items[itemIndex];
      if (!item || item.itemstatus === "CANCELLED") {
        throw new Error("Item already cancelled or not found");
      }

      const refundAmount = item.price * item.quantity;


      const product = await Product.findById(item.product).session(session);
      if (product) {
        const variant = product.variants.find((v) => v.size === item.size);
        if (variant) {
          variant.stock += item.quantity;
        }
        product.reserved = Math.max(0, (product.reserved || 0) - item.quantity);
        product.version += 1;
        await product.save({ session });
      }

      if (["RAZORPAY", "WALLET"].includes(order.paymentMethod)) {
        let wallet =
          (await Wallet.findOne({ user: order.user }).session(session)) ||
          new Wallet({ user: order.user, balance: 0, walletTransactions: [] });

        wallet.balance += refundAmount;
        wallet.walletTransactions.push({
          type: "credit",
          amount: refundAmount,
          description: `Refund for cancelled item (Order #${order.orderId})`,
          date: new Date(),
          orderId: order._id,
        });
        await wallet.save({ session });

        order.refundedAmount = (order.refundedAmount || 0) + refundAmount;
      }

      item.itemstatus = "CANCELLED";
      item.cancellationReason = itemCancellationReason;
      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success: true,
        message: "Item cancelled successfully",
        refundAmount,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Item cancellation failed:", error.message);
      return res.status(500).json({ error: error.message });
    }
  },

  getsuccesspage: async (req, res) => {
    res.render("userviews/successpage");
  },

  getwalletpage: async (req, res) => {
    try {
      const user = req.session.user;
      const pageSize = parseInt(req.query.pageSize) || 10;
      let currentPage = parseInt(req.query.page) || 1;

      let wallet = await Wallet.findOne({ user }).populate(
        "walletTransactions.orderId"
      );

      if (!wallet) {
        wallet = new Wallet({ user });
        await wallet.save();
      }

      const category = await Category.find();
      const walletBalance = wallet.balance;
      const wishlist = await Wishlist.findOne({ user }).populate(
        "items.product"
      );
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      const totalTransactions = wallet.walletTransactions.length;
      const totalPages = Math.ceil(totalTransactions / pageSize);
      currentPage = Math.min(Math.max(currentPage, 1), totalPages || 1);

      const sortedTransactions = [...wallet.walletTransactions].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );
      const startIndex = (currentPage - 1) * pageSize;
      const paginatedTransactions = sortedTransactions.slice(
        startIndex,
        startIndex + pageSize
      );

      return res.render("userviews/wallet", {
        title: "Wallet",
        wallet,
        category,
        user,
        walletBalance,
        walletHistory: paginatedTransactions,
        wishlist,
        cart,
        pagination: {
          currentPage,
          totalPages,
          pageSize,
          totalTransactions,
        },
      });
    } catch (error) {
      console.error("Error fetching wallet page:", error);
      return res.status(500).send("Internal Server Error");
    }
  },

  returnorder: async (req, res) => {
    const { orderId } = req.params;
    const { returnReason } = req.body;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);
      if (!order) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.orderStatus === "DELIVERED") {
        order.orderStatus = "RETURN REQUESTED";
        order.returnReason = returnReason || "";
        await order.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.json({ message: "Return requested successfully" });
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: "Order cannot be returned because it is not delivered yet",
        });
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  downloadinvoice: async (req, res) => {
    try {
      const orderId = req.params.orderId;
      const user = req.session.user;

      const order = await Order.findById(orderId)
        .populate("items.product")
        .populate("shippingAddress");

      if (!order) {
        return res.status(404).send("Order not found");
      }

      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
      });

      const fileName = `invoice_${order.orderId}.pdf`;
      res.setHeader("Content-disposition", `attachment; filename=${fileName}`);
      res.setHeader("Content-type", "application/pdf");

      doc.pipe(res);

      const addHorizontalLine = (y, startX = 50, endX = 550) => {
        doc.moveTo(startX, y).lineTo(endX, y).stroke();
      };

      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("INVOICE", { align: "center" })
        .moveDown(0.5);

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("SIMPLE SOLE", 50, 120)
        .font("Helvetica")
        .fontSize(10)
        .text("Simplesole floor", 50, 140)
        .text("Phone: +91 8907654332", 50, 170)
        .text("Email: simplesole@gmail.com", 50, 185);

      // Invoice Details
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`Invoice #: ${order.orderId}`, 350, 120)
        .font("Helvetica")
        .text(
          `Order Date: ${order.orderdate.toLocaleDateString("en-IN")}`,
          350,
          140
        )
        .text(`Status: ${order.orderStatus}`, 350, 160)
        .text(`Payment: ${order.paymentMethod}`, 350, 180);

      addHorizontalLine(210);

      // Customer Details
      let currentY = 230;
      doc.fontSize(14).font("Helvetica-Bold").text("Bill To:", 50, currentY);

      currentY += 20;
      doc.fontSize(11).font("Helvetica").text(`${user.name}`, 50, currentY);

      if (order.shippingAddress) {
        currentY += 15;
        doc.text(`${order.shippingAddress.buildingname}`, 50, currentY);
        currentY += 15;
        doc.text(`${order.shippingAddress.street}`, 50, currentY);
        currentY += 15;
        doc.text(
          `${order.shippingAddress.city}, ${order.shippingAddress.state}`,
          50,
          currentY
        );
        currentY += 15;
        doc.text(`PIN: ${order.shippingAddress.pincode}`, 50, currentY);
      }

      currentY += 30;
      addHorizontalLine(currentY);

      // Items Table Header
      currentY += 20;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Item", 50, currentY)
        .text("Size", 250, currentY)
        .text("Qty", 300, currentY)
        .text("Unit Price", 350, currentY)
        .text("Total", 450, currentY);

      currentY += 15;
      addHorizontalLine(currentY);

      // Items Details
      let subtotal = 0;
      currentY += 15;

      order.items.forEach((item) => {
        const itemTotal = item.price * item.quantity;
        if (item.itemstatus !== "CANCELLED") {
          subtotal += itemTotal;
        }

        doc
          .fontSize(10)
          .font("Helvetica")
          .text(item.product.name, 50, currentY, { width: 190, ellipsis: true })
          .text(item.size || "N/A", 250, currentY)
          .text(item.quantity.toString(), 300, currentY)
          .text(`₹${item.price.toFixed(2)}`, 350, currentY)
          .text(`₹${itemTotal.toFixed(2)}`, 450, currentY);

        if (item.itemstatus === "CANCELLED") {
          currentY += 12;
          doc
            .fontSize(9)
            .fillColor("red")
            .text("(CANCELLED)", 50, currentY)
            .fillColor("black");
        }

        currentY += 20;

        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }
      });

      // Summary Section
      currentY += 10;
      addHorizontalLine(currentY);
      currentY += 15;

      const summaryX = 350;

      doc
        .fontSize(11)
        .font("Helvetica")
        .text("Subtotal:", summaryX, currentY)
        .text(`₹${subtotal.toFixed(2)}`, 450, currentY);

      currentY += 20;

      let effectiveTotal = subtotal;
      if (order.couponCode && order.discountAmount > 0 && subtotal > 0) {
        doc
          .text("Coupon Applied:", summaryX, currentY)
          .text(order.couponCode, 450, currentY);

        currentY += 15;
        doc
          .text("Discount Amount:", summaryX, currentY)
          .fillColor("green")
          .text(`-₹${order.discountAmount.toFixed(2)}`, 450, currentY)
          .fillColor("black");

        effectiveTotal -= order.discountAmount;
        currentY += 20;
      } else {
        doc
          .text("Coupon Applied:", summaryX, currentY)
          .text("None", 450, currentY);

        currentY += 15;
        doc
          .text("Discount Amount:", summaryX, currentY)
          .text(`₹0.00`, 450, currentY);

        currentY += 20;
      }

      doc.text("Shipping:", summaryX, currentY).text("Free", 450, currentY);

      currentY += 20;
      addHorizontalLine(currentY - 5, summaryX, 550);

      doc
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("Total Amount:", summaryX, currentY)
        .text(`₹${effectiveTotal.toFixed(2)}`, 450, currentY);

      currentY += 30;

      if (order.paymentStatus) {
        doc
          .fontSize(11)
          .font("Helvetica")
          .text("Payment Status:", summaryX, currentY)
          .fillColor(order.paymentStatus === "Completed" ? "green" : "orange")
          .text(order.paymentStatus, 450, currentY)
          .fillColor("black");
      }

      // Thank you message
      currentY += 40;
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Thank you for your business!", { align: "center" });

      doc
        .fontSize(10)
        .font("Helvetica")
        .text("We appreciate your trust in our products.", { align: "center" });

      doc.end();
    } catch (error) {
      console.error("Error generating PDF:", error);
      res.status(500).send("Internal Server Error");
    }
  },
};
