const User = require('../models/user')
const bcrypt = require('bcrypt')
const Category = require('../models/category')
const Product = require('../models/product')
const session = require('express-session')
const UserDetails = require('../models/userdetails')
const bodyParser = require('body-parser')
const Address = require('../models/address')
const OTP = require('../models/otpSchema');
const nodemailer = require('nodemailer');
const otpGenerator = require('otp-generator');
const Wishlist = require('../models/wishlist')
const Cart = require('../models/cartSchema');


module.exports = {

  //view homepage
  homepage: async (req, res) => {
    try {
      const category = await Category.find().exec();
      let wishlist;
      let cart
      if (req.user) {
        wishlist = await Wishlist.findOne({ user: req.user._id }).populate('items.product');
        cart = await Cart.findOne({ user: req.user._id }).populate('items.product').exec();

      }
      const newArrivals = await Product.find()
        .sort({ dateCreated: -1 })
        .limit(4);

      res.render('userviews/home', {
        title: 'Home',
        category: category,
        newArrivals: newArrivals,
        wishlist: wishlist,
        cart: cart
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },


  //get login page
  loginpage: async (req, res) => {
    try {
      const categories = await Category.find();
      const wishlist = [];
      const cart = req.session.cart || { items: [] }

      res.render('userviews/login', { title: 'Login', category: categories, wishlist: wishlist, cart: cart });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },


  //to login
  tologin: async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email: email });

      if (!user || user.blocked) {
        const categories = await Category.find();
        return res.render('userviews/login', { error: 'User does not exist', title: 'Login', category: categories });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (isMatch) {
        req.session.isAuth = true;
        req.session.user = user;
        console.log('Redirecting to /');
        return res.redirect('/');
      } else {
        const categories = await Category.find();
        return res.render('userviews/login', { error: 'Incorrect password', title: 'Login', category: categories });
      };

    } catch (error) {
      console.error(error);
      res.json({ message: error.message, type: 'danger' });
    }
  },

  //to signup
  signup: async (req, res) => {
    const categories = await Category.find();
    const wishlist=[]
    const cart=[]
    res.render('userviews/signup',
      { title: 'Signup page', category: categories,wishlist,cart }
    )
  },


  //usericon
  userIcon: async (req, res) => {
    const x = req.session.user
    const _id = x ? x._id : null;
    try {
      const data = await UserDetails.findOne({ user: _id })
      const user = req.session.user
      if (req.session.isAuth) {
        const categories = await Category.find();
        const wishlist = await Wishlist.findOne({ user: user._id }).populate('items.product');
        const cart = await Cart.findOne({ user }).populate('items.product').exec();
        return res.render('userviews/profile', { message: { type: 'success', message: 'Profile details updated successfully' }, title: 'user profile', category: categories, data: data, user: user, wishlist, cart });
      } else {
        const wishlist = [];
        const cart = req.session.cart || { items: [] }
        const categories = await Category.find();
        return res.render('userviews/login', { title: 'Login', category: categories,wishlist:wishlist,cart:cart });
      }
    } catch (error) {
      console.error('Error updating profile details:', error);
      res.status(500).json({ message: { type: 'error', message: 'Internal Server Error' } });
    }
  },


  //already have an account
  Login: async (req, res) => {
    const wishlist=[]
    const cart=[]
    res.render('userviews/login',{wishlist,cart})
  },


  //edit profile details
  editprofiledetails: async (req, res) => {
    try {
      const userId = req.session.user;

      const { firstName, lastName, mobileNumber } = req.body;

      const updatedDetails = await UserDetails.findOneAndUpdate(
        { user: userId },
        {
          firstName: firstName,
          lastName: lastName,
          mobileNumber: mobileNumber
        },
        { new: true, upsert: true }
      );
    } catch (error) {
      console.error('Error updating profile details:', error);
      res.status(500).send('Internal Server Error');
    }

  },


  //get address book
  getaddressbook: async (req, res) => {
    try {
      if (req.session.isAuth) {
        const userId = req.session.user ? req.session.user._id : null;
        const id = req.params.id;
  
        const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        const userData = await UserDetails.findOne({ user: userId });
        const addresses = await Address.find({ user: userId });
        const categories = await Category.find();
        const result = await Address.findById(id);
  
        res.render('userviews/address', {
          title: 'Address',
          category: categories,
          data: { user: req.session.user, userData, addresses },
          address: result,
          wishlist,
          cart
        });
      } else {
        const categories = await Category.find();
        res.render('userviews/login', { title: 'Login', category: categories });
      }
    } catch (error) {
      console.error('Error getting address book:', error);
      res.status(500).json({ message: { type: 'error', message: 'Internal Server Error' } });
    }
  },

  //add new address
  addnewaddress: async (req, res) => {
    try {
      const addressData = req.body;

      addressData.user = req.session.user._id;

      const newAddress = await Address.create(addressData);
      const updatedAddresses = await Address.find({ user: req.session.user._id });
      res.json({ message: 'Address saved successfully', address: newAddress });
    } catch (error) {
      console.error('Error saving address:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }

  },


  //get addresses
  getaddresses: async (req, res) => {
    try {
      const user = req.session.user
      const addresses = await Address.find({ user: user });
      res.json(addresses);
    } catch (error) {
      console.error('Error getting addresses:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },

  //delete addresses
  deleteAddress: async (req, res) => {
    try {
      const addressId = req.params.id;
      const result = await Address.findByIdAndDelete(addressId);

      if (!result) {
        return res.status(404).json({ error: 'Address not found' });
      }

      res.json({ message: 'Address deleted successfully' });
    } catch (error) {
      console.error('Error deleting address:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  //edit addresses
  editAddress: async (req, res) => {
    try {
      const addressId = req.params.id
      const updatedAddress = await Address.findByIdAndUpdate(
        addressId, req.body, { new: true });

      res.json(updatedAddress);
    } catch (error) {
      console.error('Error updating address:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  //get change password page
  changepasswordpage: async (req, res) => {
    try {
      const categories = await Category.find();
      const userId = req.session.user ? req.session.user._id : null;
      const userData = await UserDetails.findOne({ user: userId });
      const addresses = await Address.find({ user: userId });
      const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
      const cart = await Cart.findOne({ user: userId }).populate('items.product').exec();
  
      res.render('userviews/changepassword', {
        title: 'Change password',
        category: categories,
        data: { user: req.session.user, userData, addresses },
        wishlist,
        cart
      });
    } catch (error) {
      console.error('Error rendering change password page:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },
  

  //change password
  changepassword: async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      const userId = req.session.user._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);

      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\-]).{8,}$/;
      if (!regex.test(newPassword)) {
        return res.status(400).json({ error: 'Invalid new password format' });
      }

      user.password = newPassword;

      await user.save();
      req.session.user = user;

      res.status(200).json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },


  //email page for forgot password
  verifyemail: async (req, res) => {
    try {
      const category = await Category.find();
      const userId = req.session.user ? req.session.user._id : null;
      const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
      const cart = await Cart.findOne({ user: userId }).populate('items.product').exec();
  
      res.render('userviews/emailforgotpassword', {
        title: 'Verify email',
        category,
        wishlist,
        cart
      });
    } catch (error) {
      console.error('Error rendering verify email page:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  },
  


  //send otp to verify email on forgot password
  sendOTP: async (req, res) => {
    try {
      const { email } = req.body;

      const otp = otpGenerator.generate(6, { upperCase: false, specialChars: false, alphabets: false, digits: true });

      const otpRecord = new OTP({
        email: email,
        otp: otp,
        expiresAt: Date.now() + 60 * 1000,
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
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your OTP for Forgot Password',
        text: `Your OTP is ${otp}. It will expire in 60 seconds.`,
      };

      await transporter.sendMail(mailOptions);
      req.session.email = email;

      console.log(otp)
      const categories = await Category.find()
      const wishlist = []
        const cart = []
      res.render('userviews/otp', { email, category: categories ,wishlist,cart});

    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },


  //reset password
  resetPassword: async (req, res) => {
    try {
      const { newPassword, confirmPassword } = req.body;

      console.log(req.body, 'oooooooo')
      const email = req.session.email;

      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'New password and confirm password do not match' });
      }

      console.log('Email:', email);

      const existingUser = await User.findOne({ email });

      console.log('Existing user:', existingUser);

      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      existingUser.password = newPassword;
      await existingUser.save();

      const categories = await Category.find();
      const wishlist=[]
      const cart=[]
      return res.render('userviews/login', { title: 'Login', category: categories,wishlist,cart });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },


}








