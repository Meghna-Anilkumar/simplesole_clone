const mongoose = require('mongoose')

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [
        {
            product: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product',
               
            },
            quantity: {
                type: Number,
                
            },
            price: {
                type: Number,
            }, 

            itemstatus: {
                type: String,
                enum: ['PENDING', 'CANCELLED'],
                default: 'PENDING'
              },

              cancellationReason: {
                type: String,
                required: function () {
                    return this.itemStatus === 'CANCELLED'
                }   
              }
        }
    ],
    shippingAddress: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    totalAmount: {
        type: Number,
        
    },
    paymentMethod: {
        type: String,
        enum: ['CASH_ON_DELIVERY', 'WALLET', 'RAZORPAY'],
        required: true
    },
    orderStatus: {
        type: String,
        enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED','RETURNED'],
        default: 'PENDING'
    },
    orderdate: {
        type: Date,
        default: Date.now
    },
    deliveryDate: {
        type: Date
    },
    cancellationReason: {
        type: String,
        required: function () {
            return this.orderStatus === 'CANCELLED'
        }   
    },
    returnReason: {
        type: String,
        required: function () {
            return this.orderStatus === 'DELIVERED';
        }
    },
    orderId: {
        type: String,
        unique: true,
    },
   
    discountAmount:{
        type: Number,
        default:0
     }

})

orderSchema.pre('save', async function (next) {
    try {
        // Generate a random number between 10000 and 99999
        const randomNumber = Math.floor(Math.random() * 90000) + 10000;

        // Create the order ID with the '#' symbol and the random number
        this.orderId = `#${randomNumber}`

        next()
    } catch (error) {
        next(error)
    }
})

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
