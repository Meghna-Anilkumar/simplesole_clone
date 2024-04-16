const mongoose = require('mongoose')
const validator = require('validator')
const bcrypt = require('bcrypt')
const {generateReferralCode}=require('../utils/referralcode')

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },

    blocked: {
        type: Boolean,
        default: false
    },

    usedCoupons: {
        type: Array,
        default: []
    },

    referral: {
        type: String,
        unique: true,
        default: generateReferralCode,
    },
    userId: {
        type: String,
        unique: true,
    },
})

userSchema.pre('save', async function (next) {
    try {
        if (!this.isBlocked) {
            const hashedPassword = await bcrypt.hash(this.password, 10);
            this.password = hashedPassword;
        }

        const randomNumber = Math.floor(Math.random() * 90000) + 10000;
        this.userId = `user#${randomNumber}`;
        next();
    } catch (error) {
        next(error);
    }
})


module.exports = mongoose.model('User', userSchema)