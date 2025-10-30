const express = require('express');
const router = express.Router();

const userController = require('../Controller/usercontroller');
const productController = require('../Controller/productcontroller');
const cartController = require('../Controller/cartcontroller');
const orderController = require('../Controller/ordercontroller');
const wishlistController = require('../Controller/wishlistcontroller');
const couponController = require('../Controller/couponcontroller');
const isAuth = require('../middlewares/isAuth');

// user
router.get(['/', '/home'], userController.homepage);
router.get('/signup', isAuth.islogged, userController.signup);
router.get('/login', isAuth.userexist, userController.loginpage);
router.post('/login', userController.tologin);
router.get('/Login', userController.Login);
router.get('/usericon', userController.userIcon);
router.post('/editprofiledetails', userController.editprofiledetails);

// products
router.get('/category/:categoryId', productController.getproductsCategorywise);
router.get('/products/:id', productController.getproductdetails);
router.get('/seeallproducts', productController.getAllProducts);
router.get('/allProducts', productController.getAllProducts);
router.get('/filteredProducts', productController.filterproducts);
router.get('/productOffers', productController.getProductOffers);
router.get('/categoryOffers', productController.getCategoryOffers);

// address
router.get('/address', userController.getaddressbook);
router.post('/saveaddress', userController.addnewaddress);
router.get('/getaddresses', userController.getaddresses);
router.post('/deleteaddress/:id', userController.deleteAddress);
router.get('/getaddresses/:id', userController.getAddressById);
router.post('/updateAddress/:id', userController.editAddress);

// change password
router.get('/changepassword', userController.changepasswordpage);
router.post('/changepassword', userController.changepassword);

// cart
router.get('/cart', isAuth.checkAuth, cartController.getcart);
router.post('/cart/add', isAuth.checkAuth, cartController.addtocart);
router.post('/updateQuantity/:productId/:change', cartController.updatequantity);
router.post('/removeItem/:productId', cartController.deleteitem);
router.get('/getCartTotal', isAuth.checkAuth, cartController.getCartTotal);
router.post('/updateSize/:productId/:newSize', cartController.updateSize);
router.post('/validateStockBeforeCheckout', cartController.validateStockBeforeCheckout);

// checkout page
router.get('/proceedtocheckout', isAuth.checkAuth, orderController.checkoutpage);

// place order
router.post('/placeOrder', isAuth.checkAuth, orderController.placeorder);
router.post('/process-payment', isAuth.checkAuth, orderController.processPayment);
router.get('/successpage', isAuth.checkAuth, orderController.getsuccesspage);
router.post('/createRazorpayOrder', isAuth.checkAuth, orderController.createRazorpayOrder);
router.post('/payment-failure', isAuth.checkAuth, orderController.paymentFailure);

// my orders
router.get('/orders', isAuth.checkAuth, orderController.myorders);
router.get('/orderdetails/:orderId', isAuth.checkAuth, orderController.orderdetails);
router.post('/confirmCancellation/:orderId', orderController.confirmcancellation);
router.post('/confirmItemCancellation/:orderId/:index', orderController.confirmItemCancellation);
router.post('/confirmReturn/:orderId', isAuth.checkAuth, orderController.returnorder);
router.get('/download-invoice/:orderId', orderController.downloadinvoice);

// wishlist
router.get('/wishlist', wishlistController.getwishlistpage);
router.post('/addtowishlist', wishlistController.addtowishlist);
router.post('/removefromwishlist', wishlistController.removefromwishlist);

// wallet
router.get('/wallet', orderController.getwalletpage);
router.post('/razorpay/wallet', userController.walletrazorpay);
router.post('/wallet/topup', userController.topupwallet);

// coupons
router.get('/coupons', couponController.coupons);
router.post('/applyCoupon', couponController.applyCoupon);
router.post('/removeCoupon', couponController.removeCoupon);

// forgot password
router.get('/forgotpassword', userController.verifyemail);
router.post('/forgot-password', userController.sendOTP);
router.get('/resetpassword', userController.getResetPasswordPage); // this page is for forgot password
router.post('/reset-password', userController.resetPassword);

module.exports = router;
