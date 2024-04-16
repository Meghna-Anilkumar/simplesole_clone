const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  name: String,
  mobile: Number,
  buildingname: String,
  street: String,
  city: String,
  state: String,
  pincode: String,
  addresstype: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
})

const Address = mongoose.model('Address', addressSchema)

module.exports = Address;