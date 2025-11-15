const bodyParser = require("body-parser");
const express = require("express");
const app = express();
app.use(bodyParser.json());
const Order = require("../models/orderSchema");
const PDFDocument = require("pdfkit");
const { getDashboardData } = require("../utils/dashboardHelper");
require("dotenv").config();
const STATUS_CODES = require("../enums/statusCodes");
const Messages = require("../constants/messages");
const Admin = require("../models/adminSchema");
const bcrypt = require("bcrypt");

module.exports = {
  //to admin login page
  toadminlogin: async (req, res) => {
    res.render("adminviews/adminlogin", {
      title: "Homepage",
    });
  },

  //to login the admin
  adminlogin: async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log("Request body:", req.body);

      let admin = await Admin.findOne({ email: "admin@gmail.com" });

      if (!admin) {
        admin = await Admin.create({
          email: "admin@gmail.com",
          password: "Admin@2024",
        });
        console.log("Admin created");
      }

      if (email !== "admin@gmail.com") {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const isMatch = await bcrypt.compare(password, admin.password);
      console.log("Password match:", isMatch);

      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      req.session.isadminlogged = true;
      const dashboardData = await getDashboardData();

      return res.render("adminviews/dashboard", {
        title: "Dashboard",
        ...dashboardData,
      });
    } catch (err) {
      console.error("Admin login error:", err);
      res.status(500).json({ message: Messages.INTERNAL_SERVER_ERROR });
    }
  },

  //get dashboard
  dashboard: async (req, res) => {
    const dashboardData = await getDashboardData();
    res.render("adminviews/dashboard", {
      title: "Dashboard",
      ...dashboardData,
    });
  },

  //admin logout
  adminlogout: async (req, res) => {
    console.log("Accessed /adminlogout");
    req.session.isadminlogged = false;

    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
        res
          .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
          .send(Messages.INTERNAL_SERVER_ERROR);
      } else {
        res.redirect("/adminlogin");
      }
    });
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
      case "daily":
        orders.forEach((order) => {
          const date = order.orderdate.toISOString().split("T")[0];
          if (!salesData[date]) salesData[date] = 0;
          salesData[date] += order.totalAmount;
        });
        break;

      case "monthly":
        orders.forEach((order) => {
          const yearMonth = order.orderdate.toISOString().slice(0, 7);
          if (!salesData[yearMonth]) salesData[yearMonth] = 0;
          salesData[yearMonth] += order.totalAmount;
        });

        const firstOrderDate =
          orders.length > 0 ? orders[0].orderdate : new Date();
        const lastOrderDate =
          orders.length > 0 ? orders[orders.length - 1].orderdate : new Date();

        const startDate = new Date(
          firstOrderDate.getFullYear(),
          firstOrderDate.getMonth(),
          1
        );
        const endDate = new Date(
          lastOrderDate.getFullYear(),
          lastOrderDate.getMonth() + 1,
          0
        );

        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          const yearMonth = currentDate.toISOString().slice(0, 7);
          if (!salesData[yearMonth]) salesData[yearMonth] = 0;
          currentDate.setMonth(currentDate.getMonth() + 1);
        }
        break;

      case "yearly":
        orders.forEach((order) => {
          const year = order.orderdate.getFullYear().toString();
          if (!salesData[year]) salesData[year] = 0;
          salesData[year] += order.totalAmount;
        });
        break;

      default:
        return res
          .status(STATUS_CODES.BAD_REQUEST)
          .json({ error: "Invalid interval" });
    }

    res.json(salesData);
  },

  //generate sales report pdf
  generatepdf: async (req, res) => {
    try {
      const { fromDate, toDate, interval } = req.query;

      const orders = await Order.find({
        orderdate: { $gte: fromDate, $lte: toDate },
      })
        .populate("user")
        .populate("items.product");

      const overallSalesCount = orders.length;
      const overallOrderAmount = orders.reduce(
        (total, order) => total + order.totalAmount,
        0
      );
      const overallDiscountAmount = orders.reduce(
        (total, order) => total + order.discountAmount,
        0
      );

      const doc = new PDFDocument({ margin: 50, size: "A4" });

      const fileName = `sales_report_${fromDate}_${toDate}.pdf`;
      res.setHeader("Content-disposition", `attachment; filename=${fileName}`);
      res.setHeader("Content-type", "application/pdf");

      doc.pipe(res);

      doc.rect(0, 0, doc.page.width, 120).fill("#667eea");

      doc
        .fillColor("#ffffff")
        .fontSize(24)
        .font("Helvetica-Bold")
        .text("Sales Report", 50, 40, { align: "center" });

      doc
        .fontSize(12)
        .font("Helvetica")
        .text(`Period: ${fromDate} to ${toDate}`, 50, 75, { align: "center" });

      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 50, 95, {
        align: "center",
      });

      let yPosition = 150;

      const summaryData = [
        { label: "Total Orders", value: overallSalesCount, color: "#667eea" },
        {
          label: "Total Revenue",
          value: `₹${overallOrderAmount.toFixed(2)}`,
          color: "#764ba2",
        },
        {
          label: "Total Discounts",
          value: `₹${overallDiscountAmount.toFixed(2)}`,
          color: "#f5576c",
        },
      ];

      const cardWidth = 150;
      const cardHeight = 80;
      const cardSpacing = 20;
      const startX =
        (doc.page.width -
          (summaryData.length * cardWidth +
            (summaryData.length - 1) * cardSpacing)) /
        2;

      summaryData.forEach((item, index) => {
        const xPos = startX + index * (cardWidth + cardSpacing);

        doc
          .rect(xPos, yPosition, cardWidth, cardHeight)
          .fillAndStroke(item.color, item.color);

        doc
          .fillColor("#ffffff")
          .fontSize(10)
          .font("Helvetica")
          .text(item.label, xPos + 10, yPosition + 20, {
            width: cardWidth - 20,
            align: "center",
          });

        doc
          .fontSize(18)
          .font("Helvetica-Bold")
          .text(item.value, xPos + 10, yPosition + 40, {
            width: cardWidth - 20,
            align: "center",
          });
      });

      yPosition += cardHeight + 40;

      doc
        .fillColor("#333333")
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("Order Details", 50, yPosition);

      yPosition += 30;

      const tableTop = yPosition;
      const tableHeaders = [
        "Order ID",
        "Customer",
        "Date",
        "Products",
        "Qty",
        "Payment",
        "Amount",
      ];
      const columnWidths = [60, 80, 70, 120, 40, 70, 60];
      let xPos = 50;

      // Draw header background
      doc.rect(50, tableTop, doc.page.width - 100, 25).fill("#f8f9fa");

      // Draw headers
      tableHeaders.forEach((header, i) => {
        doc
          .fillColor("#333333")
          .fontSize(9)
          .font("Helvetica-Bold")
          .text(header, xPos, tableTop + 8, {
            width: columnWidths[i],
            align: "left",
          });
        xPos += columnWidths[i];
      });

      yPosition = tableTop + 30;

      // Table rows
      orders.forEach((order, index) => {
        // Check if we need a new page
        if (yPosition > doc.page.height - 100) {
          doc.addPage();
          yPosition = 50;
        }

        // Alternate row colors
        if (index % 2 === 0) {
          doc.rect(50, yPosition - 5, doc.page.width - 100, 25).fill("#f8f9fa");
        }

        xPos = 50;
        const rowData = [
          order.orderId || "N/A",
          order.user ? order.user.name : "Unknown",
          order.orderdate.toISOString().split("T")[0],
          order.items
            .map((item) => (item.product ? item.product.name : "Unknown"))
            .join(", "),
          order.items.reduce((sum, item) => sum + item.quantity, 0).toString(),
          order.paymentMethod,
          `₹${order.totalAmount.toFixed(2)}`,
        ];

        doc.fillColor("#333333").fontSize(8).font("Helvetica");

        rowData.forEach((data, i) => {
          doc.text(data, xPos, yPosition, {
            width: columnWidths[i] - 5,
            align: "left",
            ellipsis: true,
          });
          xPos += columnWidths[i];
        });

        yPosition += 25;
      });

      // Footer
      const footerY = doc.page.height - 50;
      doc.rect(0, footerY, doc.page.width, 50).fill("#667eea");
      doc
        .fillColor("#ffffff")
        .fontSize(10)
        .text("Generated by Admin Dashboard", 50, footerY + 20, {
          align: "center",
        });

      doc.end();
    } catch (error) {
      console.error("Error generating PDF:", error);
      res
        .status(STATUS_CODES.INTERNAL_SERVER_ERROR)
        .send("Internal Server Error");
    }
  },
};
