const Product = require('../models/product')
const Order = require('../models/orderSchema')


const placeOrderHelper = async (user, selectedAddress, paymentMethod, cart, couponCode) => {
  // Validate stock for all items before creating the order
  for (const item of cart.items) {
    const product = await Product.findById(item.product._id);
    if (!product || product.stock < item.quantity) {
      throw new Error(`Insufficient stock for product: ${product ? product.name : 'Unknown'}`);
    }
  }

  const newOrder = new Order({
    user,
    items: cart.items,
    shippingAddress: selectedAddress,
    totalAmount: cart.couponApplied && cart.newTotal ? cart.newTotal : cart.total,
    paymentMethod,
    couponApplied: couponCode || null,
    discountAmount: cart.couponApplied ? cart.total - cart.newTotal : 0,
    transactiontype: paymentMethod === 'WALLET' || paymentMethod === 'RAZORPAY' ? 'DEBIT' : undefined,
  });

  // Save the order first
  await newOrder.save();

  // Decrease stock only after order is successfully saved
  await Promise.all(
    cart.items.map(async (item) => {
      const product = await Product.findById(item.product._id);
      if (product) {
        product.stock -= item.quantity;
        await product.save();
      }
    })
  );

  // Clear the cart
  cart.items = [];
  cart.total = 0;
  cart.newTotal = 0;
  cart.couponApplied = null;
  await cart.save();

  return newOrder;
};

module.exports = placeOrderHelper;