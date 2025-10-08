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

      order.orderStatus = "RETURNED";
      order.transactiontype = "CREDIT BY RETURN";
      await order.save({ session });

      await Promise.all(
        order.items.map(async (item) => {
          const product = item.product;
          if (product) {
            product.stock += item.quantity;
            product.version = (product.version || 0) + 1;
            await product.save({ session });
          }
        })
      );

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

      const refundAmount = order.totalAmount;

      userWallet.balance += refundAmount;

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

      res.json({ message: "Order returned successfully" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error accepting return request:", error);
      res.status(500).json({ message: "Internal Server Error" });
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
