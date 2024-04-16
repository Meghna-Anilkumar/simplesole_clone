const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
      },
      quantity:{
        type: Number,
      } 
    }
  ],
  total: {
    type: Number,
    default: 0
  },

  newTotal:{
    type: Number,
    default: 0
  },

  couponApplied: {
    type: String,
  }

});

module.exports = mongoose.model('Cart', cartSchema);


