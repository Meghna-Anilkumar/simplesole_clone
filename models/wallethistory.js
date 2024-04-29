const mongoose = require('mongoose');

const wallethistorySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true,
        unique: true,
    },
    transactiontype:{
        type:String,
        default:'CREDIT'
    },
    amount:{
        type:Number,
    }
});

const Wallethistory = mongoose.model('Wallethistory', wallethistorySchema);

module.exports = Wallethistory;
