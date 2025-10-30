const express = require('express');
const router = express.Router();
const { diskUpload, memoryUpload } = require('../middlewares/multer');
const customerController = require('../Controller/customercontroller');
const adminController = require('../Controller/admincontroller');
const productController = require('../Controller/productcontroller');
const categoryController = require('../Controller/categorycontroller');
const adminAuth = require('../middlewares/adminAuth');
const adminOrderController = require('../Controller/adminordercontroller');
const couponController = require('../Controller/couponcontroller');
const productOfferController = require('../Controller/productoffercontroller');
const categoryOfferController = require('../Controller/categoryoffercontroller');
const bodyParser = require('body-parser');

router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json());

// admin login/signup
router.get('/adminlogin', adminAuth.isadminlogged, adminController.toadminlogin);
router.post('/signup', customerController.register);
router.get('/dashboard', adminAuth.adminexist, adminController.dashboard);
router.get('/customers', adminAuth.adminexist, customerController.customers);
router.post('/block-user', customerController.blockUser);
router.get('/admin', adminAuth.isadminlogged, adminController.toadminlogin);
router.post('/adminlogin', adminController.adminlogin);

// categories
router.get('/addcategory', categoryController.addCategory);
router.post('/addCategory', categoryController.addNewCat);
router.get('/categories', adminAuth.adminexist, categoryController.getcategories);
router.get('/editCategory/:id', categoryController.editcategory);
router.post('/updateCategory/:id', categoryController.updatecategory);
router.post('/blockCat', categoryController.blockCategory);

// products
router.get('/products', adminAuth.adminexist, productController.getproducts);
router.get('/addProduct', productController.addProduct);
router.post('/addProduct', express.urlencoded({ extended: true }), productController.addnewproduct);
router.get('/editProduct/:id', productController.editproduct);
router.post('/updateProduct/:id', express.urlencoded({ extended: true }), diskUpload, productController.updateproduct);
router.post('/blockProduct', productController.blockProduct);

// otp verification
router.post('/verify-otp', customerController.verifyotp);
router.get('/resend-otp', customerController.resendOTP);
router.post('/resend-otp', customerController.resendOTP);

// admin logout
router.get('/adminlogout', adminController.adminlogout);

// orders
router.get('/adminorders', adminOrderController.orderspage);
router.get('/ordersview/:id', adminOrderController.adminvieworder);
router.post('/updateOrderStatus/:orderId', adminOrderController.updateorderstatus);

// coupons
router.get('/coupon', couponController.couponpage);
router.post('/submitcoupon', couponController.createcoupon);
router.get('/coupon', couponController.getCoupons);
router.post('/updatecoupon', couponController.editCoupon);
router.post('/deletecoupon/:id', couponController.deleteCoupon);

// product offers
router.get('/productoffer', productOfferController.getproductofferpage);
router.post('/save-product-offer', productOfferController.saveProductOffer);
router.get('/productoffer', productOfferController.getproductoffers);
router.post('/update-product-offer', productOfferController.updateProductOffer);
router.post('/delete-product-offer/:id', productOfferController.deleteproductoffer);

// category offers
router.get('/categoryoffer', categoryOfferController.getcategoryofferspage);
router.post('/save-category-offer', categoryOfferController.saveCategoryOffer);
router.post('/update-category-offer/:id', categoryOfferController.updateCategoryOffer);
router.post('/delete-category-offer/:id', categoryOfferController.deleteCategoryOffer);

// sales report
router.get('/generatesalesreport', adminController.generatesalesreport);
router.get('/generatepdf', adminController.generatepdf);

// crop image
router.post('/upload-cropped-image', memoryUpload, productController.uploadCroppedImage);

// return requests
router.get('/returnrequests', adminOrderController.getreturnrequestspage);
router.post('/returnrequests/:orderId/accept', adminOrderController.acceptreturn);
router.post('/returnrequests/:orderId/reject', adminOrderController.rejectreturn);

module.exports = router;
