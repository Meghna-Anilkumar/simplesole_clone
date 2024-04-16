const mongoose = require('mongoose')
const validator = require('validator');
const bcrypt = require('bcrypt');

const otpSchema = new mongoose.Schema({
    name: {
        type: String,
        // required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: (value) => {
                return validator.isEmail(value);
            },
            message: 'Invalid email address'
        }
    },
    password: {
        type: String,
        // required: true,
        validate: {
            validator: (value) => {
                // Password must contain at least one uppercase letter, one lowercase letter,
                // one special character, and be at least 8 characters long
                const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\-]).{8,}$/;
                return regex.test(value);
            },
            message: 'Password must contain at least one uppercase letter, one lowercase letter, one special character, and be at least 8 characters long'
        }
    },
    confirmPassword: {
        type: String,
        // required: true,
        validate: {
            validator: function (value) {
                return this.password === value;
            },
            message: 'Passwords do not match'
        }
    },
    blocked:
    {
        type: Boolean,
        default: false
    },

    otp: {
        type: String,
        required: true,
    },
    expiresAt: {
        type: Date,
        default: Date.now,
        expires: 60,
    },

})

module.exports = mongoose.model('OTP', otpSchema)