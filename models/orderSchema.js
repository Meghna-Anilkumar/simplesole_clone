const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
      quantity: {
        type: Number,
      },
      price: {
        type: Number,
      },
      size: {
        type: String,
        required: true,
      },
      itemstatus: {
        type: String,
        enum: ["PENDING", "CANCELLED"],
        default: "PENDING",
      },
      cancellationReason: {
        type: String,
        required: function () {
          return this.itemstatus === "CANCELLED";
        },
      },
    },
  ],
  shippingAddress: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Address",
    required: true,
  },
  totalAmount: {
    type: Number,
  },
  refundedAmount: {
    type: Number,
    default: 0,
  },
  paymentMethod: {
    type: String,
    enum: ["CASH_ON_DELIVERY", "WALLET", "RAZORPAY"],
    required: true,
  },
  orderStatus: {
    type: String,
    enum: [
      "PENDING",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "RETURNED",
      "RETURN REQUESTED",
      "RETURN REJECTED",
    ],
    default: "PENDING",
  },
  orderdate: {
    type: Date,
    default: Date.now,
  },
  deliveryDate: {
    type: Date,
  },
  cancellationReason: {
    type: String,
    required: function () {
      return this.orderStatus === "CANCELLED";
    },
  },
  returnReason: {
    type: String,
    required: function () {
      return this.orderStatus === "RETURN REQUESTED";
    },
  },
  orderId: {
    type: String,
    unique: true,
  },
  discountAmount: {
    type: Number,
    default: 0,
  },
  couponCode: {
    type: String,
  },
  transactiontype: {
    type: String,
  },
});

orderSchema.pre("save", async function (next) {
  try {
    if (!this.orderId) {
      const randomNumber = Math.floor(Math.random() * 90000) + 10000;
      this.orderId = `#${randomNumber}`;
    }
    next();
  } catch (error) {
    next(error);
  }
});

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;