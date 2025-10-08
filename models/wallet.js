const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true,
        unique: true,
    },
    balance: {
        type: Number,
        default: 0,
    },

    walletTransactions: [
        {
            type: {
                type: String,
                enum: ["debit", "credit"],
                required: true,
            },
            amount: {
                type: Number,
                required: true,
            },
            description: {
                type: String,
                required: true,
            },
            date: {
                type: Date,
                default: Date.now,
            },
            orderId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Order',
            },
        }
    ],
}, { timestamps: true });

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;