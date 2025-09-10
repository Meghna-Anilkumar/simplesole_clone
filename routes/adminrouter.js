const express = require('express')
const router = express.Router()
const { diskUpload, memoryUpload } = require('../middlewares/multer');
const customercontroller = require('../Controller/customercontroller');
const admincontroller = require('../Controller/admincontroller');
const productcontroller = require('../Controller/productcontroller');
const categorycontroller = require('../Controller/categorycontroller');
const adminAuth = require('../middlewares/adminAuth')
const adminordercontroller = require('../Controller/adminordercontroller')
const couponcontroller = require('../Controller/couponcontroller')
const productoffercontroller = require('../Controller/productoffercontroller')
const categoryoffercontroller = require('../Controller/categoryoffercontroller')
const bodyParser = require('body-parser');
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json());


router.get('/adminlogin', adminAuth.isadminlogged, admincontroller.toadminlogin)
router.post('/signup', customercontroller.register)
router.get('/dashboard', adminAuth.adminexist, admincontroller.dashboard)
router.get('/customers', adminAuth.adminexist, customercontroller.customers)
router.post('/block-user', customercontroller.blockUser);
router.get('/admin', adminAuth.isadminlogged, admincontroller.toadminlogin)
router.post('/adminlogin', admincontroller.adminlogin)
router.get('/addcategory', categorycontroller.addCategory)
router.post('/addCategory', categorycontroller.addNewCat)
router.get('/categories', adminAuth.adminexist, categorycontroller.getcategories)
router.get('/editCategory/:id', categorycontroller.editcategory)
router.post('/updateCategory/:id', categorycontroller.updatecategory)
router.post('/blockCat', categorycontroller.blockCategory)
router.get('/products', adminAuth.adminexist, productcontroller.getproducts)
router.get('/addProduct', productcontroller.addProduct)
router.post('/addProduct', express.urlencoded({ extended: true }), productcontroller.addnewproduct)
router.get('/editProduct/:id', productcontroller.editproduct)
router.post('/updateProduct/:id', express.urlencoded({ extended: true }), diskUpload, productcontroller.updateproduct);
router.post('/verify-otp', customercontroller.verifyotp)
router.post('/blockProduct', productcontroller.blockProduct)


//admin logout
router.get('/adminlogout', admincontroller.adminlogout)

//orders
router.get('/adminorders', adminordercontroller.orderspage)
router.get('/ordersview/:id', adminordercontroller.adminvieworder)
router.post('/updateOrderStatus/:orderId', adminordercontroller.updateorderstatus)

//coupons
router.get('/coupon', couponcontroller.couponpage)
router.post('/submitcoupon', couponcontroller.createcoupon)
router.get('/coupon', couponcontroller.getCoupons)
router.post('/updatecoupon', couponcontroller.editCoupon);
router.post('/deletecoupon/:id', couponcontroller.deleteCoupon)

//product offers
router.get('/productoffer', productoffercontroller.getproductofferpage)
router.post('/save-product-offer', productoffercontroller.saveProductOffer)
router.get('/productoffer', productoffercontroller.getproductoffers)
router.post('/update-product-offer', productoffercontroller.updateProductOffer)
router.post('/delete-product-offer/:id', productoffercontroller.deleteproductoffer)

//category offers
router.get('/categoryoffer', categoryoffercontroller.getcategoryofferspage)
router.post('/save-category-offer', categoryoffercontroller.saveCategoryOffer)
router.post('/update-category-offer/:id', categoryoffercontroller.updateCategoryOffer)
router.post('/delete-category-offer/:id', categoryoffercontroller.deleteCategoryOffer)


//sales report
router.get('/generatesalesreport', admincontroller.generatesalesreport)
router.get('/generatepdf', admincontroller.generatepdf)

//resend otp
router.get('/resend-otp', customercontroller.resendOTP)
router.post('/resend-otp', customercontroller.resendOTP);

//crop image
router.post('/upload-cropped-image', memoryUpload, productcontroller.uploadCroppedImage);

//return requests
router.get('/returnrequests',adminordercontroller.getreturnrequestspage)
router.post('/returnrequests/:orderId/accept',adminordercontroller.acceptreturn)
router.post('/returnrequests/:orderId/reject',adminordercontroller.rejectreturn)




module.exports = router