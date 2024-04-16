const bodyParser = require('body-parser')
const express = require('express')
const app = express()
app.use(bodyParser.json())
const Order = require('../models/orderSchema')
const User = require('../models/user')
const Product = require('../models/product')
const Address = require('../models/address')
const ejs = require('ejs')
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const Category = require('../models/category')


module.exports = {

  //to admin login page
  toadminlogin: async (req, res) => {
    res.render('adminviews/adminlogin', {
      title: 'Homepage'
    });
  },

  //to login the admin
  adminlogin: async (req, res) => {
    const credential = {
      email: 'admin@gmail.com',
      password: '1'
    }
    if (
      req.body.email == credential.email &&
      req.body.password == credential.password
    ) {
      req.session.isadminlogged = true
      const totalUsers = await User.countDocuments();
      const totalOrders = await Order.countDocuments()
      const totalProductQuantity = await Order.aggregate([
        {
          $unwind: "$items",
        },
        {
          $group: {
            _id: null,
            totalProductQuantity: { $sum: "$items.quantity" },
          },
        },
      ]).exec();
      const productQuantity =
        totalProductQuantity.length > 0
          ? totalProductQuantity[0].totalProductQuantity
          : 0;

      const topSellingProducts = await Order.aggregate([
        { $unwind: '$items' },
        { $group: { _id: '$items.product', sales: { $sum: '$items.quantity' } } },
        { $sort: { sales: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $project: { name: '$product.name', sales: 1 } }
      ]);

      const topSellingCategories = await Order.aggregate([
        { $unwind: '$items' },
        { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $group: { _id: '$product.category', sales: { $sum: '$items.quantity' } } },
        { $sort: { sales: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
        { $unwind: '$category' },
        { $project: { name: '$category.name', sales: 1 } }
      ]);

      res.render('adminviews/dashboard', {
        title: 'Dashboard',
        totalOrders: totalOrders,
        productQuantity: productQuantity,
        totalUsers: totalUsers,
        topSellingProducts: topSellingProducts,
        topSellingCategories: topSellingCategories
      });
    }
    else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  },

  //get dashboard
  dashboard: async (req, res) => {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments()
    const totalProductQuantity = await Order.aggregate([
      {
        $unwind: "$items",
      },
      {
        $group: {
          _id: null,
          totalProductQuantity: { $sum: "$items.quantity" },
        },
      },
    ]).exec();
    const productQuantity =
      totalProductQuantity.length > 0
        ? totalProductQuantity[0].totalProductQuantity
        : 0;

    const topSellingProducts = await Order.aggregate([
      { $unwind: '$items' },
      { $group: { _id: '$items.product', sales: { $sum: '$items.quantity' } } },
      { $sort: { sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $project: { name: '$product.name', sales: 1 } }
    ]);

    const topSellingCategories = await Order.aggregate([
      { $unwind: '$items' },
      { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $group: { _id: '$product.category', sales: { $sum: '$items.quantity' } } },
      { $sort: { sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
      { $unwind: '$category' },
      { $project: { name: '$category.name', sales: 1 } }
    ]);


    res.render('adminviews/dashboard', {
      title: 'Dashboard',
      totalOrders: totalOrders,
      productQuantity: productQuantity,
      totalUsers: totalUsers,
      topSellingProducts: topSellingProducts,
      topSellingCategories: topSellingCategories
    });
  },


  //admin logout
  adminlogout: async (req, res) => {

    console.log('Accessed /adminlogout');
    req.session.isadminlogged = false

    req.session.destroy(err => {
      if (err) {
        console.error('Error destroying session:', err);
        res.status(500).send('Internal Server Error');
      } else {
        res.redirect('/adminlogin')
      }
    })
  },


  //generate sales report
  generatesalesreport: async (req, res) => {
    const { fromDate, toDate, interval } = req.query;
    let query = {};

    if (fromDate && toDate) {
      query.orderdate = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }

    const orders = await Order.find(query);

    let salesData = {};

    switch (interval) {
      case 'daily':
        orders.forEach(order => {
          const date = order.orderdate.toISOString().split('T')[0];
          if (!salesData[date]) salesData[date] = 0;
          salesData[date] += order.totalAmount;
        });
        break;

      case 'monthly':
        orders.forEach(order => {
          const yearMonth = order.orderdate.toISOString().slice(0, 7);
          if (!salesData[yearMonth]) salesData[yearMonth] = 0;
          salesData[yearMonth] += order.totalAmount;
        });

        const firstOrderDate = orders.length > 0 ? orders[0].orderdate : new Date();
        const lastOrderDate = orders.length > 0 ? orders[orders.length - 1].orderdate : new Date();

        const startDate = new Date(firstOrderDate.getFullYear(), firstOrderDate.getMonth(), 1);
        const endDate = new Date(lastOrderDate.getFullYear(), lastOrderDate.getMonth() + 1, 0);

        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          const yearMonth = currentDate.toISOString().slice(0, 7);
          if (!salesData[yearMonth]) salesData[yearMonth] = 0;
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
        break;

      case 'yearly':
        orders.forEach(order => {
          const year = order.orderdate.getFullYear().toString();
          if (!salesData[year]) salesData[year] = 0;
          salesData[year] += order.totalAmount;
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid interval' });
    }

    res.json(salesData);
  },


  //generate sales report pdf
  generatepdf: async (req, res) => {
    try {
      const { fromDate, toDate, interval } = req.query;
  
      const orders = await Order.find({ orderdate: { $gte: fromDate, $lte: toDate } })
        .populate('user')
        .populate('items.product');
  
      const overallSalesCount = orders.length;
      const overallOrderAmount = orders.reduce((total, order) => total + order.totalAmount, 0);
  
      const htmlContent = await ejs.renderFile(
        path.join(__dirname, '..', 'views', 'adminviews', 'salesreport.ejs'),
        {
          orders,
          startDate: fromDate,
          endDate: toDate,
          overallSalesCount,
          overallOrderAmount
        }
      );
  
      const browser = await puppeteer.launch();
      const page = await browser.newPage();
  
      await page.setContent(htmlContent);
  
      const pdfBuffer = await page.pdf({ format: 'A4' });
  
      await browser.close();
  
      const fileName = `sales_report_${fromDate}_${toDate}.pdf`;
      res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
      res.setHeader('Content-type', 'application/pdf');
  
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).send('Internal Server Error');
    }
  },


}