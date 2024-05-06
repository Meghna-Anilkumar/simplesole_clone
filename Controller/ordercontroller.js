const Cart = require('../models/cartSchema')
const Category = require('../models/category')
const isAuth = require('../middlewares/isAuth')
const Product = require('../models/product')
const Address = require('../models/address')
const Order = require('../models/orderSchema')
const Razorpay = require('razorpay')
const Wallet = require('../models/wallet')
const crypto = require('crypto')
const Coupon = require('../models/coupon')
const User = require('../models/user')
const easyinvoice = require('easyinvoice')
require('dotenv').config()
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ejs = require('ejs');
const Wishlist = require('../models/wishlist')
const puppeteer = require('puppeteer');


//Razorpay instance
const instance = new Razorpay({
  key_id: process.env.key_id,
  key_secret: process.env.key_secret,
});

module.exports = {

  placeorder: async (req, res) => {
    try {
      const { paymentMethod, appliedCouponCode } = req.body;
      console.log('Received data:', req.body);
      const userId = req.session.user._id;
      req.session.coupon=appliedCouponCode
      const user = await User.findById(userId)
      const cart = await Cart.findOne({ user }).populate('items.product').exec();

      console.log(appliedCouponCode, 'lllllllllll')

      console.log(user, 'pppppp')

      if (appliedCouponCode) {
        user.usedCoupons.push(appliedCouponCode);
        await user.save();
      }


      const newOrder = new Order({
        user: req.session.user,
        items: cart.items,
        shippingAddress: req.body.selectedAddress,
        totalAmount: cart.newTotal || cart.total,
        paymentMethod,
        discountAmount: req.session.discount || 0,
        couponApplied: req.body.appliedCouponCode
      });


      await Promise.all(
        cart.items.map(async (item) => {
          const product = await Product.findById(item.product._id);
          if (product) {
            product.stock -= item.quantity;
            await product.save();
          }
        })
      );

      if (paymentMethod === 'CASH_ON_DELIVERY') {
        await newOrder.save();
        cart.items = [];
        cart.total = 0;
        cart.newTotal=0
        await cart.save();
        return res.render('userviews/successpage');
      }

      else if (paymentMethod === 'WALLET') {
        const userWallet = await Wallet.findOne({ user });
        if (!userWallet || userWallet.balance < cart.total) {
          const userId = req.session.user._id;
          const user = await User.findById(userId)
          const order = await Order.find()
          const categories = await Category.find();
          const addresses = await Address.find({ user: user });
          const cart = await Cart.findOne({ user }).populate('items.product').exec();
          const wishlist = await Wishlist.findOne({ user }).populate('items.product');

          return res.render('userviews/checkout', { title: 'checkout page', wishlist, category: categories, cart, addresses: addresses, order, error: 'Insufficient balance in the wallet' });
        }

        console.log(appliedCouponCode, 'lllllllllll')

        console.log(user, 'pppppp')

        if (appliedCouponCode) {
          user.usedCoupons.push(appliedCouponCode);
          await user.save();
        }

        const newOrder = new Order({
          user: req.session.user,
          items: cart.items,
          shippingAddress: req.body.selectedAddress,
          totalAmount: cart.newTotal || cart.total,
          paymentMethod,
          discountAmount: req.session.discount || 0,
          couponApplied: req.body.appliedCouponCode,
          transactiontype: 'DEBIT'

        });

        await Promise.all(
          cart.items.map(async (item) => {
            const product = await Product.findById(item.product._id);
            if (product) {
              product.stock -= item.quantity;
              await product.save();
            }
          })
        );

        userWallet.balance -= cart.total;

        await userWallet.save()

        await newOrder.save()
        cart.items = []
        cart.total = 0
        cart.newTotal=0
        await cart.save()
        return res.render('userviews/successpage');
      }

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },


  processPayment: async (req, res) => {
    try {
      const { paymentMethod} = req.body;
      const user = req.session.user
      const cart = await Cart.findOne({ user }).populate('items.product').exec();

      if (paymentMethod === 'RAZORPAY') {
        const amountInPaise = Math.round(cart.newTotal || cart.total * 100);
        const razorpayOptions = {
          amount: amountInPaise,
          currency: 'INR',
          receipt: `order_rcpt_${Math.random().toString(36).substring(7)}`,
        };
        console.log('razorpay', razorpayOptions);

        instance.orders.create(razorpayOptions, async function (err, razorpayOrder) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Razorpay order creation failed' });
          }
          console.log('Razorpay order created successfully')
          console.log(req.session.discount, 'kkkkkkkk')

          const newOrder = new Order({
            user: user,
            items: cart.items,
            totalAmount: cart.newTotal || cart.total,
            shippingAddress: req.body.selectedAddress,
            paymentMethod: 'RAZORPAY',
            paymentStatus: 'paid',
            razorpayOrderId: razorpayOrder.id,
            discountAmount: req.session.discount || 0,
            couponApplied: req.session.couponCode
          })

          await newOrder.save()
          cart.items = []
          cart.total = 0
          cart.newTotal=0
          await cart.save()

          await Cart.findOneAndDelete({ user: user });
          console.log('rendering successpage.........')

        })
      } else {

      }
    } catch (error) {
      console.error('Error processing payment:', error);

      res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
  },


  // get my orders page
  myorders: async (req, res) => {
    try {
      const user = req.session.user;
      const page = parseInt(req.query.page) || 1; // Current page number
      const limit = parseInt(req.query.limit) || 10; // Number of orders per page

      const skip = (page - 1) * limit; // Number of orders to skip

      const ordersPromise = Order.find({ user })
        .populate('items.product')
        .sort({ orderdate: -1 }) // Sort by order date descending
        .skip(skip)
        .limit(limit)
        .exec();

      const totalOrdersPromise = Order.countDocuments({ user }).exec();

      const [orders, totalOrders] = await Promise.all([ordersPromise, totalOrdersPromise]);

      const totalPages = Math.ceil(totalOrders / limit);

      // Other data fetching logic (categories, wishlist, cart) can remain the same
      const categories = await Category.find()
      const wishlist = await Wishlist.find(user)
      const cart = await Cart.find(user)

      res.render('userviews/myorders', {
        title: 'My Orders',
        orders,
        category: categories, // Assuming categories are fetched elsewhere
        wishlist,
        cart,
        currentPage: page,
        totalPages: totalPages,
        limit: limit,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },


  //orderdetails
  orderdetails: async (req, res) => {
    try {
      const user = req.session.user;
      const orderId = req.params.orderId;

      console.log("Order ID:", orderId);

      const order = await Order.findById(orderId).populate('items.product').populate('shippingAddress').exec();
      const wishlist = await Wishlist.findOne({ user: user }).populate('items.product');
      const cart = await Cart.findOne({ user: user }).populate('items.product').exec()

      if (!order) {
        console.log("Order not found")
        return res.status(404).json({ error: 'Order not found' })
      }

      const categories = await Category.find();
      res.render('userviews/orderdetails', { title: 'My Orders', order, category: categories, wishlist, cart })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'Internal Server Error' })
    }
  },

  // order cancellation
  confirmcancellation: async (req, res) => {
    const { orderId } = req.params;
    const { cancellationReason } = req.body;
    console.log('Received cancellation request for order:', orderId);
    try {
      console.log('Attempting to find order in the database');
      const order = await Order.findById(orderId);

      if (!order) {
        console.log('Order not found');
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.orderStatus !== 'CANCELLED') {
        await Promise.all(order.items.map(async (item) => {
          const product = await Product.findById(item.product._id);
          if (product) {
            product.stock += item.quantity;
            await product.save();
          }
        }));

        console.log(order.paymentMethod, 'tttttttttt')

        if (order.paymentMethod === 'Online Payment' || order.paymentMethod === 'WALLET' || order.paymentMethod === 'RAZORPAY') {

          const userWallet = await Wallet.findOne({ user: order.user });
          if (userWallet) {
            userWallet.balance += order.totalAmount;
            // transactiontype = 'CREDIT'
            await userWallet.save();
          }
          order.transactiontype = 'CREDIT'
        }

        order.orderStatus = 'CANCELLED';
        order.cancellationReason = cancellationReason || '';
        await order.save();

        return res.json({ message: 'Order cancelled successfully' });
      } else {
        return res.status(400).json({ error: 'Order is already cancelled' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  confirmItemCancellation: async (req, res) => {
    const { orderId, index } = req.params;
    const { itemCancellationReason } = req.body;

    try {
      const order = await Order.findById(orderId).populate('items.product');

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const itemIndex = parseInt(index, 10);
      const item = order.items[itemIndex];

      if (!item) {
        return res.status(404).json({ error: 'Item not found in the order' });
      }

      if (item.itemstatus !== 'CANCELLED') {
        item.itemstatus = 'CANCELLED';
        item.cancellationReason = itemCancellationReason;

        if (item.product && item.product.price) {
          const cancelledItemTotal = item.product.price * item.quantity;
          order.totalAmount -= cancelledItemTotal;

          if (order.paymentMethod === 'RAZORPAY' || order.paymentMethod === 'WALLET') {
            const userWallet = await Wallet.findOne({ user: order.user });
            if (userWallet) {
              userWallet.balance += cancelledItemTotal;
              await userWallet.save();
            }
            order.transactiontype = 'CREDIT'
          }
        } else {
          return res.status(500).json({ error: 'Product price is undefined' });
        }

        await order.save();

        const allItemsCancelled = order.items.every(item => item.itemstatus === 'CANCELLED');

        if (allItemsCancelled) {
          order.orderStatus = 'CANCELLED';
          order.cancellationReason = itemCancellationReason || '';
          await order.save();
        }

        return res.json({ message: 'Item cancelled successfully' });
      } else {
        return res.status(400).json({ error: 'Item is already cancelled' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  //successpage
  getsuccesspage: async (req, res) => {
    res.render('userviews/successpage')
  },

  //get wallet page
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

      const walletHistory = await Order.find({ user: user }).sort({ orderdate: -1 });

      const wishlist = await Wishlist.findOne({ user: user }).populate('items.product');
      const cart = await Cart.findOne({ user: user }).populate('items.product').exec();

      return res.render('userviews/wallet', {
        title: 'Wallet',
        wallet,
        category,
        user,
        walletBalance,
        orders: walletHistory,
        wishlist,
        cart
      });
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
      return res.status(500).send('Internal Server Error');
    }
  },



  //return order
  returnorder: async (req, res) => {
    const { orderId } = req.params;
    const { returnReason } = req.body;
    console.log('Received return request for order:', orderId)
    try {
      console.log('Attempting to find order in the database')
      const order = await Order.findById(orderId);

      if (!order) {
        console.log('Order not found');
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.orderStatus === 'DELIVERED') {
        order.orderStatus = 'RETURN REQUESTED';
        order.returnReason = returnReason || '';
        await order.save();

      } else {
        return res.status(400).json({ error: 'Order cannot be returned because it is not delivered yet' })
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'Internal server error' })
    }
  },



  downloadinvoice: async (req, res) => {
    try {
      const orderId = req.params.orderId;
      const user = req.session.user;

      const order = await Order.findById(orderId).populate('items.product').populate('shippingAddress');
      if (!order) {
        return res.status(404).send('Order not found');
      }

      const doc = new PDFDocument({ margin: 25 });

      const fileName = `invoice_${orderId}.pdf`;
      res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
      res.setHeader('Content-type', 'application/pdf');

      doc.pipe(res);

      doc.fontSize(18).text(`Invoice for Order ID: ${order.orderId}`, { align: 'center' }).moveDown();
      doc.fontSize(12).text(`Status: ${order.orderStatus}`).moveDown();

      doc.font('Helvetica-Bold').text('Product', 100, 200).text('Quantity', 250, 200).text('Price', 350, 200).text('Total', 450, 200);


      let y = 230;
      order.items.forEach(item => {
        doc.font('Helvetica').text(item.product.name, 100, y)
          .text(item.quantity.toString(), 250, y)
          .text(`₹${item.product.price}`, 350, y)
          .text(`₹${order.totalAmount}`, 450, y);
        y += 20;
      });


      doc.text(`User Name: ${user.name}`).moveDown();
      doc.text(`Shipped Address: ${order.shippingAddress.buildingname}, ${order.shippingAddress.street}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.pincode}`).moveDown();
      doc.text(`Ordered Date: ${order.orderdate.toDateString()}`).moveDown();

      doc.text(`Subtotal: ₹${order.totalAmount}`).moveDown();

      doc.fontSize(16).text('Thank you for Shopping!', { align: 'center' }).moveDown();

      doc.end();

    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).send('Internal Server Error');
    }
  }

}





