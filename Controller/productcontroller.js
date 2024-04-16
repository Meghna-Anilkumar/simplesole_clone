const Product = require('../models/product')
const Category = require('../models/category');
const multer = require('multer')
const fs = require('fs')
const categorycontroller = require('../Controller/categorycontroller');
const Wishlist = require('../models/wishlist')
const ProductOffer = require('../models/productoffermodel')
const CategoryOffer = require('../models/categoryoffer')
const Cart = require('../models/cartSchema');


module.exports = {

  //to get add product page  
  addProduct: async (req, res) => {
    const category = await Category.find().exec();
    res.render('adminviews/addproduct',
      {
        title: 'Add Product',
        category: category
      })
  },

  //get all products
  getproducts: async (req, res) => {
    try {
      const product = await Product.find().populate({
        path: 'category',
        select: 'name',
      }).exec();
      res.render('adminviews/products', {
        title: 'Products',
        product: product
      });
    } catch (err) {
      res.json({ message: err.message });
    }
  },


  //insert a new product into database
  addnewproduct: async (req, res) => {
    try {
      const product = new Product({
        name: req.body.name,
        description: req.body.description,
        category: req.body.category,
        price: req.body.price,
        stock: req.body.stock,
        size: req.body.size,
        color: req.body.color,
        images: req.files.map(file => file.filename)
      })
      await product.save()
      req.session.message = {
        type: 'success',
        message: 'Product added successfully'
      };

      res.redirect('/products');
    } catch (error) {
      console.error(error);
      res.json({ message: error.message, type: 'danger' });
    }
  },

  //edit a product
  editproduct: async (req, res) => {
    try {
      let id = req.params.id;
      const product = await Product.findById(id).exec()

      if (!product) {
        res.redirect('/products');
        return;
      }

      const category = await Category.find().exec();

      res.render('adminviews/editproduct', {
        title: 'Edit Product',
        product: product,
        category: category,
        existingImages: product.images
      });
    } catch (error) {
      console.error(error);
      res.redirect('/products');
    }
  },

  // Update user route (update button click event)
  updateproduct: async (req, res) => {
    try {
      const id = req.params.id;
      let newImages = '';

      if (req.file) {
        newImages = req.file.filename;

        try {
          await fs.unlinkSync('./uploads/' + req.body.old_images);
        } catch (err) {
          console.log(err);
        }
      } else {
        newImages = req.body.old_images;
      }

      const existingProduct = await Product.findById(id).exec();

      let updatedImages = [...existingProduct.images];

      console.log('req.body.deletedImages:', req.body.deletedImages);

      if (req.body.deletedImages) {
        try {
          const product = await Product.findById(id);

          if (product && Array.isArray(product.images)) {
            const deletedImages = req.body.deletedImages.split(',').map(image => image.trim());
            updatedImages = product.images.filter(image => !deletedImages.includes(image));

            product.images = updatedImages;

            await product.save();

            deletedImages.forEach(deletedImage => {
              console.log(updatedImages.includes(deletedImage)
                ? 'Image Removed from Database:' : 'Image Not Found in Database:', deletedImage);
            });
          }
        } catch (err) {
          console.log(err);
        }
      }

      console.log('Updated Images:', updatedImages);

      updatedImages = [...updatedImages, ...req.files.map(file => file.filename)];

      const updatedProduct = {
        name: req.body.name,
        description: req.body.description,
        category: req.body.category,
        price: req.body.price,
        stock: req.body.stock,
        size: req.body.size,
        color: req.body.color,
        images: updatedImages,
      };

      let categoryOfferPrice = updatedProduct.price; 
      const categoryOffer = await CategoryOffer.findOne({ category: updatedProduct.category }).exec();
      if (categoryOffer) {
        const discountPercentage = categoryOffer.discountPercentage;
        const discountAmount = (updatedProduct.price * discountPercentage) / 100;
        categoryOfferPrice = updatedProduct.price - discountAmount;
      }

      updatedProduct.categoryofferprice = categoryOfferPrice;

      const result = await Product.findByIdAndUpdate(id, updatedProduct);

      req.session.message = {
        type: 'success',
        message: 'Product updated successfully!',
      };

      console.log('Product updated successfully');
      res.redirect('/products');
    } catch (err) {
      console.error(err);
      res.json({ message: err.message, type: 'danger' });
    }
  },


  //to display products categorywise on user side
  getproductsCategorywise: async (req, res) => {
    try {
      const categoryId = req.params.categoryId;
      const selectedCategory = await Category.findById(categoryId);
      const products = await Product.find({ category: categoryId });
      const categoryOffers = await CategoryOffer.find({ category: categoryId })


      // Fetch the cart here
      const user = req.session.user;
      const cart = await Cart.findOne({ user }).populate('items.product').exec();
      const wishlist = await Wishlist.findOne({ user });

      res.render('userviews/viewproductsCategorywise', {
        title: 'Products in category',
        category: selectedCategory,
        selectedCategory: selectedCategory,
        products: products,
        categoryOffers: categoryOffers,
        cart: cart,
        wishlist: wishlist
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },




  //get product details
  getproductdetails: async (req, res) => {
    try {
      const productId = req.params.id;
      const product = await Product.findById(productId).populate({ path: 'category', select: 'name-_id' });

      if (!product) {
        return res.status(404).render('error', { message: 'Product not found' });
      }

      const user = req.session.user;
      let productInWishlist = false;
      const cart = await Cart.findOne({ user }).populate('items.product').exec();
      var wishlist = await Wishlist.findOne({ user });

      if (user) {
        wishlist = await Wishlist.findOne({ user: user._id });

        if (wishlist) {
          productInWishlist = wishlist.items.some(item => item.product.toString() === productId);
        }
      }

      const products = await Product.find();
      const selectedCategory = product.category;

      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
      });

      res.render('userviews/productdetails', {
        title: 'Products in category',
        category: selectedCategory,
        selectedCategory: selectedCategory,
        products: products,
        product: product,
        productInWishlist: productInWishlist,
        productOffers: productOffers,
        wishlist: wishlist,
        cart
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },

  //block and unblock a product
  blockProduct: async (req, res) => {
    const productId = req.body.productId;

    try {

      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).render('userviews/404page');
      }

      product.blocked = !product.blocked;
      await product.save();

      res.redirect('/products');
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },


  //get all products page
  getAllProducts: async (req, res) => {
    try {
      let allProducts;
      const category = await Category.find().exec();
      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
      }).populate('product').exec();
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
      }).populate('category').exec();

      if (req.query.query) {
        const searchQuery = req.query.query;
        const regex = new RegExp(searchQuery, 'i');
        allProducts = await Product.find({ name: regex });
      } else {
        allProducts = await Product.find();
      }

      if (req.query.sortOption === 'priceLowToHigh') {
        allProducts.sort((a, b) => a.price - b.price);
      } else if (req.query.sortOption === 'priceHighToLow') {
        allProducts.sort((a, b) => b.price - a.price);
      }

      const perPage = 12;
      const page = parseInt(req.query.page) || 1;
      const totalProducts = allProducts.length;
      const totalPages = Math.ceil(totalProducts / perPage);

      const skip = (page - 1) * perPage;

      allProducts = allProducts.slice(skip, skip + perPage);
      const user = req.session.user;
      const cart = await Cart.findOne({ user }).populate('items.product').exec();

      res.render('userviews/allproducts', {
        title: 'All Products',
        allProducts: allProducts,
        category: category,
        productOffers: productOffers,
        categoryOffers: categoryOffers,
        currentPage: page,
        totalPages: totalPages,
        wishlist: req.session.wishlist,
        cart:cart
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },



  //search products
  searchproducts: async (req, res) => {
    try {
      const searchQuery = req.query.query;

      const allProducts = await Product.find();
      const category = await Category.find().exec();

      const searchResults = await Product.find({ name: { $regex: new RegExp(searchQuery, 'i') } });

      res.render('userviews/allproducts', {
        title: 'Search Results',
        allProducts: allProducts,
        searchResults: searchResults,
        category: category
      })
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },

  //filter products
  filterproducts: async (req, res) => {
    try {
      let filteredProducts = await Product.find();

      if (req.query.color) {
        filteredProducts = filteredProducts.filter(product => product.color === req.query.color);
      }

      if (req.query.size) {
        filteredProducts = filteredProducts.filter(product => product.size.includes(req.query.size));
      }

      if (req.query.minPrice && req.query.maxPrice) {
        const minPrice = parseFloat(req.query.minPrice);
        const maxPrice = parseFloat(req.query.maxPrice);
        filteredProducts = filteredProducts.filter(product => product.price >= minPrice && product.price <= maxPrice);
      }

      res.json(filteredProducts);
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },


};








