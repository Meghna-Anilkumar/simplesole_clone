const express = require('express')
const session = require('express-session')
const router = express.Router()
const User = require('../models/user')
const multer = require('multer')
const fs = require('fs')
const usercontroller = require('../Controller/usercontroller');
const productcontroller = require('../Controller/productcontroller');
const bcrypt = require('bcrypt')
const categorycontroller = require('../Controller/categorycontroller');
const isAuth = require('../middlewares/isAuth')
const UserDetails = require('../models/userdetails')
const Wishlist = require('../models/wishlist');
const cartcontroller = require('../Controller/cartcontroller')
const checkoutcontroller = require('../Controller/checkoutcontroller')
const ordercontroller = require('../Controller/ordercontroller')
const wishlistcontroller = require('../Controller/wishlistcontroller')
const couponcontroller=require('../Controller/couponcontroller')

//user
router.get(['/', '/home'], usercontroller.homepage)
router.get('/signup', isAuth.islogged, usercontroller.signup)
router.get('/login', isAuth.userexist, usercontroller.loginpage)
router.post('/login', usercontroller.tologin)
router.get('/Login', usercontroller.Login)
router.get('/usericon', usercontroller.userIcon)
router.post('/editprofiledetails', usercontroller.editprofiledetails)

//products
router.get('/category/:categoryId', productcontroller.getproductsCategorywise)
router.get('/products/:id', productcontroller.getproductdetails)
router.get('/seeallproducts', productcontroller.getAllProducts)
router.get('/search', productcontroller.getAllProducts)

//address
router.get('/address', usercontroller.getaddressbook)
router.post('/saveaddress', usercontroller.addnewaddress)
router.get('/getaddresses', usercontroller.getaddresses)
router.post('/deleteaddress/:id', usercontroller.deleteAddress)
router.post('/updateAddress/:addressId', usercontroller.editAddress)

//change password
router.get('/changepassword', usercontroller.changepasswordpage)
router.post('/changepassword', usercontroller.changepassword)

//cart
router.get('/cart', isAuth.checkAuth, cartcontroller.getcart)
router.post('/cart/add', isAuth.checkAuth, cartcontroller.addtocart)
router.post('/updateQuantity/:productId/:change', cartcontroller.updatequantity)
router.post('/removeItem/:productId', cartcontroller.deleteitem)

//checkout page
router.get('/proceedtocheckout', isAuth.checkAuth, checkoutcontroller.checkoutpage)

//place order
router.post('/placeOrder', isAuth.checkAuth, ordercontroller.placeorder)
router.post('/process-payment', isAuth.checkAuth, ordercontroller.processPayment);
router.get('/successpage', isAuth.checkAuth, ordercontroller.getsuccesspage)

//my orders
router.get('/orders', isAuth.checkAuth, ordercontroller.myorders)
router.get('/orderdetails/:orderId', isAuth.checkAuth, ordercontroller.orderdetails)
router.post('/confirmCancellation/:orderId', ordercontroller.confirmcancellation)
router.post('/confirmItemCancellation/:orderId/:index', ordercontroller.confirmItemCancellation)
router.post('/confirmReturn/:orderId', isAuth.checkAuth, ordercontroller.returnorder)
router.get('/download-invoice/:orderId',ordercontroller.downloadinvoice)


//wishlist
router.get('/wishlist', wishlistcontroller.getwishlistpage)
router.post('/addtowishlist', wishlistcontroller.addtowishlist)
router.post('/removefromwishlist', wishlistcontroller.removefromwishlist)


//wallet
router.get('/wallet', ordercontroller.getwalletpage)

//coupons
router.get('/coupons', couponcontroller.coupons)
router.post('/applyCoupon',couponcontroller.applyCoupon)
router.post('/removeCoupon',couponcontroller.removeCoupon)


//forgot password
router.get('/forgotpassword',usercontroller.verifyemail)
router.post('/forgot-password',usercontroller.sendOTP)
router.post('/reset-password',usercontroller.resetPassword)

//filteredproducts
router.get('/filteredProducts',productcontroller.filterproducts)

module.exports = router