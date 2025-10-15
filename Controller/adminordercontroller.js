const bodyParser = require("body-parser");
const express = require("express");
const app = express();
app.use(bodyParser.json());
const Order = require("../models/orderSchema");
const Wallet = require("../models/wallet");
const mongoose = require("mongoose");

module.exports = {
  orderspage: async (req, res) => {
    try {
      const pageSize = 10;
      let currentPage = parseInt(req.query.page) || 1;
      const totalOrdersCount = await Order.countDocuments();
      const totalPages = Math.ceil(totalOrdersCount / pageSize);
      currentPage = Math.min(Math.max(currentPage, 1), totalPages);
      const skip = (currentPage - 1) * pageSize;
      const orders = await Order.find()
        .populate("user", "userId")
        .sort({ orderdate: -1 })
        .limit(pageSize)
        .skip(skip);
      res.render("adminviews/orders", {
        title: "Orders",
        orders,
        pageSize,
        currentPage,
        totalPages,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  adminvieworder: async (req, res) => {
    try {
      const order = await Order.findById(req.params.id)
        .populate("items.product")
        .populate("shippingAddress");

      res.render("adminviews/vieworder", { title: "View order", order });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  //update order status
  updateorderstatus: async (req, res) => {
    const orderId = req.params.orderId;
    const newOrderStatus = req.body.orderStatus;
    try {
      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        { orderStatus: newOrderStatus },
        { new: true }
      );
      res.json(updatedOrder);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  //get return requests page
  getreturnrequestspage: async (req, res) => {
    try {
      const returnRequests = await Order.find({
        orderStatus: "RETURN REQUESTED",
      }).populate("user", "items returnReason");
      console.log(returnRequests, "kkkkkk");
      res.render("adminviews/returnrequests", {
        title: "Return requests",
        returnRequests: returnRequests,
      });
    } catch (error) {
      console.error("Error fetching return requests:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  //  route to accept a return request
  acceptreturn: async (req, res) => {
    const orderId = req.params.orderId;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId)
        .populate("items.product")
        .populate("user")
        .session(session);

      if (!order) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.orderStatus !== "RETURN REQUESTED") {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ message: "Order is not in return requested status" });
      }

      // Calculate refund amount based on non-cancelled items
      const refundableItems = order.items.filter(
        (item) => item.itemstatus !== "CANCELLED"
      );
      if (refundableItems.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ message: "No refundable items in this order" });
      }

      const refundAmount = refundableItems.reduce((sum, item) => {
        if (!item.product) {
          console.warn(
            `Product missing for item in order ${orderId}, item:`,
            item
          );
          return sum;
        }
        if (!item.price || !item.quantity) {
          console.warn(
            `Price or quantity missing for item in order ${orderId}, item:`,
            item
          );
          return sum;
        }
        return sum + item.price * item.quantity;
      }, 0);

      // Log refund calculation details
      console.log("Refund calculation for order", orderId, {
        refundableItems: refundableItems.map((item) => ({
          productId: item.product?._id?.toString(),
          name: item.product?.name || "Unknown",
          size: item.size,
          price: item.price,
          quantity: item.quantity,
          itemstatus: item.itemstatus,
        })),
        refundAmount,
        existingRefundedAmount: order.refundedAmount,
      });

      // Allow refund if there are non-cancelled items, even if remainingRefund is 0
      const remainingRefund = Math.max(
        0,
        refundAmount - (order.refundedAmount || 0)
      );
      if (remainingRefund === 0 && refundableItems.length > 0) {
        console.warn(
          `Proceeding with return for order ${orderId} despite zero remaining refund, as non-cancelled items exist`
        );
      } else if (remainingRefund === 0) {
        await session.abortTransaction();
        session.endSession();
        return res
          .status(400)
          .json({ message: "No refundable amount remaining for this order" });
      }

      // Aggregate quantities by product to avoid multiple saves
      const productUpdates = refundableItems.reduce((acc, item) => {
        const productId = item.product?._id?.toString();
        if (productId && item.product) {
          if (!acc[productId]) {
            acc[productId] = {
              product: item.product,
              quantity: 0,
              size: item.size,
            };
          }
          acc[productId].quantity += item.quantity;
        }
        return acc;
      }, {});

      // Update product stock for non-cancelled items
      await Promise.all(
        Object.values(productUpdates).map(
          async ({ product, quantity, size }) => {
            if (product) {
              const variant = product.variants.find((v) => v.size === size);
              if (variant) {
                variant.stock += quantity;
                product.version = (product.version || 0) + 1;
                await product.save({ session });
              } else {
                console.warn(
                  `Variant for size ${size} not found for product ${product._id} in order ${orderId}`
                );
              }
            }
          }
        )
      );

      // Update order status and refunded amount
      order.orderStatus = "RETURNED";
      order.transactiontype = "CREDIT BY RETURN";
      order.refundedAmount = (order.refundedAmount || 0) + refundAmount; // Refund full amount of non-cancelled items
      await order.save({ session });

      // Update wallet
      let userWallet = await Wallet.findOne({ user: order.user }).session(
        session
      );
      if (!userWallet) {
        userWallet = new Wallet({
          user: order.user._id,
          balance: 0,
          walletTransactions: [],
        });
      }

      userWallet.balance += refundAmount; // Refund full non-cancelled amount
      userWallet.walletTransactions.push({
        type: "credit",
        amount: refundAmount,
        description: `Refund for returned Order ${order.orderId}`,
        date: new Date(),
        orderId: order._id,
      });
      await userWallet.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.log("Order returned successfully:", {
        orderId,
        refundAmount,
        userId: order.user._id,
      });

      res.json({ message: "Order returned successfully", refundAmount });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error accepting return request:", {
        error: error.message,
        stack: error.stack,
        orderId,
      });
      res
        .status(500)
        .json({ message: "Internal Server Error: " + error.message });
    }
  },

  // route to reject a return request
  rejectreturn: async (req, res) => {
    const orderId = req.params.orderId;
    try {
      await Order.findByIdAndUpdate(orderId, {
        orderStatus: "RETURN REJECTED",
      });
      console.log("rejected ", orderId);
      res.sendStatus(200);
    } catch (error) {
      console.error("Error rejecting return request:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
};
