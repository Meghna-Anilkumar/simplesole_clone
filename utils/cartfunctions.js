const Category = require('../models/category');
const Product = require('../models/product');

const calculateTotalPrice = async (items, productOffers, categoryOffers) => {
  let totalPrice = 0;

  for (const item of items) {
    // Ensure product is populated and exists
    if (!item.product || !item.product._id) {
      console.warn(`Skipping item with missing product: ${JSON.stringify(item)}`);
      continue;
    }

    const product = await Product.findById(item.product._id).exec();
    if (!product) {
      console.warn(`Product not found for ID: ${item.product._id}`);
      continue;
    }

    console.log('Processing item:', {
      productId: item.product._id,
      productName: product.name,
      quantity: item.quantity,
      price: item.price,
    });

    let price = item.price || product.price; // Use stored item.price if available, else product.price
    const productOffer = productOffers.find((offer) => offer.product.toString() === item.product._id.toString());
    if (productOffer && productOffer.newPrice < price) {
      price = productOffer.newPrice;
      console.log(`Using product offer price for ${product.name}: ₹${price}`);
    } else if (product.categoryofferprice && product.categoryofferprice < price) {
      price = product.categoryofferprice;
      console.log(`Using category offer price for ${product.name}: ₹${price}`);
    }

    const subtotal = price * item.quantity;
    if (isNaN(subtotal)) {
      console.warn(`Invalid subtotal for ${product.name}: price = ₹${price}, quantity = ${item.quantity}`);
      continue;
    }

    console.log(`Item ${product.name}: price = ₹${price}, quantity = ${item.quantity}, subtotal = ₹${subtotal}`);
    totalPrice += subtotal;
  }

  console.log(`Total price calculated: ₹${totalPrice}`);
  return totalPrice;
};

const calculateCategoryOfferPrice = (originalPrice, discountPercentage) => {
    const discountAmount = (originalPrice * discountPercentage) / 100;
    return Number((originalPrice - discountAmount).toFixed(2));
};

module.exports = {
    calculateTotalPrice,
    calculateCategoryOfferPrice
};