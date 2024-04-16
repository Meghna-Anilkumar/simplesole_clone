const bodyParser = require('body-parser')
const express = require('express')
const app = express()
app.use(bodyParser.json())
const Order = require('../models/orderSchema')

module.exports = {

  orderspage: async (req, res) => {
    try {
      const pageSize = 10; // Define the page size here
      let currentPage = parseInt(req.query.page) || 1; // Get current page from query parameters, default to 1
      const totalOrdersCount = await Order.countDocuments();
      const totalPages = Math.ceil(totalOrdersCount / pageSize);
      currentPage = Math.min(Math.max(currentPage, 1), totalPages); // Ensure currentPage is within valid range
      const skip = (currentPage - 1) * pageSize;
      const orders = await Order.find().populate('user', 'userId').sort({ orderdate: -1 }).limit(pageSize).skip(skip);
      res.render('adminviews/orders', { title: 'Orders', orders, pageSize, currentPage, totalPages });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  adminvieworder: async (req, res) => {
    try {
      const order = await Order.findById(req.params.id).populate('items.product').populate('shippingAddress');

      res.render('adminviews/vieworder', { title: 'View order', order });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },


  //update order status
  updateorderstatus: async (req, res) => {
    const orderId = req.params.orderId;
    const newOrderStatus = req.body.orderStatus;
    try {
      const updatedOrder = await Order.findByIdAndUpdate(orderId, { orderStatus: newOrderStatus }, { new: true });
      res.json(updatedOrder);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }

  },





}