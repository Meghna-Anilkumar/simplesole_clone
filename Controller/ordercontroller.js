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
      const coupon = await Coupon.find();
      const categories = await Category.find();
      const addresses = await Address.find({ user: user });
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();
      const wishlist = await Wishlist.findOne({ user }).populate(
        "items.product"
      );

      // Initialize discount variable
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

        // Only apply discount if a coupon is actively applied in the session
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
            // Reset if coupon is invalid or minimum purchase not met
            cart.newTotal = cart.total;
            cart.couponApplied = null;
            req.session.couponCode = null;
            req.session.discount = 0;
          }
        } else {
          // Reset coupon data if no active coupon in session
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

      // Validate stock before creating Razorpay order
      const unavailableItems = [];
      for (const item of cart.items) {
        const product = await Product.findOne({
          _id: item.product._id,
          version: { $exists: true },
        }).session(session);
        if (!product) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: "Product not found",
          });
          continue;
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Size ${item.size} not available`,
          });
          continue;
        }

        const availableStock = variant.stock - (variant.reserved || 0);
        if (availableStock < item.quantity) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Only ${availableStock} item${
              availableStock !== 1 ? "s" : ""
            } available for size ${item.size}`,
          });
        }

        if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Reservation expired for size ${item.size}`,
          });
          variant.reserved = (variant.reserved || 0) - item.quantity;
          product.reserved = (product.reserved || 0) - item.quantity;
          product.version += 1;
          await product.save({ session });
          cart.items = cart.items.filter(
            (i) =>
              !(
                i.product._id.toString() === item.product._id.toString() &&
                i.size === item.size
              )
          );
        }
      }

      if (unavailableItems.length > 0) {
        await cart.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: "Some items are unavailable",
          unavailableItems,
        });
      }

      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).session(session);
      const calculatedTotal = await calculateTotalPrice(
        cart.items,
        productOffers,
        categoryOffers
      );

      const expectedAmount = cart.newTotal || calculatedTotal;
      console.log("Razorpay order validation:", {
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

      // Extend reservation time
      cart.items.forEach((item) => {
        item.reservedAt = new Date();
      });
      await cart.save({ session });

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
        return res
          .status(400)
          .json({ success: false, error: "Invalid payment signature" });
      }

      // Validate stock again
      const unavailableItems = [];
      for (const item of cart.items) {
        const product = await Product.findOne({
          _id: item.product._id,
          version: { $exists: true },
        }).session(session);
        if (!product) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: "Product not found",
          });
          continue;
        }

        const variant = product.variants.find((v) => v.size === item.size);
        if (!variant) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Size ${item.size} not available`,
          });
          continue;
        }

        const availableStock = variant.stock - (variant.reserved || 0);
        if (availableStock < item.quantity) {
          unavailableItems.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: `Only ${availableStock} item${
              availableStock !== 1 ? "s" : ""
            } available for size ${item.size}`,
          });
        }
      }

      if (unavailableItems.length > 0) {
        // Release reservations for all items
        for (const item of cart.items) {
          const product = await Product.findOne({
            _id: item.product._id,
            version: { $exists: true },
          }).session(session);
          if (product) {
            const variant = product.variants.find((v) => v.size === item.size);
            if (variant) {
              variant.reserved = (variant.reserved || 0) - item.quantity;
              product.reserved = (product.reserved || 0) - item.quantity;
              product.version += 1;
              await product.save({ session });
            }
          }
        }
        await cart.save({ session });
        await session.commitTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          error: "Some items are unavailable. Reservations have been released.",
          unavailableItems,
        });
      }

      // Validate coupon
      let coupon = null;
      if (appliedCouponCode) {
        coupon = await Coupon.findOne({
          couponCode: appliedCouponCode,
        }).session(session);
        if (!coupon) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(400)
            .json({ success: false, error: "Invalid or expired coupon code" });
        }
        const userDoc = await User.findById(user._id).session(session);
        if (userDoc.usedCoupons && userDoc.usedCoupons.includes(coupon._id)) {
          await session.abortTransaction();
          session.endSession();
          return res
            .status(400)
            .json({ success: false, error: "Coupon already used" });
        }
      }

      const totalAmount = cart.newTotal || cart.total;

      // Create order
      const orderItems = cart.items.map((item) => ({
        product: item.product._id,
        quantity: item.quantity,
        price: item.price,
        size: item.size,
      }));

      const order = new Order({
        user: user._id,
        items: orderItems,
        totalAmount: totalAmount,
        shippingAddress: selectedAddress,
        paymentMethod,
        couponCode: appliedCouponCode || null,
        discountAmount: cart.couponApplied ? cart.total - cart.newTotal : 0,
        paymentStatus: "Completed",
      });

      await order.save({ session });

      // Update stock for each variant
      for (const item of cart.items) {
        const product = await Product.findOne({
          _id: item.product._id,
          version: { $exists: true },
        }).session(session);
        const variant = product.variants.find((v) => v.size === item.size);
        variant.stock -= item.quantity;
        variant.reserved = (variant.reserved || 0) - item.quantity;
        product.reserved = (product.reserved || 0) - item.quantity;
        product.version += 1;
        await product.save({ session });
      }

      // Add coupon to usedCoupons
      if (coupon) {
        const userDoc = await User.findById(user._id).session(session);
        if (!userDoc.usedCoupons) {
          userDoc.usedCoupons = [];
        }
        userDoc.usedCoupons.push(coupon._id);
        await userDoc.save({ session });
      }

      // Clear cart and session data
      cart.items = [];
      cart.total = 0;
      cart.newTotal = 0;
      cart.couponApplied = null;
      await cart.save({ session });

      req.session.couponCode = null;
      req.session.discount = 0;
      req.session.totalpay = 0;

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: "Payment processed successfully" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error processing payment:", error);

      // Release reservations on failure
      const cart = await Cart.findOne({ user: req.session.user }).populate(
        "items.product"
      );
      if (cart) {
        for (const item of cart.items) {
          const product = await Product.findOne({ _id: item.product._id });
          if (product) {
            const variant = product.variants.find((v) => v.size === item.size);
            if (variant) {
              variant.reserved = (variant.reserved || 0) - item.quantity;
              product.reserved = (product.reserved || 0) - item.quantity;
              product.version += 1;
              await product.save();
            }
          }
        }
        await cart.save();
      }

      res.status(500).json({
        success: false,
        error: error.message || "Failed to process payment",
      });
    }
  },

  placeorder: async (req, res) => {
    try {
      const { paymentMethod, selectedAddress, appliedCouponCode } = req.body;
      const user = req.session.user;

      console.log("Place order request:", {
        paymentMethod,
        selectedAddress,
        appliedCouponCode,
        userId: user?._id,
      });

      if (!user) {
        return res.redirect("/login");
      }

      if (!selectedAddress) {
        console.log("No address selected");
        return res.status(400).json({
          success: false,
          error: "Please select a shipping address",
        });
      }

      if (!paymentMethod) {
        console.log("No payment method selected");
        return res.status(400).json({
          success: false,
          error: "Please select a payment method",
        });
      }

      // Start main transaction
      const mainSession = await mongoose.startSession();
      mainSession.startTransaction();

      try {
        // Get cart with populated products
        const cart = await Cart.findOne({ user: user._id })
          .populate("items.product")
          .session(mainSession);

        if (!cart || !cart.items || cart.items.length === 0) {
          await mainSession.abortTransaction();
          mainSession.endSession();
          console.log("Cart is empty");
          return res.status(400).json({
            success: false,
            error: "Cart is empty",
          });
        }

        console.log("Cart found with items:", cart.items.length);

        // Validate stock for each item
        const unavailableItems = [];

        for (const item of cart.items) {
          const product = await Product.findOne({
            _id: item.product._id,
            version: { $exists: true },
          }).session(mainSession);

          if (!product) {
            unavailableItems.push({
              productId: item.product._id,
              name: item.product.name,
              size: item.size,
              reason: "Product not found",
            });
            continue;
          }

          const variant = product.variants.find((v) => v.size === item.size);
          if (!variant) {
            unavailableItems.push({
              productId: item.product._id,
              name: item.product.name,
              size: item.size,
              reason: `Size ${item.size} not available`,
            });
            continue;
          }

          const availableStock = variant.stock - (variant.reserved || 0);
          if (availableStock < item.quantity) {
            unavailableItems.push({
              productId: item.product._id,
              name: item.product.name,
              size: item.size,
              reason: `Only ${availableStock} item${
                availableStock !== 1 ? "s" : ""
              } available for size ${item.size}`,
            });
            continue;
          }
          if (item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)) {
            unavailableItems.push({
              productId: item.product._id,
              name: item.product.name,
              size: item.size,
              reason: `Reservation expired for size ${item.size}`,
            });

            variant.reserved = Math.max(
              0,
              (variant.reserved || 0) - item.quantity
            );
            product.reserved = Math.max(
              0,
              (product.reserved || 0) - item.quantity
            );
            product.version += 1;
            await product.save({ session: mainSession });

            cart.items = cart.items.filter(
              (i) =>
                !(
                  i.product._id.toString() === item.product._id.toString() &&
                  i.size === item.size
                )
            );
          }
        }

        if (unavailableItems.length > 0) {
          await cart.save({ session: mainSession });
          await mainSession.commitTransaction();
          mainSession.endSession();

          console.log("Stock validation failed:", unavailableItems);
          return res.status(400).json({
            success: false,
            error: "Some items are unavailable",
            unavailableItems,
          });
        }
        cart.items.forEach((item) => {
          item.reservedAt = new Date();
        });
        await cart.save({ session: mainSession });

        console.log("Stock validation passed");

        const addressExists = await Address.findById(selectedAddress).session(
          mainSession
        );
        if (!addressExists) {
          await mainSession.abortTransaction();
          mainSession.endSession();
          console.log("Address not found");
          return res.status(400).json({
            success: false,
            error: "Invalid address selected",
          });
        }

        const productOffers = await ProductOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(mainSession);

        const categoryOffers = await CategoryOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }).session(mainSession);

        const cartTotal = await calculateTotalPrice(
          cart.items,
          productOffers,
          categoryOffers
        );
        let finalTotal = cart.newTotal || cartTotal;
        let couponDiscount = cart.couponApplied
          ? cart.total - cart.newTotal
          : 0;

        // Validate coupon if applied
        if (appliedCouponCode && cart.couponApplied === appliedCouponCode) {
          const coupon = await Coupon.findOne({
            couponCode: appliedCouponCode,
            expiryDate: { $gte: new Date() },
          }).session(mainSession);

          if (coupon) {
            const userDoc = await User.findById(user._id).session(mainSession);
            if (
              userDoc.usedCoupons &&
              userDoc.usedCoupons.includes(coupon._id)
            ) {
              await mainSession.abortTransaction();
              mainSession.endSession();
              console.log("Coupon already used:", appliedCouponCode);
              return res.status(400).json({
                success: false,
                error: "Coupon already used",
              });
            }

            if (cartTotal >= coupon.minimumPurchaseAmount) {
              couponDiscount = Math.min(
                (cartTotal * coupon.discountRate) / 100,
                coupon.maxDiscountAmount || Infinity
              );
              finalTotal = cartTotal - couponDiscount;
              console.log("Coupon applied:", {
                couponCode: appliedCouponCode,
                discount: couponDiscount,
                finalTotal,
              });
            } else {
              console.log(
                "Coupon minimum purchase not met:",
                appliedCouponCode
              );
              couponDiscount = 0;
              finalTotal = cartTotal;
              cart.couponApplied = null;
              cart.newTotal = cartTotal;
              await cart.save({ session: mainSession });
            }
          } else {
            console.log("Coupon not found or expired:", appliedCouponCode);
            couponDiscount = 0;
            finalTotal = cartTotal;
            cart.couponApplied = null;
            cart.newTotal = cartTotal;
            await cart.save({ session: mainSession });
          }
        } else if (appliedCouponCode) {
          console.log(
            "Mismatch between appliedCouponCode and cart.couponApplied:",
            {
              appliedCouponCode,
              cartCouponApplied: cart.couponApplied,
            }
          );
          couponDiscount = 0;
          finalTotal = cartTotal;
          cart.couponApplied = null;
          cart.newTotal = cartTotal;
          await cart.save({ session: mainSession });
        }

        if (paymentMethod === "WALLET") {
          const userDoc = await User.findById(user._id).session(mainSession);
          if (!userDoc || userDoc.walletBalance < finalTotal) {
            await mainSession.abortTransaction();
            mainSession.endSession();
            console.log("Insufficient wallet balance:", {
              required: finalTotal,
              available: userDoc?.walletBalance || 0,
            });
            return res.status(400).json({
              success: false,
              error: "Insufficient wallet balance",
            });
          }
        }

        if (paymentMethod === "CASH_ON_DELIVERY" && finalTotal > 1000) {
          await mainSession.abortTransaction();
          mainSession.endSession();
          console.log("COD not available for amount:", finalTotal);
          return res.status(400).json({
            success: false,
            error: "Cash on Delivery is not available for orders above ₹1000",
          });
        }

        const newOrder = new Order({
          user: user._id,
          items: cart.items.map((item) => ({
            product: item.product._id,
            quantity: item.quantity,
            price: item.price,
            size: item.size,
            itemstatus: "PENDING",
          })),
          shippingAddress: selectedAddress,
          totalAmount: finalTotal,
          discountAmount: couponDiscount,
          couponCode: cart.couponApplied || null,
          paymentMethod,
          orderStatus: "PENDING",
          orderdate: new Date(),
          transactiontype:
            paymentMethod === "CASH_ON_DELIVERY" ? "COD" : paymentMethod,
        });

        await newOrder.save({ session: mainSession });
        console.log("Order created:", {
          orderId: newOrder._id,
          totalAmount: newOrder.totalAmount,
          discountAmount: newOrder.discountAmount,
          couponCode: newOrder.couponCode,
        });

        if (cart.couponApplied) {
          const coupon = await Coupon.findOne({
            couponCode: cart.couponApplied,
          }).session(mainSession);
          if (coupon) {
            const userDoc = await User.findById(user._id).session(mainSession);
            if (!userDoc.usedCoupons) {
              userDoc.usedCoupons = [];
            }
            userDoc.usedCoupons.push(coupon._id);
            await userDoc.save({ session: mainSession });
          }
        }

        // Process payment based on method
        if (paymentMethod === "WALLET") {
          let userWallet = await Wallet.findOne({ user: user._id }).session(
            mainSession
          );

          // Ensure wallet exists and has walletTransactions array
          if (!userWallet) {
            userWallet = new Wallet({
              user: user._id,
              balance: 0,
              walletTransactions: [],
            });
          }
          if (!userWallet.walletTransactions) {
            userWallet.walletTransactions = [];
          }

          userWallet.balance -= finalTotal;
          userWallet.walletTransactions.push({
            type: "debit",
            amount: finalTotal,
            description: `Order payment - Order ${newOrder.orderId}`,
            date: new Date(),
            orderId: newOrder._id,
          });
          await userWallet.save({ session: mainSession });

          newOrder.orderStatus = "PROCESSING";
          await newOrder.save({ session: mainSession });
          console.log("Wallet payment processed:", finalTotal);
        } else if (paymentMethod === "CASH_ON_DELIVERY") {
          newOrder.orderStatus = "PROCESSING";
          await newOrder.save({ session: mainSession });
          console.log("COD order confirmed");
        }

        // Update product stock
        for (const item of cart.items) {
          const product = await Product.findById(item.product._id).session(
            mainSession
          );
          if (product) {
            const variant = product.variants.find((v) => v.size === item.size);
            if (variant) {
              variant.stock = Math.max(0, variant.stock - item.quantity);
              variant.reserved = Math.max(
                0,
                (variant.reserved || 0) - item.quantity
              );
              product.reserved = Math.max(
                0,
                (product.reserved || 0) - item.quantity
              );
              product.version += 1;
              await product.save({ session: mainSession });
              console.log(
                `Stock updated for ${product.name} size ${item.size}:`,
                {
                  newStock: variant.stock,
                  reserved: variant.reserved,
                }
              );
            }
          }
        }

        // Clear cart
        await Cart.findOneAndUpdate(
          { user: user._id },
          {
            $set: {
              items: [],
              total: 0,
              newTotal: 0,
              couponApplied: null,
            },
          },
          { session: mainSession }
        );

        // Clear session coupon data
        if (req.session.couponCode) {
          delete req.session.couponCode;
        }
        req.session.discount = 0;
        req.session.totalpay = 0;

        await mainSession.commitTransaction();
        mainSession.endSession();

        console.log("Order placed successfully:", newOrder._id);

        req.session.lastOrderId = newOrder._id;

        if (req.xhr || req.headers.accept.indexOf("json") > -1) {
          return res.json({
            success: true,
            message: "Order placed successfully",
            orderId: newOrder._id,
            orderNumber: newOrder.orderId,
            redirectUrl: "/successpage",
          });
        } else {
          return res.redirect("/successpage");
        }
      } catch (error) {
        await mainSession.abortTransaction();
        mainSession.endSession();
        console.error("Error in order processing transaction:", {
          error: error.message,
          stack: error.stack,
        });
        throw error;
      }
    } catch (error) {
      console.error("Error in placeorder:", {
        error: error.message,
        stack: error.stack,
        paymentMethod: req.body?.paymentMethod,
        selectedAddress: req.body?.selectedAddress,
      });

      if (req.xhr || req.headers.accept.indexOf("json") > -1) {
        return res.status(400).json({
          success: false,
          error:
            error.message ||
            "An error occurred while placing your order. Please try again.",
        });
      } else {
        return res.status(500).render("userviews/error", {
          error:
            error.message ||
            "An error occurred while placing your order. Please try again.",
        });
      }
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

      if (order.orderStatus !== "CANCELLED") {
        // Calculate subtotal of non-cancelled items
        const subtotal = order.items.reduce((sum, item) => {
          if (item.itemstatus !== "CANCELLED") {
            return sum + item.price * item.quantity;
          }
          return sum;
        }, 0);

        // Calculate effective total (subtotal minus coupon discount)
        let effectiveTotal = subtotal;
        if (order.couponCode && order.discountAmount > 0 && subtotal > 0) {
          effectiveTotal -= order.discountAmount;
        }

        // Calculate remaining amount to refund
        const remainingRefund = Math.max(
          0,
          effectiveTotal - (order.refundedAmount || 0)
        );

        // Restock all non-cancelled items
        await Promise.all(
          order.items.map(async (item) => {
            if (item.itemstatus !== "CANCELLED") {
              item.itemstatus = "CANCELLED";
              item.cancellationReason = cancellationReason || "Order cancelled";
              const product = await Product.findById(item.product._id).session(
                session
              );
              if (product && Array.isArray(product.variants)) {
                const variant = product.variants.find(
                  (v) => v.size === item.size
                );
                if (variant) {
                  variant.stock += item.quantity;
                } else {
                  console.warn(
                    `Variant not found for size ${item.size} in product ${product._id}`
                  );
                }
                product.version += 1;
                await product.save({ session });
              }
            }
          })
        );

        if (
          remainingRefund > 0 &&
          (order.paymentMethod === "RAZORPAY" ||
            order.paymentMethod === "WALLET")
        ) {
          let userWallet = await Wallet.findOne({ user: order.user }).session(
            session
          );

          // Ensure wallet exists and has walletTransactions array
          if (!userWallet) {
            userWallet = new Wallet({ user: order.user });
            await userWallet.save({ session });
          }
          if (!userWallet.walletTransactions) {
            userWallet.walletTransactions = [];
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
        return res.json({ message: "Order cancelled successfully" });
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Order is already cancelled" });
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in confirmcancellation:", error);
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

        if (item.product && item.product.price) {
          const cancelledItemTotal = item.product.price * item.quantity;

          // Restock the product
          const product = await Product.findById(item.product._id).session(
            session
          );
          if (product && Array.isArray(product.variants)) {
            const variant = product.variants.find((v) => v.size === item.size);
            if (variant) {
              variant.stock += item.quantity;
            } else {
              console.warn(
                `Variant not found for size ${item.size} in product ${product._id}`
              );
            }
            product.version += 1;
            await product.save({ session });
          }

          if (
            order.paymentMethod === "RAZORPAY" ||
            order.paymentMethod === "WALLET"
          ) {
            let userWallet = await Wallet.findOne({
              user: order.user,
            }).session(session);

            // Ensure wallet exists and has walletTransactions array
            if (!userWallet) {
              userWallet = new Wallet({ user: order.user });
              await userWallet.save({ session });
            }
            if (!userWallet.walletTransactions) {
              userWallet.walletTransactions = [];
            }

            userWallet.balance += cancelledItemTotal;
            userWallet.walletTransactions.push({
              type: "credit", // lowercase to match enum
              amount: cancelledItemTotal,
              description: `Refund for cancelled item in Order ${order.orderId}`,
              date: new Date(),
              orderId: order._id,
            });
            await userWallet.save({ session });

            order.refundedAmount =
              (order.refundedAmount || 0) + cancelledItemTotal;
            order.transactiontype = "CREDIT";
          }

          // Check if all items are cancelled
          const allItemsCancelled = order.items.every(
            (item) => item.itemstatus === "CANCELLED"
          );
          if (allItemsCancelled) {
            order.orderStatus = "CANCELLED";
            order.cancellationReason =
              itemCancellationReason || "All items cancelled";
            await order.save({ session });
          }

          await order.save({ session });

          await session.commitTransaction();
          session.endSession();
          return res.json({ message: "Item cancelled successfully" });
        } else {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ error: "Product price is undefined" });
        }
      } else {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Item is already cancelled" });
      }
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in confirmItemCancellation:", error);
      res.status(500).json({ error: "Internal server error" });
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

      // Helper function to add horizontal line
      const addHorizontalLine = (y, startX = 50, endX = 550) => {
        doc.moveTo(startX, y).lineTo(endX, y).stroke();
      };

      // Header Section
      doc
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("INVOICE", { align: "center" })
        .moveDown(0.5);

      // Company/Store Details
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
