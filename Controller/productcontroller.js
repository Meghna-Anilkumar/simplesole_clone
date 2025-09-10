const Product = require("../models/product");
const Category = require("../models/category");
const Wishlist = require("../models/wishlist");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const Cart = require("../models/cartSchema");
const cloudinary = require("cloudinary").v2;
const HttpStatusCode = require("../enums/statusCodes");
const { calculateCategoryOfferPrice } = require("../utils/cartfunctions");

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Update categoryofferprice for all products in a category
const updateCategoryOfferPrice = async (categoryId) => {
  try {
    const categoryOffer = await CategoryOffer.findOne({
      category: categoryId,
      startDate: { $lte: new Date() },
      expiryDate: { $gte: new Date() },
    }).exec();

    const products = await Product.find({ category: categoryId }).exec();

    for (const product of products) {
      let categoryOfferPrice = product.price;
      if (categoryOffer) {
        categoryOfferPrice = calculateCategoryOfferPrice(
          product.price,
          categoryOffer.discountPercentage
        );
      }
      await Product.findByIdAndUpdate(product._id, {
        categoryofferprice: categoryOfferPrice,
      });
    }
  } catch (error) {
    console.error(
      `Error updating categoryofferprice for category ${categoryId}:`,
      error
    );
  }
};

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

      const searchQuery = search
        ? {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { "category.name": { $regex: search, $options: "i" } },
            ],
          }
        : {};

      const product = await Product.find(searchQuery)
        .populate({ path: "category", select: "name" })
        .skip(skip)
        .limit(limit)
        .exec();

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
      console.log("addnewproduct req.body:", req.body); // Debugging
      console.log("addnewproduct req.file:", req.file); // Debugging for any file upload

      // Handle croppedImages parsing
      let croppedImages = [];

      if (req.body.croppedImages) {
        try {
          croppedImages = JSON.parse(req.body.croppedImages);
          console.log("Parsed croppedImages:", croppedImages); // Debugging
        } catch (parseError) {
          console.error("Error parsing croppedImages:", parseError);
          return res.status(400).json({
            message: "Invalid croppedImages format",
            type: "danger",
          });
        }
      }

      // Validate that we have at least one image
      if (!Array.isArray(croppedImages) || croppedImages.length === 0) {
        return res.status(400).json({
          message: "Please upload and crop at least one image.",
          type: "danger",
        });
      }

      // Validate required fields
      const requiredFields = [
        "name",
        "description",
        "category",
        "price",
        "stock",
        "size",
        "color",
      ];
      for (const field of requiredFields) {
        if (!req.body[field] || req.body[field].toString().trim() === "") {
          return res.status(400).json({
            message: `${
              field.charAt(0).toUpperCase() + field.slice(1)
            } is required`,
            type: "danger",
          });
        }
      }

      const product = new Product({
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        category: req.body.category,
        price: parseFloat(req.body.price),
        stock: parseInt(req.body.stock),
        size: req.body.size.trim(),
        color: req.body.color.trim(),
        images: croppedImages,
      });

      await product.save();

      // Update categoryofferprice for the new product
      await updateCategoryOfferPrice(req.body.category);

      req.session.message = {
        type: "success",
        message: "Product added successfully",
      };

      res.redirect("/products");
    } catch (error) {
      console.error("addnewproduct error:", error);
      res.status(500).json({
        message: error.message || "Internal server error",
        type: "danger",
      });
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

  // Upload cropped image
  uploadCroppedImage: async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(HttpStatusCode.BAD_REQUEST)
          .json({ error: "No cropped image uploaded" });
      }

      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { folder: "products", resource_type: "image" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          )
          .end(req.file.buffer);
      });

      res.status(HttpStatusCode.OK).json({ filename: result.secure_url });
    } catch (error) {
      console.error("Error uploading cropped image:", error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error" });
    }
  },

  // Update product
  updateproduct: async (req, res) => {
    try {
      const id = req.params.id;
      console.log("Update product request body:", req.body);
      console.log("Update product files:", req.files);

      const existingProduct = await Product.findById(id).exec();
      if (!existingProduct) {
        return res.status(404).json({
          message: "Product not found",
          type: "danger",
        });
      }

      let updatedImages = [...existingProduct.images];

      // Handle deleted images
      if (req.body.deletedImages) {
        const deletedImages = req.body.deletedImages
          .split(",")
          .map((image) => image.trim())
          .filter((image) => image !== ""); // Remove empty strings

        console.log("Images to delete:", deletedImages);

        // Remove deleted images from the array
        updatedImages = existingProduct.images.filter(
          (image) => !deletedImages.includes(image)
        );

        // Delete images from Cloudinary
        const deletePromises = deletedImages.map(async (imageUrl) => {
          try {
            // Extract public ID from Cloudinary URL
            const urlParts = imageUrl.split("/");
            const fileName = urlParts[urlParts.length - 1];
            const publicId = `products/${fileName.split(".")[0]}`;

            console.log("Deleting from Cloudinary:", publicId);
            return await cloudinary.uploader.destroy(publicId);
          } catch (deleteError) {
            console.error("Error deleting image from Cloudinary:", deleteError);
            // Continue with other deletions even if one fails
          }
        });

        await Promise.allSettled(deletePromises);
      }

      // Handle new cropped images
      if (req.body.croppedImages) {
        try {
          const croppedImages = JSON.parse(req.body.croppedImages);
          console.log("New cropped images:", croppedImages);

          if (Array.isArray(croppedImages) && croppedImages.length > 0) {
            // Add new cropped images to the array
            updatedImages = [...updatedImages, ...croppedImages];
          }
        } catch (parseError) {
          console.error("Error parsing croppedImages:", parseError);
          return res.status(400).json({
            message: "Invalid cropped images format",
            type: "danger",
          });
        }
      }

      // Handle traditional file uploads (if any - fallback)
      if (req.files && req.files.length > 0) {
        console.log("Processing traditional file uploads");
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

      // Validate that we have at least one image
      if (!updatedImages || updatedImages.length === 0) {
        return res.status(400).json({
          message: "Product must have at least one image",
          type: "danger",
        });
      }

      // Validate required fields
      const requiredFields = [
        "name",
        "description",
        "category",
        "price",
        "stock",
        "size",
        "color",
      ];
      for (const field of requiredFields) {
        if (!req.body[field] || req.body[field].toString().trim() === "") {
          return res.status(400).json({
            message: `${
              field.charAt(0).toUpperCase() + field.slice(1)
            } is required`,
            type: "danger",
          });
        }
      }

      const updatedProduct = {
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        category: req.body.category,
        price: parseFloat(req.body.price),
        stock: parseInt(req.body.stock),
        size: req.body.size.trim(),
        color: req.body.color.trim(),
        images: updatedImages,
      };

      console.log("Final updated product data:", updatedProduct);

      // Update categoryofferprice
      let categoryOfferPrice = updatedProduct.price;
      const categoryOffer = await CategoryOffer.findOne({
        category: updatedProduct.category,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).exec();

      if (categoryOffer) {
        categoryOfferPrice = calculateCategoryOfferPrice(
          updatedProduct.price,
          categoryOffer.discountPercentage
        );
      }
      updatedProduct.categoryofferprice = categoryOfferPrice;

      await Product.findByIdAndUpdate(id, updatedProduct);

      // Update categoryofferprice for all products in the category if category changed
      if (updatedProduct.category !== existingProduct.category.toString()) {
        await updateCategoryOfferPrice(updatedProduct.category);
        await updateCategoryOfferPrice(existingProduct.category);
      } else {
        await updateCategoryOfferPrice(updatedProduct.category);
      }

      req.session.message = {
        type: "success",
        message: "Product updated successfully!",
      };

      res.redirect("/products");
    } catch (err) {
      console.error("Update product error:", err);
      res.status(500).json({
        message: err.message || "Internal server error",
        type: "danger",
      });
    }
  },

  // Display products category-wise on user side
  getproductsCategorywise: async (req, res) => {
    try {
      const categoryId = req.params.categoryId;
      const selectedCategory = await Category.findById(categoryId);
      const products = await Product.find({ category: categoryId });
      const categoryOffers = await CategoryOffer.find({
        category: categoryId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

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
        select: "name",
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
      let wishlist = await Wishlist.findOne({ user });

      if (user) {
        wishlist = await Wishlist.findOne({ user: user._id });
        if (wishlist) {
          productInWishlist = wishlist.items.some(
            (item) => item.product.toString() === productId
          );
        }
      }

      const similarProducts = await Product.find({
        category: product.category,
        _id: { $ne: productId },
        blocked: false,
      })
        .limit(4)
        .exec();

      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      res.render("userviews/productdetails", {
        title: "Product Details",
        category: product.category,
        selectedCategory: product.category,
        product: product,
        productInWishlist: productInWishlist,
        productOffers: productOffers,
        wishlist: wishlist,
        cart,
        similarProducts: similarProducts,
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
        allProducts.sort((a, b) => b.price - b.price);
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
        filteredProducts.sort((a, b) => b.price - b.price);
      }

      res.json(filteredProducts);
    } catch (error) {
      console.error(error);
      res.status(500).send("Internal Server Error");
    }
  },

  getProductOffers: async (req, res) => {
    try {
      const productId = req.query.productId;
      if (!productId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }

      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).lean();

      res.json(productOffers);
    } catch (error) {
      console.error("Error fetching product offers:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  getCategoryOffers: async (req, res) => {
    try {
      const categoryId = req.query.categoryId;
      if (!categoryId.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ message: "Invalid category ID" });
      }

      const categoryOffers = await CategoryOffer.find({
        category: categoryId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).lean();

      res.json(categoryOffers);
    } catch (error) {
      console.error("Error fetching category offers:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  updateCategoryOfferPrice,
};
