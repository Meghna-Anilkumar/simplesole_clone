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
    transactiontype:{
        type:String,
        default:'CREDIT'
    }
});

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
