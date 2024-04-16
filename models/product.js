const mongoose = require('mongoose')

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true,
    },
    images: [{
        type: String,
        required: true
    }],

    price: {
        type: Number,
        default: 0,
        required: true,
        min: 0
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    stock: {
        type: Number,
        required: true,
        min: 0,
        max: 255
    },
    color: {
        type: String,
    },
    size: [{
        type: Number,
    }],
    dateCreated: {
        type: Date,
        default: Date.now()
    },
    blocked: {
        type: Boolean,
        default: false
    },

    categoryofferprice:{
        type: Number,
        default: 0,
        required: true,
    },

})
module.exports = mongoose.model('Product', productSchema)