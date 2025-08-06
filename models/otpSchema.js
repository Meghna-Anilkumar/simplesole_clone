const mongoose = require('mongoose')
const validator = require('validator');

const otpSchema = new mongoose.Schema({
    name: {
        type: String,
        required: false // Make optional since password reset doesn't need name
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
        required: false, // Make optional since password reset doesn't need this
        validate: {
            validator: function(value) {
                // Skip validation if password is not provided
                if (!value) return true;
                
                const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\-]).{8,}$/;
                return regex.test(value);
            },
            message: 'Password must contain at least one uppercase letter, one lowercase letter, one special character, and be at least 8 characters long'
        }
    },
    confirmPassword: {
        type: String,
        required: false, // Make optional
        validate: {
            validator: function (value) {
                // Skip validation if confirmPassword is not provided
                if (!value) return true;
                return this.password === value;
            },
            message: 'Passwords do not match'
        }
    },
    blocked: {
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
        expires: 300, // 5 minutes in seconds
    },
    purpose: {
        type: String,
        enum: ['registration', 'password_reset'],
        default: 'registration'
    }
})

// Add index for better query performance
otpSchema.index({ email: 1, expiresAt: 1 });

module.exports = mongoose.model('OTP', otpSchema)