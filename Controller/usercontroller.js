const User = require("../models/user");
const bcrypt = require("bcrypt");
const Category = require("../models/category");
const Product = require("../models/product");
const UserDetails = require("../models/userdetails");
const Address = require("../models/address");
const OTP = require("../models/otpSchema");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const Wishlist = require("../models/wishlist");
const Cart = require("../models/cartSchema");
const Razorpay = require("razorpay");
require("dotenv").config();
const Wallet = require("../models/wallet");
const HttpStatusCode = require("../enums/statusCodes");
const Messages = require("../constants/messages");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");

const razorpay = new Razorpay({
  key_id: process.env.key_id,
  key_secret: process.env.key_secret,
});

module.exports = {
  //view homepage
  homepage: async (req, res) => {
    try {
      const category = await Category.find().exec();
      let wishlist;
      let cart;
      if (req.user) {
        wishlist = await Wishlist.findOne({ user: req.user._id }).populate(
          "items.product"
        );
        cart = await Cart.findOne({ user: req.user._id })
          .populate("items.product")
          .exec();
      }
      const newArrivals = await Product.find({ blocked: false })
        .sort({ dateCreated: -1 })
        .limit(4);
      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      })
        .populate("product")
        .exec();
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      res.render("userviews/home", {
        title: "Home",
        category: category,
        newArrivals: newArrivals,
        wishlist: wishlist,
        cart: cart,
        productOffers: productOffers,
        categoryOffers: categoryOffers,
      });
    } catch (error) {
      console.error(error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .send(Messages.INTERNAL_SERVER_ERROR);
    }
  },

  //get login page
  loginpage: async (req, res) => {
    try {
      const categories = await Category.find();
      const wishlist = [];
      const cart = [];
      res.render("userviews/login", {
        title: "Login",
        category: categories,
        wishlist: wishlist,
        cart: cart,
      });
    } catch (error) {
      console.error(error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .send(Messages.INTERNAL_SERVER_ERROR);
    }
  },

  //to login
  tologin: async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email: email });

      if (!user || user.blocked) {
        const wishlist = [];
        const cart = [];
        const categories = await Category.find();
        return res.render("userviews/login", {
          error: "User does not exist",
          title: "Login",
          category: categories,
          wishlist,
          cart,
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (isMatch) {
        req.session.isAuth = true;
        req.session.user = user;
        console.log("Redirecting to /");
        return res.redirect("/");
      } else {
        const wishlist = [];
        const cart = [];
        const categories = await Category.find();
        return res.render("userviews/login", {
          error: "Incorrect password",
          title: "Login",
          category: categories,
          wishlist,
          cart,
        });
      }
    } catch (error) {
      console.error(error);
      res.json({ message: error.message, type: "danger" });
    }
  },

  //to signup
  signup: async (req, res) => {
    const categories = await Category.find();
    const wishlist = [];
    const cart = [];
    res.render("userviews/signup", {
      title: "Signup page",
      category: categories,
      wishlist,
      cart,
    });
  },

  //usericon
  userIcon: async (req, res) => {
    const x = req.session.user;
    const _id = x ? x._id : null;
    try {
      const data = await UserDetails.findOne({ user: _id });
      const user = req.session.user;
      if (req.session.isAuth) {
        const categories = await Category.find();
        const wishlist = await Wishlist.findOne({ user: user._id }).populate(
          "items.product"
        );
        const cart = await Cart.findOne({ user })
          .populate("items.product")
          .exec();
        return res.render("userviews/profile", {
          message: {
            type: "success",
            message: Messages.PROFILE_UPDATED_SUCCESS,
          },
          title: "user profile",
          category: categories,
          data: data,
          user: user,
          wishlist,
          cart,
        });
      } else {
        const wishlist = [];
        const cart = req.session.cart || { items: [] };
        const categories = await Category.find();
        return res.render("userviews/login", {
          title: "Login",
          category: categories,
          wishlist: wishlist,
          cart: cart,
        });
      }
    } catch (error) {
      console.error("Error updating profile details:", error);
      res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({
        message: { type: "error", message: Messages.INTERNAL_SERVER_ERROR },
      });
    }
  },

  //already have an account
  Login: async (req, res) => {
    const wishlist = [];
    const cart = [];
    res.render("userviews/login", { wishlist, cart });
  },

  //edit profile details
  editprofiledetails: async (req, res) => {
    try {
      const userId = req.session.user;
      const { firstName, lastName, mobileNumber } = req.body;

      // Get current user details
      const currentDetails = await UserDetails.findOne({ user: userId });

      // Build update object with only changed fields
      const updateFields = {};
      if (
        firstName !== undefined &&
        (!currentDetails || currentDetails.firstName !== firstName)
      ) {
        updateFields.firstName = firstName;
      }
      if (
        lastName !== undefined &&
        (!currentDetails || currentDetails.lastName !== lastName)
      ) {
        updateFields.lastName = lastName;
      }
      if (
        mobileNumber !== undefined &&
        (!currentDetails || currentDetails.mobileNumber !== mobileNumber)
      ) {
        updateFields.mobileNumber = mobileNumber;
      }

      // Only update if there are changes
      if (Object.keys(updateFields).length === 0) {
        return res.status(200).json({
          success: true,
          message: "No changes detected",
          data: currentDetails || {
            firstName: "",
            lastName: "",
            mobileNumber: "",
          },
        });
      }

      const updatedDetails = await UserDetails.findOneAndUpdate(
        { user: userId },
        updateFields,
        { new: true, upsert: true }
      );

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: {
          firstName: updatedDetails.firstName,
          lastName: updatedDetails.lastName,
          mobileNumber: updatedDetails.mobileNumber,
        },
      });
    } catch (error) {
      console.error("Error updating profile details:", error);
      res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: Messages.INTERNAL_SERVER_ERROR,
      });
    }
  },

  //get address book
  getaddressbook: async (req, res) => {
    try {
      if (req.session.isAuth) {
        const userId = req.session.user ? req.session.user._id : null;
        const id = req.params.id;

        const wishlist = await Wishlist.findOne({ user: userId }).populate(
          "items.product"
        );
        const cart = await Cart.findOne({ user: userId }).populate(
          "items.product"
        );
        const userData = await UserDetails.findOne({ user: userId });
        const addresses = await Address.find({ user: userId });
        const categories = await Category.find();
        const result = await Address.findById(id);

        res.render("userviews/address", {
          title: "Address",
          category: categories,
          data: { user: req.session.user, userData, addresses },
          address: result,
          wishlist,
          cart,
        });
      } else {
        const categories = await Category.find();
        res.render("userviews/login", { title: "Login", category: categories });
      }
    } catch (error) {
      console.error("Error getting address book:", error);
      res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({
        message: { type: "error", message: Messages.INTERNAL_SERVER_ERROR },
      });
    }
  },

  getResetPasswordPage: async (req, res) => {
    try {
      const email = req.session.email;

      // Check if email exists in session (user verified OTP)
      if (!email) {
        return res.redirect("/forgotpassword");
      }

      const categories = await Category.find();
      const wishlist = [];
      const cart = [];

      res.render("userviews/resetpassword", {
        title: "Reset Password",
        category: categories,
        wishlist,
        cart,
        email: email,
      });
    } catch (error) {
      console.error("Error rendering reset password page:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  //add new address
  addnewaddress: async (req, res) => {
    try {
      const userId = req.session.user?._id;
      console.log("addnewaddress - User ID:", userId);
      console.log("addnewaddress - Request body:", req.body);

      if (!userId) {
        return res
          .status(HttpStatusCode.UNAUTHORIZED)
          .json({ message: Messages.USER_NOT_AUTHENTICATED });
      }

      const addressData = {
        name: req.body.addressName,
        mobile: req.body.mobileNumber,
        buildingname: req.body.buildingname,
        street: req.body.street,
        city: req.body.city,
        state: req.body.state,
        pincode: req.body.PINCode,
        addresstype: req.body.addressType,
        user: userId,
      };

      console.log("addnewaddress - Address data to save:", addressData);

      const newAddress = await Address.create(addressData);
      console.log("addnewaddress - Address saved:", newAddress);

      res.json({ message: "Address saved successfully", address: newAddress });
    } catch (error) {
      console.error("Error saving address:", error);
      res.status(500).json({
        message: Messages.INTERNAL_SERVER_ERROR,
        details: error.message,
      });
    }
  },

  getAddressById: async (req, res) => {
    try {
      const addressId = req.params.id;
      const userId = req.session.user?._id;
      console.log(
        "getAddressById - Address ID:",
        addressId,
        "User ID:",
        userId
      );

      if (!userId) {
        console.error("getAddressById - No user in session");
        return res
          .status(HttpStatusCode.UNAUTHORIZED)
          .json({ error: Messages.USER_NOT_AUTHENTICATED });
      }

      const address = await Address.findOne({ _id: addressId, user: userId });
      if (!address) {
        console.error(
          "getAddressById - Address not found for ID:",
          addressId,
          "User:",
          userId
        );
        return res
          .status(HttpStatusCode.NOT_FOUND)
          .json({ error: "Address not found or does not belong to user" });
      }

      console.log("getAddressById - Address found:", address);
      res.json(address);
    } catch (error) {
      console.error("Error fetching address by ID:", error);
      res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({
        error: Messages.INTERNAL_SERVER_ERROR,
        details: error.message,
      });
    }
  },

  //get addresses
  getaddresses: async (req, res) => {
    try {
      const userId = req.session.user?._id;
      console.log("getaddresses - User ID:", userId);

      if (!userId) {
        return res
          .status(401)
          .json({ message: Messages.USER_NOT_AUTHENTICATED });
      }

      const addresses = await Address.find({ user: userId });
      console.log("getaddresses - Found addresses:", addresses.length);
      res.json(addresses);
    } catch (error) {
      console.error("Error getting addresses:", error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .json({ message: Messages.INTERNAL_SERVER_ERROR });
    }
  },

  //delete addresses
  deleteAddress: async (req, res) => {
    try {
      const addressId = req.params.id;
      const userId = req.session.user?._id;

      console.log("deleteAddress - Address ID:", addressId, "User ID:", userId);

      if (!userId) {
        return res
          .status(HttpStatusCode.UNAUTHORIZED)
          .json({ error: Messages.USER_NOT_AUTHENTICATED });
      }

      const result = await Address.findOneAndDelete({
        _id: addressId,
        user: userId,
      });

      if (!result) {
        return res
          .status(404)
          .json({ error: "Address not found or does not belong to user" });
      }

      console.log("deleteAddress - Address deleted successfully");
      res.json({ message: "Address deleted successfully" });
    } catch (error) {
      console.error("Error deleting address:", error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .json({ error: Messages.INTERNAL_SERVER_ERROR });
    }
  },

  //edit addresses
  editAddress: async (req, res) => {
    try {
      const addressId = req.params.id;
      const userId = req.session.user?._id;
      console.log(
        "editAddress - Address ID:",
        addressId,
        "User ID:",
        userId,
        "Body:",
        req.body
      );

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const updatedAddressData = {
        name: req.body.addressName,
        mobile: req.body.mobileNumber,
        buildingname: req.body.buildingname,
        street: req.body.street,
        city: req.body.city,
        state: req.body.state,
        pincode: req.body.PINCode,
        addresstype: req.body.addressType,
      };

      const updatedAddress = await Address.findOneAndUpdate(
        { _id: addressId, user: userId },
        updatedAddressData,
        { new: true }
      );

      if (!updatedAddress) {
        console.error("editAddress - Address not found for ID:", addressId);
        return res
          .status(404)
          .json({ error: "Address not found or does not belong to user" });
      }

      console.log("editAddress - Address updated:", updatedAddress);
      res.json({
        message: "Address updated successfully",
        address: updatedAddress,
      });
    } catch (error) {
      console.error("Error updating address:", error);
      res
        .status(500)
        .json({ error: "Internal Server Error", details: error.message });
    }
  },

  //get change password page
  changepasswordpage: async (req, res) => {
    try {
      const categories = await Category.find();
      const userId = req.session.user ? req.session.user._id : null;
      const userData = await UserDetails.findOne({ user: userId });
      const addresses = await Address.find({ user: userId });
      const wishlist = await Wishlist.findOne({ user: userId }).populate(
        "items.product"
      );
      const cart = await Cart.findOne({ user: userId })
        .populate("items.product")
        .exec();

      res.render("userviews/changepassword", {
        title: "Change password",
        category: categories,
        data: { user: req.session.user, userData, addresses },
        wishlist,
        cart,
      });
    } catch (error) {
      console.error("Error rendering change password page:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  //change password
  changepassword: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.session.user._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);

      if (!isMatch) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const regex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*()_+{}\[\]:;<>,.?~\\-]).{8,}$/;
      if (!regex.test(newPassword)) {
        return res.status(400).json({
          error:
            "Password should contain atleast 8 characters,an uppercase letter,a lowercase letter and a special character",
        });
      }

      user.password = newPassword;

      await user.save();
      req.session.user = user;

      res.status(200).json({ message: "Password changed successfully" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  //email page for forgot password
  verifyemail: async (req, res) => {
    try {
      const category = await Category.find();
      const userId = req.session.user ? req.session.user._id : null;
      const wishlist = await Wishlist.findOne({ user: userId }).populate(
        "items.product"
      );
      const cart = await Cart.findOne({ user: userId })
        .populate("items.product")
        .exec();

      res.render("userviews/emailforgotpassword", {
        title: "Verify email",
        category,
        wishlist,
        cart,
      });
    } catch (error) {
      console.error("Error rendering verify email page:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  //send otp to verify email on forgot password
  sendOTP: async (req, res) => {
    try {
      const { email } = req.body;

      // Check if user exists (for forgot password)
      const existingUser = await User.findOne({ email });
      if (!existingUser) {
        const categories = await Category.find();
        const wishlist = [];
        const cart = [];
        return res.render("userviews/emailforgotpassword", {
          title: "Verify email",
          category: categories,
          wishlist,
          cart,
          error: "Email not found. Please check your email address.",
        });
      }

      await OTP.deleteMany({ email: email });

      const otp = otpGenerator.generate(6, {
        digits: true,
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
      const otpRecord = new OTP({
        email: email,
        otp: otp,
        expiresAt: Date.now() + 60 * 1000,
        purpose: "password_reset", // Add purpose field
      });

      await otpRecord.save();

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.MAILID,
          pass: process.env.PASSWORD,
        },
      });

      const mailOptions = {
        from: process.env.MAILID,
        to: email,
        subject: "Your OTP for Forgot Password",
        text: `Your OTP is ${otp}. It will expire in 60 seconds.`,
      };

      await transporter.sendMail(mailOptions);
      req.session.email = email;

      console.log("OTP sent:", otp); // For debugging - remove in production

      const categories = await Category.find();
      const wishlist = [];
      const cart = [];
      res.render("userviews/otp", {
        email,
        category: categories,
        wishlist,
        cart,
      });
    } catch (error) {
      console.error("SendOTP Error:", error);
      res.status(500).send("Internal Server Error");
    }
  },

  //reset password
  resetPassword: async (req, res) => {
    try {
      const { newPassword, confirmPassword } = req.body;

      console.log(req.body, "oooooooo");
      const email = req.session.email;

      if (newPassword !== confirmPassword) {
        return res
          .status(400)
          .json({ error: "New password and confirm password do not match" });
      }

      console.log("Email:", email);

      const existingUser = await User.findOne({ email });

      console.log("Existing user:", existingUser);

      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }

      existingUser.password = newPassword;
      await existingUser.save();

      const categories = await Category.find();
      const wishlist = [];
      const cart = [];
      return res.render("userviews/login", {
        title: "Login",
        category: categories,
        wishlist,
        cart,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  },

  walletrazorpay: async (req, res) => {
    console.log("=== WALLET RAZORPAY FUNCTION CALLED ===");
    console.log("Request body:", req.body);

    const amount = req.body.amount;
    console.log("Amount received:", amount, "Type:", typeof amount);

    const currency = "INR";
    console.log("Currency:", currency);

    const options = {
      amount: amount,
      currency: currency,
      receipt: "receipt#1",
      payment_capture: 1,
    };

    console.log("Razorpay order options:", options);
    console.log(
      "Razorpay instance check:",
      razorpay ? "Available" : "Not Available"
    );

    razorpay.orders.create(options, (err, order) => {
      if (err) {
        console.error("=== RAZORPAY ORDER CREATION ERROR ===");
        console.error("Error details:", err);
        console.error("Error message:", err.message);
        console.error("Error code:", err.code);
        res.status(500).json({
          error: "Failed to create Razorpay order",
          details: err.message,
        });
      } else {
        console.log("=== RAZORPAY ORDER CREATED SUCCESSFULLY ===");
        console.log("Order details:", order);
        console.log("Order ID:", order.id);
        console.log("Order amount:", order.amount);

        // Add key_id to response for frontend
        const response = {
          ...order,
          key_id: process.env.key_id,
        };
        console.log("Response being sent:", response);
        res.json(response);
      }
    });
  },

  topupwallet: async (req, res) => {
    console.log("=== TOPUP WALLET FUNCTION CALLED ===");
    console.log("Request body:", req.body);
    console.log("Session user:", req.session.user);

    try {
      const { amount, razorpayOrderId } = req.body; // Use consistent key name
      console.log("Amount to add:", amount, "Type:", typeof amount);
      console.log("Razorpay Order ID:", razorpayOrderId);

      const user = req.session.user;
      console.log("User from session:", user);

      if (!user || !user._id) {
        console.error("=== USER SESSION ERROR ===");
        console.error("User session not found or invalid");
        return res
          .status(401)
          .json({ error: "User session not found or invalid" });
      }

      const userId = user._id;
      console.log("User ID:", userId);

      console.log("=== FINDING WALLET ===");
      let wallet = await Wallet.findOne({ user: userId });
      console.log("Wallet found:", wallet);

      if (!wallet) {
        console.error("=== WALLET NOT FOUND ===");
        console.error("Creating new wallet for user:", userId);

        // Create new wallet if not exists
        wallet = new Wallet({
          user: userId,
          balance: Number(amount),
          walletTransactions: [
            {
              type: "credit",
              amount: Number(amount),
              description: "Wallet top-up",
              date: new Date(),
              razorpayOrderId: razorpayOrderId || null,
            },
          ],
        });

        const savedWallet = await wallet.save();
        console.log("New wallet created:", savedWallet);

        return res.status(200).json({
          message: "Wallet created and balance updated successfully",
          newBalance: savedWallet.balance,
          amount: Number(amount),
          razorpayOrderId: razorpayOrderId || null,
          transaction: savedWallet.walletTransactions[0],
        });
      }

      console.log("=== UPDATING WALLET BALANCE ===");
      console.log("Current balance:", wallet.balance);
      console.log("Amount to add:", amount);

      wallet.balance += Number(amount); // Ensure amount is a number
      const newTransaction = {
        type: "credit",
        amount: Number(amount),
        description: "Wallet top-up",
        date: new Date(),
        razorpayOrderId: razorpayOrderId || null,
      };
      wallet.walletTransactions.push(newTransaction);

      console.log("New balance before save:", wallet.balance);

      const savedWallet = await wallet.save();
      console.log("Wallet saved successfully:", savedWallet);

      res.status(200).json({
        message: "Wallet balance updated successfully",
        newBalance: savedWallet.balance,
        amount: Number(amount),
        razorpayOrderId: razorpayOrderId || null,
        transaction: newTransaction,
      });
    } catch (error) {
      console.error("=== TOPUP WALLET ERROR ===");
      console.error("Error details:", error);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Failed to update wallet balance",
        details: error.message,
      });
    }
  },
};
