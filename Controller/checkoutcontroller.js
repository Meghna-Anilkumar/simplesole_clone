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
const placeOrderHelper = require("../utils/placeorderhelper");
const ProductOffer = require('../models/productoffermodel');
const CategoryOffer = require('../models/categoryoffer');
const { calculateTotalPrice } = require('../utils/cartfunctions');
const Coupon=require('../models/coupon')

const instance = new Razorpay({
  key_id: process.env.key_id,
  key_secret: process.env.key_secret,
});

module.exports = {
  checkoutpage: async (req, res) => {
    try {
      const user = req.session.user;
      const order = await Order.find();
      const coupon = await Coupon.find();
      const categories = await Category.find();
      const addresses = await Address.find({ user: user });
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();
      const wishlist = await Wishlist.findOne({ user }).populate("items.product");
      const discount = req.session.discount || 0;

      if (cart) {
        const productOffers = await ProductOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        });
        const categoryOffers = await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        });
        const totalPrice = await calculateTotalPrice(cart.items, productOffers, categoryOffers);
        cart.total = totalPrice;
        if (!req.session.couponCode) {
          cart.newTotal = totalPrice;
          cart.couponApplied = null;
          await cart.save();
        }
        console.log('Checkout cart state:', { total: cart.total, newTotal: cart.newTotal, couponApplied: cart.couponApplied });
      }

      req.session.totalpay = cart ? (cart.newTotal || cart.total) : 0;

      res.render("userviews/checkout", {
        title: "Checkout Page",
        category: categories,
        cart,
        addresses,
        order,
        wishlist,
        discount,
      });
    } catch (error) {
      console.error("Error in checkoutpage:", error);
      res.status(500).render("userviews/error", { error: "Internal Server Error" });
    }
  },

  placeorder: async (req, res) => {
    try {
      const { paymentMethod, appliedCouponCode, selectedAddress } = req.body;
      const userId = req.session.user._id;
      req.session.couponCode = appliedCouponCode;
      const user = await User.findById(userId);
      const cart = await Cart.findOne({ user: userId })
        .populate("items.product")
        .exec();

      if (!cart || !cart.items.length) {
        const categories = await Category.find();
        const addresses = await Address.find({ user: userId });
        const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product");
        return res.render("userviews/checkout", {
          title: "Checkout Page",
          wishlist,
          category: categories,
          cart,
          addresses,
          error: "Cart is empty",
        });
      }

      if (!selectedAddress) {
        const categories = await Category.find();
        const addresses = await Address.find({ user: userId });
        const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product");
        return res.render("userviews/checkout", {
          title: "Checkout Page",
          wishlist,
          category: categories,
          cart,
          addresses,
          error: "Please select a shipping address",
        });
      }

      const address = await Address.findById(selectedAddress);
      if (!address) {
        const categories = await Category.find();
        const addresses = await Address.find({ user: userId });
        const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product");
        return res.render("userviews/checkout", {
          title: "Checkout Page",
          wishlist,
          category: categories,
          cart,
          addresses,
          error: "Invalid shipping address selected",
        });
      }

      if (appliedCouponCode && !user.usedCoupons.includes(appliedCouponCode)) {
        user.usedCoupons.push(appliedCouponCode);
        await user.save();
      }

      if (paymentMethod === "CASH_ON_DELIVERY") {
        if (cart.total > 1000) {
          const categories = await Category.find();
          const addresses = await Address.find({ user: userId });
          const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product");
          return res.render("userviews/checkout", {
            title: "Checkout Page",
            wishlist,
            category: categories,
            cart,
            addresses,
            error: "Cash on Delivery not available for orders above ₹1000",
          });
        }

        await placeOrderHelper(user, selectedAddress, paymentMethod, cart, appliedCouponCode);
        return res.render("userviews/successpage");
      } else if (paymentMethod === "WALLET") {
        const userWallet = await Wallet.findOne({ user: userId });
        const totalAmount = cart.newTotal || cart.total;
        if (!userWallet || userWallet.balance < totalAmount) {
          const categories = await Category.find();
          const addresses = await Address.find({ user: userId });
          const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product");
          return res.render("userviews/checkout", {
            title: "Checkout Page",
            wishlist,
            category: categories,
            cart,
            addresses,
            error: "Insufficient balance in the wallet",
          });
        }

        userWallet.balance -= totalAmount;
        await userWallet.save();
        await placeOrderHelper(user, selectedAddress, paymentMethod, cart, appliedCouponCode);
        return res.render("userviews/successpage");
      } else {
        return res.status(400).json({ error: "Invalid payment method" });
      }
    } catch (error) {
      console.error("Error in placeorder:", error);
      const userId = req.session.user._id;
      const categories = await Category.find();
      const addresses = await Address.find({ user: userId });
      const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product");
      const cart = await Cart.findOne({ user: userId })
        .populate("items.product")
        .exec();
      return res.render("userviews/checkout", {
        title: "Checkout Page",
        wishlist,
        category: categories,
        cart,
        addresses,
        error: error.message || "Internal server error",
      });
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

      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);
      const calculatedTotal = await calculateTotalPrice(cart.items, productOffers, categoryOffers);

      const expectedAmount = cart.newTotal || calculatedTotal;
      console.log('Razorpay order validation:', {
        providedAmount: amount,
        expectedAmount,
        cartTotal: cart.total,
        cartNewTotal: cart.newTotal,
      });

      if (Math.abs(parseFloat(amount) - expectedAmount) > 0.01) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: `Provided amount (₹${amount}) does not match cart total (₹${expectedAmount})`,
        });
      }

      for (const item of cart.items) {
        const product = item.product;
        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({ error: "Product not found" });
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: `Size ${item.size} not available for ${product.name}` });
        }

        const availableStock = variant.stock - (product.reserved || 0);
        if (availableStock < item.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for ${product.name}, size ${item.size}. Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available.`,
          });
        }

        if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
          await Product.findByIdAndUpdate(
            item.product._id,
            { $inc: { reserved: -item.quantity, version: 1 } },
            { session }
          );
          cart.items = cart.items.filter(
            (i) => i.product._id.toString() !== item.product._id.toString() || i.size !== item.size
          );
          await cart.save({ session });
          await session.commitTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            error: `Reservation expired for ${product.name}, size ${item.size}. Please add the item to cart again.`,
          });
        }
      }

      const amountInPaise = Math.floor(parseFloat(amount) * 100);
      const razorpayOptions = {
        amount: amountInPaise,
        currency: "INR",
        receipt: `order_rcpt_${Math.random().toString(36).substring(7)}`,
        notes: {
          user_id: user._id.toString(),
          cart_items: cart.items.length,
        },
      };

      const razorpayOrder = await new Promise((resolve, reject) => {
        instance.orders.create(razorpayOptions, (err, order) => {
          if (err) {
            console.error("Razorpay order creation error:", err);
            reject(err);
          } else {
            resolve(order);
          }
        });
      });

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
      console.error("Error creating Razorpay order:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create payment order. Please try again.",
      });
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
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .session(session);

      if (!cart || !cart.items.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, error: "Cart is empty" });
      }

      const generatedSignature = crypto
        .createHmac("sha256", process.env.key_secret)
        .update(order_id + "|" + payment_id)
        .digest("hex");

      if (generatedSignature !== signature) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, error: "Invalid payment signature" });
      }

      for (const item of cart.items) {
        const product = item.product;
        if (!product) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({ error: "Product not found" });
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: `Size ${item.size} not available for ${product.name}` });
        }

        const availableStock = variant.stock - (product.reserved || 0);
        if (availableStock < item.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            error: `Insufficient stock for ${product.name}, size ${item.size}. Only ${availableStock} item${availableStock !== 1 ? 's' : ''} available.`,
          });
        }
      }

      const totalAmount = cart.newTotal || cart.total;

      const orderItems = cart.items.map((item) => ({
        product: item.product._id,
        quantity: item.quantity,
        price: item.price,
        size: item.size, // Include size in order items
      }));

      const order = new Order({
        user: user._id,
        items: orderItems,
        totalAmount: totalAmount,
        shippingAddress: selectedAddress,
        paymentMethod,
        couponCode: appliedCouponCode || null,
        discountAmount: cart.couponApplied ? cart.total - cart.newTotal : 0,
        status: "Pending",
        paymentStatus: "Completed",
      });

      await order.save({ session });

      for (const item of cart.items) {
        const product = await Product.findById(item.product._id).session(session);
        const variant = product.variants.find((v) => v.size === item.size);
        variant.stock -= item.quantity;
        product.reserved = (product.reserved || 0) - item.quantity;
        product.version += 1;
        await product.save({ session });
      }

      cart.items = [];
      cart.total = 0;
      cart.newTotal = 0;
      cart.couponApplied = null;
      await cart.save({ session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: "Payment processed successfully" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error processing payment:", error);
      res.status(500).json({ success: false, error: "Failed to process payment" });
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
          const product = await Product.findById(item.product._id).session(session);
          if (product.reserved >= item.quantity) {
            await Product.findByIdAndUpdate(
              item.product._id,
              { $inc: { reserved: -item.quantity, version: 1 } },
              { session }
            );
          }
          cart.items = cart.items.filter(
            (i) => i.product._id.toString() !== item.product._id.toString() || i.size !== item.size
          );
        }
      }

      const totalPrice = await calculateTotalPrice(cart.items, await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }), await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }));
      cart.total = totalPrice;
      if (!req.session.couponCode) {
        cart.newTotal = totalPrice;
        cart.couponApplied = null;
      }
      await cart.save({ session });

      console.log('Cart updated (paymentFailure):', { total: cart.total, newTotal: cart.newTotal });

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
            console.warn(`Found null product in order ${order._id}, item will be filtered out`);
            return false;
          }
          return true;
        });
        return { ...order.toObject(), items: validItems };
      });

      const totalPages = Math.ceil(totalOrders / limit);

      const categories = await Category.find();
      const wishlist = await Wishlist.findOne({ user }).populate("items.product");
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
      const wishlist = await Wishlist.findOne({ user }).populate("items.product");
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
      const order = await Order.findById(orderId).session(session);
      if (!order) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Order not found" });
      }

      if (order.orderStatus !== "CANCELLED") {
        await Promise.all(
          order.items.map(async (item) => {
            const product = await Product.findById(item.product._id).session(session);
            if (product) {
              const variant = product.variants.find((v) => v.size === item.size);
              if (variant) {
                variant.stock += item.quantity;
                product.version += 1;
                await product.save({ session });
              }
            }
          })
        );

        if (
          order.paymentMethod === "Online Payment" ||
          order.paymentMethod === "WALLET" ||
          order.paymentMethod === "RAZORPAY"
        ) {
          const userWallet = await Wallet.findOne({ user: order.user }).session(session);
          if (userWallet) {
            userWallet.balance += order.totalAmount;
            await userWallet.save({ session });
          }
          order.transactiontype = "CREDIT";
        }

        order.orderStatus = "CANCELLED";
        order.cancellationReason = cancellationReason || "";
        await order.save({ session });

        await session.commitTransaction();
        session.endSession();
        return res.json({ message: "Order cancelled successfully" });
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Order is already cancelled" });
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  confirmItemCancellation: async (req, res) => {
    const { orderId, index } = req.params;
    const { itemCancellationReason } = req.body;
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

      const itemIndex = parseInt(index, 10);
      const item = order.items[itemIndex];

      if (!item) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Item not found in the order" });
      }

      if (item.itemstatus !== "CANCELLED") {
        item.itemstatus = "CANCELLED";
        item.cancellationReason = itemCancellationReason;

        if (item.product && item.price) {
          const cancelledItemTotal = item.price * item.quantity;
          order.totalAmount -= cancelledItemTotal;

          const product = await Product.findById(item.product._id).session(session);
          if (product) {
            const variant = product.variants.find((v) => v.size === item.size);
            if (variant) {
              variant.stock += item.quantity;
              product.version += 1;
              await product.save({ session });
            }
          }

          if (
            order.paymentMethod === "RAZORPAY" ||
            order.paymentMethod === "WALLET"
          ) {
            const userWallet = await Wallet.findOne({
              user: order.user,
            }).session(session);
            if (userWallet) {
              userWallet.balance += cancelledItemTotal;
              await userWallet.save({ session });
            }
            order.transactiontype = "CREDIT";
          }
        } else {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ error: "Product price is undefined" });
        }

        await order.save({ session });

        const allItemsCancelled = order.items.every(
          (item) => item.itemstatus === "CANCELLED"
        );
        if (allItemsCancelled) {
          order.orderStatus = "CANCELLED";
          order.cancellationReason = itemCancellationReason || "";
          await order.save({ session });
        }

        await session.commitTransaction();
        session.endSession();
        return res.json({ message: "Item cancelled successfully" });
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Item is already cancelled" });
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  },

  getsuccesspage: async (req, res) => {
    res.render("userviews/successpage");
  },

  getwalletpage: async (req, res) => {
    try {
      const user = req.session.user;
      let wallet = await Wallet.findOne({ user });

      if (!wallet) {
        wallet = new Wallet({ user });
        await wallet.save();
      }

      const category = await Category.find();
      const walletBalance = wallet.balance;
      const walletHistory = await Order.find({ user }).sort({ orderdate: -1 });
      const wishlist = await Wishlist.findOne({ user }).populate("items.product");
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      return res.render("userviews/wallet", {
        title: "Wallet",
        wallet,
        category,
        user,
        walletBalance,
        orders: walletHistory,
        wishlist,
        cart,
      });
    } catch (error) {
      console.error("Error fetching wallet balance:", error);
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

      const doc = new PDFDocument({ margin: 25 });
      const fileName = `invoice_${orderId}.pdf`;
      res.setHeader("Content-disposition", `attachment; filename=${fileName}`);
      res.setHeader("Content-type", "application/pdf");

      doc.pipe(res);
      doc
        .fontSize(18)
        .text(`Invoice for Order ID: ${order.orderId}`, { align: "center" })
        .moveDown();
      doc.fontSize(12).text(`Status: ${order.orderStatus}`).moveDown();
      doc
        .font("Helvetica-Bold")
        .text("Product", 100, 200)
        .text("Size", 250, 200)
        .text("Quantity", 300, 200)
        .text("Price", 350, 200)
        .text("Total", 450, 200);

      let y = 230;
      order.items.forEach((item) => {
        doc
          .font("Helvetica")
          .text(item.product.name, 100, y)
          .text(item.size, 250, y)
          .text(item.quantity.toString(), 300, y)
          .text(`₹${item.price}`, 350, y)
          .text(`₹${item.price * item.quantity}`, 450, y);
        y += 20;
      });

      doc.text(`User Name: ${user.name}`).moveDown();
      doc
        .text(
          `Shipped Address: ${order.shippingAddress.buildingname}, ${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.pincode}`
        )
        .moveDown();
      doc.text(`Ordered Date: ${order.orderdate.toDateString()}`).moveDown();
      doc.text(`Subtotal: ₹${order.totalAmount}`).moveDown();
      doc
        .fontSize(16)
        .text("Thank you for Shopping!", { align: "center" })
        .moveDown();

      doc.end();
    } catch (error) {
      console.error("Error generating PDF:", error);
      res.status(500).send("Internal Server Error");
    }
  },
};