const Product = require("../models/product");
const Category = require("../models/category");
const Wishlist = require("../models/wishlist");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const Cart = require("../models/cartSchema");
const cloudinary = require("cloudinary").v2;
const { HttpStatusCode } = require("../enums/statusCodes");

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = {
  // Get add product page
  addProduct: async (req, res) => {
    const category = await Category.find().exec();
    res.render("adminviews/addproduct", {
      title: "Add Product",
      category: category,
    });
  },

  // Get all products
  getproducts: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const search = req.query.search || "";

      // Build search query
      const searchQuery = search
        ? {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { "category.name": { $regex: search, $options: "i" } },
            ],
          }
        : {};

      // Fetch products with pagination and search
      const product = await Product.find(searchQuery)
        .populate({ path: "category", select: "name" })
        .skip(skip)
        .limit(limit)
        .exec();

      // Get total count of matching products
      const totalProducts = await Product.countDocuments(searchQuery);

      const totalPages = Math.ceil(totalProducts / limit);

      res.render("adminviews/products", {
        title: "Products",
        product: product,
        totalPages: totalPages,
        currentPage: page,
        limit: limit,
        search: search,
      });
    } catch (err) {
      console.error(err);
      res.json({ message: err.message, type: "danger" });
    }
  },

  // Insert a new product into database
  addnewproduct: async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        throw new Error("Please upload at least one image.");
      }

      // Upload images to Cloudinary
      const uploadPromises = req.files.map((file) =>
        cloudinary.uploader.upload(file.path, {
          folder: "products",
          resource_type: "image",
        })
      );
      const uploadResults = await Promise.all(uploadPromises);
      const imageUrls = uploadResults.map((result) => result.secure_url);

      const product = new Product({
        name: req.body.name,
        description: req.body.description,
        category: req.body.category,
        price: req.body.price,
        stock: req.body.stock,
        size: req.body.size,
        color: req.body.color,
        images: imageUrls,
      });

      await product.save();

      req.session.message = {
        type: "success",
        message: "Product added successfully",
      };

      res.redirect("/products");
    } catch (error) {
      console.error(error);
      res.json({ message: error.message, type: "danger" });
    }
  },

  // Edit a product
  editproduct: async (req, res) => {
    try {
      let id = req.params.id;
      const product = await Product.findById(id).exec();

      if (!product) {
        res.redirect("/products");
        return;
      }

      const category = await Category.find().exec();

      res.render("adminviews/editproduct", {
        title: "Edit Product",
        product: product,
        category: category,
        existingImages: product.images,
      });
    } catch (error) {
      console.error(error);
      res.redirect("/products");
    }
  },

  // Upload cropped image (modified to handle Cloudinary upload without cropping)
  croppedimageupload: async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res
          .status(HttpStatusCode.BAD_REQUEST)
          .json({ error: "No file uploaded" });
      }

      const uploadPromises = req.files.map((file) =>
        cloudinary.uploader.upload(file.path, {
          folder: "products",
          resource_type: "image",
        })
      );
      const uploadResults = await Promise.all(uploadPromises);
      const filenames = uploadResults.map((result) => result.secure_url);

      res.status(HttpStatusCode.OK).json({ filenames: filenames });
    } catch (error) {
      console.error(error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error" });
    }
  },

  // Update product
  updateproduct: async (req, res) => {
    try {
      const id = req.params.id;

      const existingProduct = await Product.findById(id).exec();
      if (!existingProduct) {
        throw new Error("Product not found");
      }

      let updatedImages = [...existingProduct.images];

      // Handle deleted images
      if (req.body.deletedImages) {
        const deletedImages = req.body.deletedImages
          .split(",")
          .map((image) => image.trim());
        updatedImages = existingProduct.images.filter(
          (image) => !deletedImages.includes(image)
        );

        // Delete images from Cloudinary
        const deletePromises = deletedImages.map((imageUrl) => {
          const publicId = imageUrl.split("/").pop().split(".")[0]; // Extract public ID from URL
          return cloudinary.uploader.destroy(`products/${publicId}`);
        });
        await Promise.all(deletePromises);
      }

      // Upload new images to Cloudinary
      if (req.files && req.files.length > 0) {
        const uploadPromises = req.files.map((file) =>
          cloudinary.uploader.upload(file.path, {
            folder: "products",
            resource_type: "image",
          })
        );
        const uploadResults = await Promise.all(uploadPromises);
        const newImageUrls = uploadResults.map((result) => result.secure_url);
        updatedImages = [...updatedImages, ...newImageUrls];
      }

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
      const categoryOffer = await CategoryOffer.findOne({
        category: updatedProduct.category,
      }).exec();
      if (categoryOffer) {
        const discountPercentage = categoryOffer.discountPercentage;
        const discountAmount =
          (updatedProduct.price * discountPercentage) / 100;
        categoryOfferPrice = updatedProduct.price - discountAmount;
      }

      updatedProduct.categoryofferprice = categoryOfferPrice;

      await Product.findByIdAndUpdate(id, updatedProduct);

      req.session.message = {
        type: "success",
        message: "Product updated successfully!",
      };

      res.redirect("/products");
    } catch (err) {
      console.error(err);
      res.json({ message: err.message, type: "danger" });
    }
  },

  // Display products category-wise on user side
  getproductsCategorywise: async (req, res) => {
    try {
      const categoryId = req.params.categoryId;
      const selectedCategory = await Category.findById(categoryId);
      const products = await Product.find({ category: categoryId });
      const categoryOffers = await CategoryOffer.find({ category: categoryId });

      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();
      const wishlist = await Wishlist.findOne({ user });

      res.render("userviews/viewproductsCategorywise", {
        title: "Products in category",
        category: selectedCategory,
        selectedCategory: selectedCategory,
        products: products,
        categoryOffers: categoryOffers,
        cart: cart,
        wishlist: wishlist,
      });
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },

  // Get product details
  getproductdetails: async (req, res) => {
    try {
      const productId = req.params.id;
      const product = await Product.findById(productId).populate({
        path: "category",
        select: "name-_id",
      });

      if (!product) {
        return res
          .status(404)
          .render("error", { message: "Product not found" });
      }

      const user = req.session.user;
      let productInWishlist = false;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();
      var wishlist = await Wishlist.findOne({ user });

      if (user) {
        wishlist = await Wishlist.findOne({ user: user._id });

        if (wishlist) {
          productInWishlist = wishlist.items.some(
            (item) => item.product.toString() === productId
          );
        }
      }

      const products = await Product.find();
      const selectedCategory = product.category;

      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      res.render("userviews/productdetails", {
        title: "Products in category",
        category: selectedCategory,
        selectedCategory: selectedCategory,
        products: products,
        product: product,
        productInWishlist: productInWishlist,
        productOffers: productOffers,
        wishlist: wishlist,
        cart,
      });
    } catch (error) {
      console.error("Error in getproductdetails:", error);
      res.status(500).send("Internal Server Error");
    }
  },

  // Block and unblock a product
  blockProduct: async (req, res) => {
    const productId = req.body.productId;

    try {
      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).render("userviews/404page");
      }

      product.blocked = !product.blocked;
      await product.save();

      res.redirect("/products");
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },

  // Get all products page with combined search, sort, and filter
  getAllProducts: async (req, res) => {
    try {
      const perPage = 12;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * perPage;

      let query = { blocked: false };
      if (req.query.query) {
        const searchQuery = req.query.query;
        query.name = { $regex: new RegExp(searchQuery, "i") };
      }

      let allProducts = await Product.find(query).populate("category").exec();

      if (req.query.color) {
        allProducts = allProducts.filter(
          (product) => product.color === req.query.color
        );
      }

      if (req.query.size) {
        allProducts = allProducts.filter((product) =>
          product.size.includes(req.query.size)
        );
      }

      if (req.query.sortOption === "priceLowToHigh") {
        allProducts.sort((a, b) => a.price - b.price);
      } else if (req.query.sortOption === "priceHighToLow") {
        allProducts.sort((a, b) => b.price - a.price);
      }

      const totalProducts = allProducts.length;
      const totalPages = Math.ceil(totalProducts / perPage);
      allProducts = allProducts.slice(skip, skip + perPage);

      const category = await Category.find().exec();
      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      })
        .populate("product")
        .exec();
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      })
        .populate("category")
        .exec();

      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      if (
        req.headers["x-requested-with"] === "XMLHttpRequest" ||
        req.query.json
      ) {
        res.json(allProducts);
      } else {
        res.render("userviews/allproducts", {
          title: "All Products",
          allProducts: allProducts,
          category: category,
          productOffers: productOffers,
          categoryOffers: categoryOffers,
          currentPage: page,
          totalPages: totalPages,
          wishlist: req.session.wishlist,
          cart: cart,
          searchQuery: req.query.query,
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },

  // Filter products with combined search, sort, and filter
  filterproducts: async (req, res) => {
    try {
      let filteredProducts;

      let query = { blocked: false };
      if (req.query.query) {
        const searchQuery = req.query.query;
        query.name = { $regex: new RegExp(searchQuery, "i") };
      }

      filteredProducts = await Product.find(query).populate("category").exec();

      if (req.query.color) {
        filteredProducts = filteredProducts.filter(
          (product) => product.color === req.query.color
        );
      }

      if (req.query.size) {
        filteredProducts = filteredProducts.filter((product) =>
          product.size.includes(req.query.size)
        );
      }

      if (req.query.sortOption === "priceLowToHigh") {
        filteredProducts.sort((a, b) => a.price - b.price);
      } else if (req.query.sortOption === "priceHighToLow") {
        filteredProducts.sort((a, b) => b.price - a.price);
      }

      res.json(filteredProducts);
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },
};
