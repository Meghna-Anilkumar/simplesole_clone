const bodyParser = require('body-parser')
const express = require('express')
const app = express()
app.use(bodyParser.json())
const Order = require('../models/orderSchema')
const Wallet = require('../models/wallet')

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

  //get return requests page
  getreturnrequestspage: async (req, res) => {
    try {
      const returnRequests = await Order.find({ orderStatus: 'RETURN REQUESTED' }).populate('user', 'items returnReason');
      console.log(returnRequests,'kkkkkk')
      // res.json(returnRequests);
      res.render('adminviews/returnrequests',{title:'Return requests', returnRequests: returnRequests })
    } catch (error) {
      console.error('Error fetching return requests:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }

  },

  //  route to accept a return request
  acceptreturn: async (req, res) => {
    const orderId = req.params.orderId;
    try {
        await Order.findByIdAndUpdate(orderId, { orderStatus: 'RETURNED' });

        // Get the order details
        const order = await Order.findById(orderId).populate('items.product').populate('user');

        // Update product quantities
        await Promise.all(order.items.map(async (item) => {
            const product = item.product;
            if (product) {
                product.stock += item.quantity;
                await product.save();
            }
        }));

        // Update user wallet balance
        const userWallet = await Wallet.findOne({ user: order.user });
        if (userWallet) {
            userWallet.balance += order.totalAmount;
            await userWallet.save();
        }

        // Update order transaction type
        order.transactiontype = 'CREDIT BY RETURN';
        await order.save();

        console.log('Order returned successfully:', orderId);
        res.json({ message: 'Order returned successfully' });
    } catch (error) {
        console.error('Error accepting return request:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
},


  // route to reject a return request
  rejectreturn:async(req,res)=>{
    const orderId = req.params.orderId;
    try {
        // Update the order status to reflect rejection
        await Order.findByIdAndUpdate(orderId, { orderStatus: 'RETURN REJECTED' });
        console.log('rejected ',orderId)
        res.sendStatus(200);
    } catch (error) {
        console.error('Error rejecting return request:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
  },





}