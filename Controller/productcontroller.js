const Product = require('../models/product');
const Category = require('../models/category');
const fs = require('fs');
const Wishlist = require('../models/wishlist');
const ProductOffer = require('../models/productoffermodel');
const CategoryOffer = require('../models/categoryoffer');
const Cart = require('../models/cartSchema');
const { compressImages } = require('../utils/compress');
const  HttpStatusCode  = require('../enums/statusCodes')

module.exports = {
  //to get add product page  
  addProduct: async (req, res) => {
    const category = await Category.find().exec();
    res.render('adminviews/addproduct', {
      title: 'Add Product',
      category: category
    });
  },

  //get all products
  getproducts: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;

      const product = await Product.find()
        .populate({ path: 'category', select: 'name' })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec();

      const totalProducts = await Product.countDocuments();

      const totalPages = Math.ceil(totalProducts / limit);

      res.render('adminviews/products', {
        title: 'Products',
        product: product,
        totalPages: totalPages,
        currentPage: page,
        limit: limit
      });
    } catch (err) {
      res.json({ message: err.message });
    }
  },

  //insert a new product into database
  addnewproduct: async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        throw new Error("Please upload at least one image.");
      }

      await compressImages(req.files);

      const product = new Product({
        name: req.body.name,
        description: req.body.description,
        category: req.body.category,
        price: req.body.price,
        stock: req.body.stock,
        size: req.body.size,
        color: req.body.color,
        images: req.files.map(file => file.filename)
      });

      await product.save();

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
      const product = await Product.findById(id).exec();

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
      res.redirect('/products');z
    }
  },

  croppedimageupload: async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(HttpStatusCode.BAD_REQUEST).json({ error: 'No file uploaded' });
      }

      const filenames = req.files.map(file => file.filename);
      res.status(HttpStatusCode.OK).json({ filenames: filenames });
    } catch (error) {
      console.error(error);
      res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
    }
  },

  // Update user route 
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

      if (req.body.deletedImages) {
        const deletedImages = req.body.deletedImages.split(',').map(image => image.trim());
        updatedImages = existingProduct.images.filter(image => !deletedImages.includes(image));

        existingProduct.images = updatedImages;
        await existingProduct.save();

        deletedImages.forEach(deletedImage => {
          console.log(updatedImages.includes(deletedImage)
            ? 'Image Removed from Database:' : 'Image Not Found in Database:', deletedImage);
        });
      }

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

      await Product.findByIdAndUpdate(id, updatedProduct);

      req.session.message = {
        type: 'success',
        message: 'Product updated successfully!',
      };

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
      const categoryOffers = await CategoryOffer.find({ category: categoryId });

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
      console.log('Received productId:', productId, 'kkkkkkkkkkkkkkkkkk'); // Enhanced debug log
      const product = await Product.findById(productId).populate({ path: 'category', select: 'name-_id' });

      if (!product) {
        console.log('Product not found for ID:', productId);
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

      console.log('Rendering product details for ID:', productId); // Debug log
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
      console.error('Error in getproductdetails:', error);
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

  //get all products page with combined search, sort, and filter
 getAllProducts: async (req, res) => {
    try {
      const perPage = 12;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * perPage;

      // Build the query object
      let query = { blocked: false }; // Exclude blocked products
      if (req.query.query) {
        const searchQuery = req.query.query;
        query.name = { $regex: new RegExp(searchQuery, 'i') };
      }

      // Fetch all products with filters
      let allProducts = await Product.find(query)
        .populate('category')
        .exec();

      // Apply color filter
      if (req.query.color) {
        allProducts = allProducts.filter(product => product.color === req.query.color);
      }

      // Apply size filter
      if (req.query.size) {
        allProducts = allProducts.filter(product => product.size.includes(req.query.size));
      }

      // Apply sorting
      if (req.query.sortOption === 'priceLowToHigh') {
        allProducts.sort((a, b) => a.price - b.price);
        console.log('Sorted by priceLowToHigh:', allProducts.map(p => p.price));
      } else if (req.query.sortOption === 'priceHighToLow') {
        allProducts.sort((a, b) => b.price - a.price);
        console.log('Sorted by priceHighToLow:', allProducts.map(p => p.price));
      }

      // Pagination
      const totalProducts = allProducts.length;
      const totalPages = Math.ceil(totalProducts / perPage);
      allProducts = allProducts.slice(skip, skip + perPage);

      const category = await Category.find().exec();
      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
      }).populate('product').exec();
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() }
      }).populate('category').exec();

      const user = req.session.user;
      const cart = await Cart.findOne({ user }).populate('items.product').exec();

      // Check if this is an AJAX request (e.g., via fetch)
      if (req.headers['x-requested-with'] === 'XMLHttpRequest' || req.query.json) {
        res.json(allProducts); // Return JSON for AJAX updates
      } else {
        res.render('userviews/allproducts', {
          title: 'All Products',
          allProducts: allProducts,
          category: category,
          productOffers: productOffers,
          categoryOffers: categoryOffers,
          currentPage: page,
          totalPages: totalPages,
          wishlist: req.session.wishlist,
          cart: cart,
          searchQuery: req.query.query
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },

  // filterproducts route with combined search, sort, and filter
  filterproducts: async (req, res) => {
    try {
      let filteredProducts;

      // Build the initial query
      let query = { blocked: false }; // Exclude blocked products
      if (req.query.query) {
        const searchQuery = req.query.query;
        query.name = { $regex: new RegExp(searchQuery, 'i') };
      }

      // Fetch products with initial query
      filteredProducts = await Product.find(query)
        .populate('category')
        .exec();

      // Apply color filter
      if (req.query.color) {
        filteredProducts = filteredProducts.filter(product => product.color === req.query.color);
      }

      // Apply size filter
      if (req.query.size) {
        filteredProducts = filteredProducts.filter(product => product.size.includes(req.query.size));
      }

      // Apply sorting
      if (req.query.sortOption === 'priceLowToHigh') {
        filteredProducts.sort((a, b) => a.price - b.price);
        console.log('Filtered and sorted by priceLowToHigh:', filteredProducts.map(p => p.price));
      } else if (req.query.sortOption === 'priceHighToLow') {
        filteredProducts.sort((a, b) => b.price - a.price);
        console.log('Filtered and sorted by priceHighToLow:', filteredProducts.map(p => p.price));
      }

      res.json(filteredProducts);
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },
 
};