const Cart = require('../models/cartSchema')
const Category = require('../models/category')
const Product = require('../models/product')
const Address = require('../models/address')
const Order = require('../models/orderSchema')
const Razorpay = require('razorpay')
const Wallet = require('../models/wallet')
const crypto = require('crypto')
const User = require('../models/user')
require('dotenv').config()
const PDFDocument = require('pdfkit');
const Wishlist = require('../models/wishlist')
const placeOrderHelper=require('../utils/placeorderhelper')


//Razorpay instance
const instance = new Razorpay({
  key_id: process.env.key_id,
  key_secret: process.env.key_secret,
});

module.exports = {

placeorder: async (req, res) => {
    try {
      const { paymentMethod, appliedCouponCode, selectedAddress } = req.body;
      console.log('Received data:', req.body);
      const userId = req.session.user._id;
      req.session.coupon = appliedCouponCode;
      const user = await User.findById(userId);
      const cart = await Cart.findOne({ user: userId }).populate('items.product').exec();

      if (!cart || !cart.items.length) {
        const categories = await Category.find();
        const addresses = await Address.find({ user: userId });
        const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
        return res.render('userviews/checkout', {
          title: 'Checkout Page',
          wishlist,
          category: categories,
          cart,
          addresses,
          error: 'Cart is empty',
        });
      }

      if (!selectedAddress) {
        const categories = await Category.find();
        const addresses = await Address.find({ user: userId });
        const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
        return res.render('userviews/checkout', {
          title: 'Checkout Page',
          wishlist,
          category: categories,
          cart,
          addresses,
          error: 'Please select a shipping address',
        });
      }

      const address = await Address.findById(selectedAddress);
      if (!address) {
        const categories = await Category.find();
        const addresses = await Address.find({ user: userId });
        const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
        return res.render('userviews/checkout', {
          title: 'Checkout Page',
          wishlist,
          category: categories,
          cart,
          addresses,
          error: 'Invalid shipping address selected',
        });
      }

      // Prevent duplicate coupon entries
      if (appliedCouponCode && !user.usedCoupons.includes(appliedCouponCode)) {
        user.usedCoupons.push(appliedCouponCode);
        await user.save();
      }

      if (paymentMethod === 'CASH_ON_DELIVERY') {
        if (cart.total > 1000) {
          const categories = await Category.find();
          const addresses = await Address.find({ user: userId });
          const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
          return res.render('userviews/checkout', {
            title: 'Checkout Page',
            wishlist,
            category: categories,
            cart,
            addresses,
            error: 'Cash on Delivery not available for orders above ₹1000',
          });
        }

        await placeOrderHelper(user, selectedAddress, paymentMethod, cart, appliedCouponCode);
        return res.render('userviews/successpage');
      } else if (paymentMethod === 'WALLET') {
        const userWallet = await Wallet.findOne({ user: userId });
        const totalAmount = cart.newTotal || cart.total;
        if (!userWallet || userWallet.balance < totalAmount) {
          const categories = await Category.find();
          const addresses = await Address.find({ user: userId });
          const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
          return res.render('userviews/checkout', {
            title: 'Checkout Page',
            wishlist,
            category: categories,
            cart,
            addresses,
            error: 'Insufficient balance in the wallet',
          });
        }

        // Deduct wallet balance
        userWallet.balance -= totalAmount;
        await userWallet.save();

        await placeOrderHelper(user, selectedAddress, paymentMethod, cart, appliedCouponCode);
        return res.render('userviews/successpage');
      } else {
        return res.status(400).json({ error: 'Invalid payment method' });
      }
    } catch (error) {
      console.error('Error in placeorder:', error);
      const userId = req.session.user._id;
      const categories = await Category.find();
      const addresses = await Address.find({ user: userId });
      const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
      const cart = await Cart.findOne({ user: userId }).populate('items.product').exec();
      return res.render('userviews/checkout', {
        title: 'Checkout Page',
        wishlist,
        category: categories,
        cart,
        addresses,
        error: error.message || 'Internal server error',
      });
    }
  },


  // processPayment: async (req, res) => {
  //   try {
  //     const { paymentMethod} = req.body;
  //     const user = req.session.user
  //     const cart = await Cart.findOne({ user }).populate('items.product').exec();

  //     if (paymentMethod === 'RAZORPAY') {
  //       const amountInPaise = Math.round((cart.newTotal || cart.total) * 100);
  //       const razorpayOptions = {
  //         amount: amountInPaise,
  //         currency: 'INR',
  //         receipt: `order_rcpt_${Math.random().toString(36).substring(7)}`,
  //       };
  //       console.log('razorpay', razorpayOptions);

  //       instance.orders.create(razorpayOptions, async function (err, razorpayOrder) {
  //         if (err) {
  //           console.error(err);
  //           return res.status(500).json({ error: 'Razorpay order creation failed' });
  //         }
  //         console.log('Razorpay order created successfully')
  //         console.log(req.session.discount, 'kkkkkkkk')

  //         const newOrder = new Order({
  //           user: user,
  //           items: cart.items,
  //           totalAmount: cart.newTotal || cart.total,
  //           shippingAddress: req.body.selectedAddress,
  //           paymentMethod: 'RAZORPAY',
  //           paymentStatus: 'paid',
  //           razorpayOrderId: razorpayOrder.id,
  //           discountAmount: req.session.discount || 0,
  //           couponApplied: req.session.couponCode
  //         })

  //         await newOrder.save()
  //         cart.items = []
  //         cart.total = 0
  //         cart.newTotal=0
  //         await cart.save()

  //         await Cart.findOneAndDelete({ user: user });
  //         console.log('rendering successpage.........')

  //       })
  //     } else {

  //     }
  //   } catch (error) {
  //     console.error('Error processing payment:', error);

  //     res.status(500).json({ success: false, error: 'Internal Server Error' });
  //   }
  // },


  processPayment: async (req, res) => {
  try {
    const { payment_id, order_id, signature, paymentMethod, selectedAddress, appliedCouponCode } = req.body;
    const user = req.session.user;
    const cart = await Cart.findOne({ user }).populate('items.product').exec();

    if (paymentMethod === 'RAZORPAY') {
      // Verify Razorpay signature
      const hmac = crypto.createHmac('sha256', process.env.key_secret);
      hmac.update(order_id + '|' + payment_id);
      const generatedSignature = hmac.digest('hex');

      if (generatedSignature !== signature) {
        return res.status(400).json({ success: false, error: 'Invalid payment signature' });
      }

      const newOrder = new Order({
        user: user,
        items: cart.items,
        totalAmount: cart.newTotal || cart.total,
        shippingAddress: selectedAddress,
        paymentMethod: 'RAZORPAY',
        paymentStatus: 'paid',
        razorpayOrderId: order_id,
        razorpayPaymentId: payment_id,
        discountAmount: req.session.discount || 0,
        couponApplied: appliedCouponCode || req.session.couponCode,
      });

      await newOrder.save();

      // Clear the cart
      cart.items = [];
      cart.total = 0;
      cart.newTotal = 0;
      await cart.save();

      // Clear session coupon data
      req.session.couponCode = '';
      req.session.discount = 0;

      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: 'Invalid payment method' });
    }
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
},


  createRazorpayOrder: async (req, res) => {
    try {
      const { amount } = req.body;
      const razorpayOptions = {
        amount: amount,
        currency: 'INR',
        receipt: `order_rcpt_${Math.random().toString(36).substring(7)}`,
      };

      instance.orders.create(razorpayOptions, (err, razorpayOrder) => {
        if (err) {
          console.error('Error creating Razorpay order:', err);
          return res.status(500).json({ success: false, error: 'Razorpay order creation failed' });
        }

        res.json({ success: true, orderId: razorpayOrder.id });
      });
    } catch (error) {
      console.error('Error creating Razorpay order:', error);
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





