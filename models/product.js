const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  images: [{ type: String, required: true }],
  price: { type: Number, default: 0, required: true, min: 0 },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true,
  },
  variants: [
    {
      size: String,
      stock: { type: Number, min: 0 },
      reserved: { type: Number, default: 0, min: 0 },
    },
  ],
  reserved: { type: Number, default: 0, min: 0 },
  version: { type: Number, default: 0 },
  dateCreated: { type: Date, default: Date.now },
  blocked: { type: Boolean, default: false },
  categoryofferprice: { type: Number, default: 0, required: true },
});

module.exports = mongoose.model("Product", productSchema);
