const User = require('../models/user')
const OTP = require('../models/otpSchema')
const nodemailer = require('nodemailer')
const otpGenerator = require('otp-generator')
const bcrypt = require('bcrypt')
const Category = require('../models/category')
const { generateReferralCode } = require('../utils/generatereferral');
const Wallet = require('../models/wallet')


module.exports = {

  register: async (req, res) => {
    try {
      const { name, email, password, confirmPassword, referralCode } = req.body;
      

      const nameRegex = /^[A-Za-z]+$/;

      if (!nameRegex.test(name)) {
        const categories = await Category.find();
        return res.render('userviews/signup', {
          error: 'Please enter a valid name!!!!!',
          title: 'Signup',
          category: categories,
        });
      }

      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

      if (!passwordRegex.test(password)) {
        const categories = await Category.find();
        return res.render('userviews/signup', { error: 'Password should contain atleast 8 characters,an uppercase letter,a lowercase letter and a special character', title: 'Signup', category: categories });
      }

      if (password !== confirmPassword) {
        const categories = await Category.find();
        return res.render('userviews/signup', {
          error: 'Password and Confirm Password do not match',
          title: 'Signup',
          category: categories
        });
      }

      const existingUser = await User.findOne({ email });

      if (existingUser) {
        const categories = await Category.find();
        return res.render('userviews/signup', {
          error: 'Email already exists. Please use a different email address.',
          title: 'Signup',
          category: categories,
        })
      }

      if (referralCode) {
        const referredUser = await User.findOne({ referral: referralCode });
        if (!referredUser) {
          const categories = await Category.find();
          return res.render('userviews/signup', {
            error: 'Invalid referral code. Please enter a valid referral code or leave it empty.',
            title: 'Signup',
            category: categories,
          });
        }
      }

      console.log(email)

      req.session.email = email;
      req.session.name = name;
      req.session.password = password;
      req.session.referralCode = referralCode

      const otp = otpGenerator.generate(6, { upperCase: false, specialChars: false, alphabets: false, digits: true });

      const otpRecord = new OTP({
        name: req.body.name,
        email: req.body.email,
        otp: otp,
        password: req.body.password,
        confirmPassword: req.body.confirmPassword,
        expiresAt: 60,
        blocked: false,
      });

      await otpRecord.save();

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.MAILID,
          pass: process.env.PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.MAILID,
        to: email,
        subject: 'Your OTP for Signup',
        text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
      };


      const sendMailPromise = new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.log(error);
            reject('Failed to send OTP');
          }
          console.log('Email sent: ' + info.response + otp);
          console.log(otp);
          console.log(email);
          resolve();
        });
      });

      await sendMailPromise;

      const categories = await Category.find();
      const wishlist = []
      const cart = []

      res.render('userviews/otp', { email, category: categories, wishlist, cart });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },


  verifyotp: async (req, res) => {
    try {
      const { otp: otpArray } = req.body;
      const [email, myotp] = otpArray;

      const referralCode = req.session.referralCode

      const otpRecord = await OTP.findOne({ email });

      const existingUser = await User.findOne({ email });

      if (existingUser) {
        console.log('hiiiiiiii')
        const categories = await Category.find()
        const wishlist = []
        const cart = []

        return res.render('userviews/resetpassword', { title: 'Reset password', email, category: categories, wishlist, cart })
      }

      if (!otpRecord) {
        const categories = await Category.find();
        const wishlist = []
        const cart = []
        return res.render('userviews/otp', { email, category: categories, error: 'Invalid OTP',wishlist,cart });
      }

      if (myotp == otpRecord.otp) {
        const referral = generateReferralCode();
        const user = new User({
          name: otpRecord.name,
          email: otpRecord.email,
          password: otpRecord.password,
          confirmPassword: otpRecord.confirmPassword,
          otp: otpRecord.otp,
          expiresAt: otpRecord.expiresAt,
          blocked: otpRecord.blocked,
          referral
        });
        await user.save();

        if (referralCode) {
          const referredUser = await User.findOne({ referral: referralCode });

          if (referredUser) {
            let wallet = await Wallet.findOneAndUpdate(
              { user: referredUser._id },
              { $inc: { balance: 100 } },
              { new: true }
            );
            if (!wallet) {
              wallet = new Wallet({
                user: referredUser._id,
                balance: 100,
              });
              await wallet.save();
            }
          }
        }

        req.session.isAuth = true;
        req.session.user = user;
        return res.redirect('/');
      }

      if (!otpRecord || myotp !== otpRecord.otp) {
        const categories = await Category.find();
        return res.render('userviews/otp', { email, category: categories, error: 'Invalid OTP' });
      }

    } catch (error) {
      console.error(error);
      res.json({ message: error.message, type: 'danger' });
    }
  },



  //get all users(from database to customers page)
  customers: async (req, res) => {
    try {
      const users = await User.find().exec();
      res.render('adminviews/customers', {
        title: 'Customers',
        users: users
      });
    } catch (err) {
      res.json({ message: err.message });
    }
  },

  //to block or unblock user
  blockUser: async (req, res) => {
    const userId = req.body.userId;

    try {
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).send('User not found');
      }

      user.blocked = !user.blocked;

      await user.save();

      res.redirect('/customers');
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error')
    }
  },

  //resend otp
  resendOTP: async (req, res) => {
    try {
      const { name, email, password } = req.session;

      let otpRecord = await OTP.findOne({ email });

      if (!otpRecord) {
        const newOTP = otpGenerator.generate(6, { upperCase: false, specialChars: false, alphabets: false, digits: true });

        otpRecord = new OTP({
          name: name,
          email: email,
          password: password,
          otp: newOTP,
          expiresAt: new Date(Date.now() + 60 * 1000)
        });

        await otpRecord.save();
      } else {
        const newOTP = otpGenerator.generate(6, { upperCase: false, specialChars: false, alphabets: false, digits: true });

        otpRecord.otp = newOTP;
        otpRecord.expiresAt = new Date(Date.now() + 60 * 1000);
        await otpRecord.save();
      }

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.MAILID,
          pass: process.env.PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.MAILID,
        to: email,
        subject: 'Your New OTP for Signup',
        text: `Your new OTP is ${otpRecord.otp}. It will expire in 60 seconds.`,
      };

      await transporter.sendMail(mailOptions);

      console.log('New OTP:', otpRecord.otp);
      const categories = await Category.find();
      const wishlist = []
      const cart = []
      res.render('userviews/otp', { email, category: categories ,wishlist,cart});
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },



}



