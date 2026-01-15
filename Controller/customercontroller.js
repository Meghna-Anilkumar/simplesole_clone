const User = require("../models/user");
const OTP = require("../models/otpSchema");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const Category = require("../models/category");
const bcrypt = require("bcrypt");
const { generateReferralCode } = require("../utils/generatereferral");
const Wallet = require("../models/wallet");
const messages = require('../constants/messages');
const STATUS_CODES=require('../enums/statusCodes');

module.exports = {
  register: async (req, res) => {
    try {
      const { name, email, password, confirmPassword, referralCode } = req.body;

      const nameRegex = /^[A-Za-z\s]+$/;
      if (!nameRegex.test(name)) {
        const categories = await Category.find();
        return res.render("userviews/signup", {
          error: "Please enter a valid name!",
          title: "Signup",
          category: categories,
          wishlist: [],
          cart: [],
        });
      }

      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (!passwordRegex.test(password)) {
        const categories = await Category.find();
        return res.render("userviews/signup", {
          error:
            "Password should contain at least 8 characters, an uppercase letter, a lowercase letter, and a special character",
          title: "Signup",
          category: categories,
          wishlist: [],
          cart: [],
        });
      }

      if (password !== confirmPassword) {
        const categories = await Category.find();
        return res.render("userviews/signup", {
          error: "Password and Confirm Password do not match",
          title: "Signup",
          category: categories,
          wishlist: [],
          cart: [],
        });
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        const categories = await Category.find();
        return res.render("userviews/signup", {
          error: "Email already exists. Please use a different email address.",
          title: "Signup",
          category: categories,
          wishlist: [],
          cart: [],
        });
      }

      if (referralCode) {
        const referredUser = await User.findOne({ referral: referralCode });
        if (!referredUser) {
          const categories = await Category.find();
          return res.render("userviews/signup", {
            error:
              "Invalid referral code. Please enter a valid referral code if any.",
            title: "Signup",
            category: categories,
            wishlist: [],
            cart: [],
          });
        }
      }

      req.session.email = email;
      req.session.name = name;
      req.session.password = password;
      req.session.referralCode = referralCode;
      req.session.isSignup = true;

      await OTP.deleteOne({ email });

      const otp = otpGenerator.generate(6, {
        digits: true,
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });

      if (!/^[0-9]{6}$/.test(otp)) {
        console.error("Generated OTP is invalid:", otp);
        return res
          .status(500)
          .json({ error: "Failed to generate a valid OTP" });
      }

      console.log("Signup OTP:", otp);

      const otpRecord = new OTP({
        email,
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
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
        subject: "Your OTP for Signup",
        text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
      };

      await transporter.sendMail(mailOptions);

      const categories = await Category.find();
      res.render("userviews/otp", {
        email,
        category: categories,
        wishlist: [],
        cart: [],
        title: "OTP Verification",
      });
    } catch (error) {
      console.error("Error in register:", error);
      const categories = await Category.find();
      res.render("userviews/signup", {
        error: messages.INTERNAL_SERVER_ERROR,
        title: "Signup",
        category: categories,
        wishlist: [],
        cart: [],
      });
    }
  },

  sendOTP: async (req, res) => {
    try {
      const { email } = req.body;

      const existingUser = await User.findOne({ email });
      if (!existingUser) {
        const categories = await Category.find();
        return res.render("userviews/emailforgotpassword", {
          title: "Verify Email",
          category: categories,
          wishlist: [],
          cart: [],
          error: "Email not registered",
        });
      }

      await OTP.deleteOne({ email });

      const otp = otpGenerator.generate(6, {
        digits: true,
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });

      if (!/^[0-9]{6}$/.test(otp)) {
        console.error("Generated OTP is invalid:", otp);
        return res
          .status(500)
          .json({ error: "Failed to generate a valid OTP" });
      }

      console.log("Forgot Password OTP:", otp);

      const otpRecord = new OTP({
        email,
        otp,
        expiresAt: Date.now() + 60 * 1000,
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
      req.session.isSignup = false; // Flag to indicate forgot password flow

      const categories = await Category.find();
      res.render("userviews/otp", {
        email,
        category: categories,
        wishlist: [],
        cart: [],
        title: "OTP Verification",
      });
    } catch (error) {
      console.error("Error in sendOTP:", error);
      const categories = await Category.find();
      res.render("userviews/emailforgotpassword", {
        title: "Verify Email",
        category: categories,
        wishlist: [],
        cart: [],
        error: "Failed to send OTP. Please try again.",
      });
    }
  },

  verifyotp: async (req, res) => {
    try {
        const { email, otp } = req.body;

        const otpRecord = await OTP.findOne({
            email,
            expiresAt: { $gt: Date.now() },
        });

        if (!otpRecord) {
            const categories = await Category.find();
            if (req.headers["content-type"] === "application/json") {
                return res.status(400).json({ error: "Invalid or expired OTP" });
            }
            return res.render("userviews/otp", {
                email,
                category: categories,
                error: "Invalid or expired OTP",
                wishlist: [],
                cart: [],
                title: "OTP Verification",
            });
        }

        if (otp !== otpRecord.otp) {
            const categories = await Category.find();
            if (req.headers["content-type"] === "application/json") {
                return res.status(400).json({ error: "Invalid OTP" });
            }
            return res.render("userviews/otp", {
                email,
                category: categories,
                error: "Invalid OTP",
                wishlist: [],
                cart: [],
                title: "OTP Verification",
            });
        }

        await OTP.deleteOne({ email });

        const categories = await Category.find();
        if (req.session.isSignup) {
            const { name, password, referralCode } = req.session;
            const newUser = new User({
                name,
                email,
                password,
                referral: generateReferralCode(),
            });
            await newUser.save();

            if (referralCode) {
                const referredBy = await User.findOne({ referral: referralCode });
                console.log("referred by:", referredBy.name);
                let referrerWallet = await Wallet.findOne({ user: referredBy._id });
                if (!referrerWallet) {
                    referrerWallet = new Wallet({
                        user: referredBy._id,
                        balance: 100,
                        transactiontype: "Referral Bonus",
                    });
                } else {
                    referrerWallet.balance += 100;
                    referrerWallet.transactiontype = "Referral Bonus";
                }

                await referrerWallet.save();
                console.log("Referral bonus credited to:", referredBy.email);
            } else {
                console.log("Invalid referral code");
            }

            req.session.email = null;
            req.session.name = null;
            req.session.password = null;
            req.session.referralCode = null;
            req.session.isSignup = null;

            if (req.headers["content-type"] === "application/json") {
                return res.status(200).json({
                    message: "Account created successfully! Please log in.",
                    redirect: "/login"
                });
            }
            return res.render("userviews/login", {
                message: "Account created successfully! Please log in.",
                title: "Login",
                category: categories,
                wishlist: [],
                cart: [],
            });
        } else {
            if (req.headers["content-type"] === "application/json") {
                return res.status(200).json({
                    redirect: "/resetpassword"
                });
            }
            return res.render("userviews/resetpassword", {
                email,
                category: categories,
                wishlist: [],
                cart: [],
                title: "Reset Password",
            });
        }
    } catch (error) {
        console.error("Error in verifyotp:", error);
        const categories = await Category.find();
        if (req.headers["content-type"] === "application/json") {
            return res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ error: "Internal Server Error" });
        }
        return res.render("userviews/otp", {
            email: req.body.email || "",
            category: categories,
            error: "Internal Server Error",
            wishlist: [],
            cart: [],
            title: "OTP Verification",
        });
    }
},

  resetPassword: async (req, res) => {
    try {
      const { email, newPassword, confirmPassword } = req.body;

      if (newPassword !== confirmPassword) {
        const categories = await Category.find();
        return res.render("userviews/resetpassword", {
          email,
          category: categories,
          wishlist: [],
          cart: [],
          title: "Reset Password",
          error: "Passwords do not match",
        });
      }

      const passwordRegex =
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        const categories = await Category.find();
        return res.render("userviews/resetpassword", {
          email,
          category: categories,
          wishlist: [],
          cart: [],
          title: "Reset Password",
          error:
            "Password must be at least 8 characters, with one uppercase, one lowercase, one number, and one special character",
        });
      }

      const user = await User.findOne({ email });
      if (!user) {
        const categories = await Category.find();
        return res.render("userviews/resetpassword", {
          email,
          category: categories,
          wishlist: [],
          cart: [],
          title: "Reset Password",
          error: "User not found",
        });
      }

      user.password = await bcrypt.hash(newPassword, 10);
      await user.save();

      req.session.email = null;

      const categories = await Category.find();
      res.render("userviews/login", {
        message: "Password reset successfully! Please log in.",
        title: "Login",
        category: categories,
        wishlist: [],
        cart: [],
      });
    } catch (error) {
      console.error("Error in resetPassword:", error);
      const categories = await Category.find();
      res.render("userviews/resetpassword", {
        email: req.body.email || "",
        category: categories,
        error: messages.INTERNAL_SERVER_ERROR,
        wishlist: [],
        cart: [],
        title: "Reset Password",
      });
    }
  },

  resendOTP: async (req, res) => {
    try {
      const email = req.body.email || req.session.email;
      console.log("Resend OTP Request:", { method: req.method, email });

      if (!email) {
        console.error("No email found in request or session");
        return res
          .status(400)
          .json({ error: "No email found in request or session" });
      }

      const existingUser = await User.findOne({ email });
      if (!existingUser && !req.session.isSignup) {
        console.error("Email not registered for forgot password:", email);
        return res.status(400).json({ error: "Email not registered" });
      }

      await OTP.deleteOne({ email });

      const otp = otpGenerator.generate(6, {
        digits: true,
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });

      if (!/^[0-9]{6}$/.test(otp)) {
        console.error("Generated OTP is invalid:", otp);
        return res
          .status(500)
          .json({ error: "Failed to generate a valid OTP" });
      }

      console.log("Resend OTP:", otp);

      const otpRecord = new OTP({
        email,
        otp,
        expiresAt: Date.now() + 60 * 1000,
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
        subject: req.session.isSignup
          ? "Your New OTP for Signup"
          : "Your New OTP for Forgot Password",
        text: `Your new OTP is ${otp}. It will expire in 60 seconds.`,
      };

      await transporter.sendMail(mailOptions);

      if (req.headers["content-type"] === "application/json") {
        return res.status(200).json({ message: "New OTP sent successfully" });
      }

      const categories = await Category.find();
      res.render("userviews/otp", {
        email,
        category: categories,
        wishlist: [],
        cart: [],
        message: "New OTP sent successfully",
        title: "OTP Verification",
      });
    } catch (error) {
      console.error("Error in resendOTP:", error);
      if (req.headers["content-type"] === "application/json") {
        return res.status(500).json({ error: "Internal Server Error" });
      }
      const categories = await Category.find();
      res.render("userviews/otp", {
        email: email || "",
        category: categories,
        error: "Failed to resend OTP. Please try again.",
        wishlist: [],
        cart: [],
        title: "OTP Verification",
      });
    }
  },

  customers: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const search = req.query.search || "";

      const searchQuery = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };

      const totalUsers = await User.countDocuments(search ? searchQuery : {});
      const totalPages = Math.ceil(totalUsers / limit);

      const users = await User.find(search ? searchQuery : {})
        .skip(skip)
        .limit(limit)
        .exec();

      res.render("adminviews/customers", {
        title: "Customers",
        users: users,
        page: page,
        limit: limit,
        totalPages: totalPages,
        search: search,
      });
    } catch (err) {
      res.json({ message: err.message });
    }
  },

  blockUser: async (req, res) => {
    try {
      const userId = req.body.userId;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).send("User not found");
      }

      user.blocked = !user.blocked;
      await user.save();

      res.redirect("/customers");
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },
};
