const Product = require("../models/product");
const Category = require("../models/category");
const Wishlist = require("../models/wishlist");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const Cart = require("../models/cartSchema");
const cloudinary = require("cloudinary").v2;
const HttpStatusCode = require("../enums/statusCodes");
const { calculateCategoryOfferPrice } = require("../utils/cartfunctions");


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
      "Error updating categoryofferprice for category " + categoryId + ":",
      error
    );
  }
};

module.exports = {
  addProduct: async (req, res) => {
    const category = await Category.find().exec();
    res.render("adminviews/addproduct", {
      title: "Add Product",
      category: category,
    });
  },

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
      console.error("Error in getproducts: " + err);
      res.status(500).json({ message: err.message, type: "danger" });
    }
  },

  addnewproduct: async (req, res) => {
    try {
      console.log("addnewproduct req.body: " + JSON.stringify(req.body));

      let croppedImages = [];
      if (req.body.croppedImages) {
        try {
          croppedImages = JSON.parse(req.body.croppedImages);
          console.log("Parsed croppedImages: " + JSON.stringify(croppedImages));
        } catch (parseError) {
          console.error("Error parsing croppedImages: " + parseError);
          return res.status(400).json({
            message: "Invalid croppedImages format",
            type: "danger",
          });
        }
      }

      if (!Array.isArray(croppedImages) || croppedImages.length === 0) {
        return res.status(400).json({
          message: "Please upload and crop at least one image.",
          type: "danger",
        });
      }

      const requiredFields = ["name", "description", "category", "price"];
      for (const field of requiredFields) {
        if (!req.body[field] || req.body[field].toString().trim() === "") {
          return res.status(400).json({
            message:
              field.charAt(0).toUpperCase() + field.slice(1) + " is required",
            type: "danger",
          });
        }
      }

      let variants = [];
      if (req.body.variants) {
        try {
          variants = Object.values(req.body.variants).map((variant) => ({
            size: variant.size.trim(),
            stock: parseInt(variant.stock),
          }));

          if (variants.length === 0) {
            return res.status(400).json({
              message: "At least one variant is required",
              type: "danger",
            });
          }

          for (const variant of variants) {
            if (!variant.size || isNaN(variant.stock) || variant.stock < 0) {
              return res.status(400).json({
                message: "Invalid variant data: size and stock are required",
                type: "danger",
              });
            }
          }
        } catch (parseError) {
          console.error("Error parsing variants: " + parseError);
          return res.status(400).json({
            message: "Invalid variants format",
            type: "danger",
          });
        }
      } else {
        return res.status(400).json({
          message: "At least one variant is required",
          type: "danger",
        });
      }

      const totalStock = variants.reduce(
        (sum, variant) => sum + variant.stock,
        0
      );

      const product = new Product({
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        category: req.body.category,
        price: parseFloat(req.body.price),
        // stock: totalStock,  // REMOVE THIS LINE - field doesn't exist in schema
        variants: variants,
        images: croppedImages,
      });

      await product.save();

      await updateCategoryOfferPrice(req.body.category);

      req.session.message = {
        type: "success",
        message: "Product added successfully",
      };

      res.redirect("/products");
    } catch (error) {
      console.error("addnewproduct error: " + error);
      res.status(500).json({
        message: error.message || "Internal server error",
        type: "danger",
      });
    }
  },

  editproduct: async (req, res) => {
    try {
      let id = req.params.id;
      const product = await Product.findById(id).exec();

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const category = await Category.find().exec();

      res.render("adminviews/editproduct", {
        title: "Edit Product",
        product: product,
        category: category,
        existingImages: product.images,
      });
    } catch (error) {
      console.error("Error in editproduct: " + error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

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
      console.error("Error uploading cropped image: " + error);
      res
        .status(HttpStatusCode.INTERNAL_SERVER_ERROR)
        .json({ error: "Internal server error" });
    }
  },

  updateproduct: async (req, res) => {
    try {
      const id = req.params.id;
      console.log("Update product request body: " + JSON.stringify(req.body));

      const existingProduct = await Product.findById(id).exec();
      if (!existingProduct) {
        return res.status(404).json({
          message: "Product not found",
          type: "danger",
        });
      }

      let updatedImages = [...existingProduct.images];

      if (req.body.deletedImages) {
        const deletedImages = req.body.deletedImages
          .split(",")
          .map((image) => image.trim())
          .filter((image) => image !== "");

        console.log("Images to delete: " + JSON.stringify(deletedImages));

        updatedImages = existingProduct.images.filter(
          (image) => !deletedImages.includes(image)
        );

        const deletePromises = deletedImages.map(async (imageUrl) => {
          try {
            const urlParts = imageUrl.split("/");
            const fileName = urlParts[urlParts.length - 1];
            const publicId = "products/" + fileName.split(".")[0];

            console.log("Deleting from Cloudinary: " + publicId);
            return await cloudinary.uploader.destroy(publicId);
          } catch (deleteError) {
            console.error(
              "Error deleting image from Cloudinary: " + deleteError
            );
          }
        });

        await Promise.allSettled(deletePromises);
      }

      if (req.body.croppedImages) {
        try {
          const croppedImages = JSON.parse(req.body.croppedImages);
          console.log("New cropped images: " + JSON.stringify(croppedImages));

          if (Array.isArray(croppedImages) && croppedImages.length > 0) {
            updatedImages = [...updatedImages, ...croppedImages];
          }
        } catch (parseError) {
          console.error("Error parsing croppedImages: " + parseError);
          return res.status(400).json({
            message: "Invalid cropped images format",
            type: "danger",
          });
        }
      }

      if (!updatedImages || updatedImages.length === 0) {
        return res.status(400).json({
          message: "Product must have at least one image",
          type: "danger",
        });
      }

      const requiredFields = ["name", "description", "category", "price"];
      for (const field of requiredFields) {
        if (!req.body[field] || req.body[field].toString().trim() === "") {
          return res.status(400).json({
            message:
              field.charAt(0).toUpperCase() + field.slice(1) + " is required",
            type: "danger",
          });
        }
      }

      let variants = [];
      if (req.body.variants) {
        try {
          variants = Object.values(req.body.variants).map((variant) => ({
            size: variant.size.trim(),
            stock: parseInt(variant.stock),
          }));

          if (variants.length === 0) {
            return res.status(400).json({
              message: "At least one variant is required",
              type: "danger",
            });
          }

          for (const variant of variants) {
            if (!variant.size || isNaN(variant.stock) || variant.stock < 0) {
              return res.status(400).json({
                message: "Invalid variant data: size and stock are required",
                type: "danger",
              });
            }
          }
        } catch (parseError) {
          console.error("Error parsing variants: " + parseError);
          return res.status(400).json({
            message: "Invalid variants format",
            type: "danger",
          });
        }
      } else {
        return res.status(400).json({
          message: "At least one variant is required",
          type: "danger",
        });
      }

      const totalStock = variants.reduce(
        (sum, variant) => sum + variant.stock,
        0
      );

      const updatedProduct = {
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        category: req.body.category,
        price: parseFloat(req.body.price),
        // stock: totalStock,  // REMOVE THIS LINE - field doesn't exist in schema
        variants: variants,
        images: updatedImages,
      };

      console.log(
        "Final updated product data: " + JSON.stringify(updatedProduct)
      );

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

      res.status(200).send("Product updated successfully");
    } catch (err) {
      console.error("Update product error: " + err);
      res.status(500).json({
        message: err.message || "Internal server error",
        type: "danger",
      });
    }
  },

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
      console.error("Error in getproductsCategorywise: " + error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  // Fixed version of the getproductdetails function
  getproductdetails: async (req, res) => {
    try {
      const productId = req.params.id;
      console.log(`[getproductdetails] Fetching product with ID: ${productId}`);

      const productDoc = await Product.findById(productId).populate({
        path: "category",
        select: "name",
      });

      if (!productDoc) {
        console.log(
          `[getproductdetails] Product not found for ID: ${productId}`
        );
        return res
          .status(404)
          .render("error", { message: "Product not found" });
      }

      // Convert to plain object to allow modifications
      const product = productDoc.toObject();

      console.log(
        `[getproductdetails] Raw product data: ${JSON.stringify(
          product,
          null,
          2
        )}`
      );

      // Filter valid variants (must have size and valid stock)
      const validVariants = product.variants.filter(
        (variant) =>
          variant.size &&
          typeof variant.stock === "number" &&
          !isNaN(variant.stock)
      );
      console.log(
        `[getproductdetails] Valid variants after filtering: ${JSON.stringify(
          validVariants,
          null,
          2
        )}`
      );

      // FIXED: Process variants with correct availability calculation
      const processedVariants = validVariants.map((variant) => {
        const availableQuantity = Math.max(
          0,
          variant.stock - (product.reserved || 0)
        );
        const isAvailable = availableQuantity > 0;
        console.log(
          `[DEBUG] Processing variant ${variant.size}: stock=${
            variant.stock
          }, reserved=${
            product.reserved || 0
          }, availableQuantity=${availableQuantity}, isAvailable=${isAvailable}`
        );
        return {
          size: variant.size,
          stock: variant.stock,
          _id: variant._id.toString(),
          isAvailable,
          availableQuantity,
        };
      });

      // Replace the product variants with processed ones
      product.variants = processedVariants;

      console.log(
        `[getproductdetails] Processed variants: ${JSON.stringify(
          product.variants,
          null,
          2
        )}`
      );

      // Check if all variants are out of stock
      const allVariantsOutOfStock = product.variants.every(
        (variant) => !variant.isAvailable
      );
      product.allVariantsOutOfStock = allVariantsOutOfStock;

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
      console.log(
        `[getproductdetails] productInWishlist: ${productInWishlist}`
      );

      const similarProducts = await Product.find({
        category: product.category,
        _id: { $ne: productId },
        blocked: false,
      })
        .limit(4)
        .exec();
      console.log(
        `[getproductdetails] Similar products count: ${similarProducts.length}`
      );

      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });
      console.log(
        `[getproductdetails] Product offers: ${JSON.stringify(
          productOffers,
          null,
          2
        )}`
      );

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
      console.log(
        `[getproductdetails] Rendering productdetails.ejs for product ID: ${productId}`
      );
    } catch (error) {
      console.error(`[getproductdetails] Error: ${error.stack}`);
      res.status(500).send("Internal Server Error");
    }
  },

  blockProduct: async (req, res) => {
    const productId = req.body.productId;

    try {
      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      product.blocked = !product.blocked;
      await product.save();

      res.redirect("/products");
    } catch (error) {
      console.error("Error in blockProduct: " + error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

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
      console.log('all products:',allProducts)
      const allCategoryOffers=await CategoryOffer.find()
      console.log('allCategoryOffers:',allCategoryOffers)
      if (req.query.size) {
        allProducts = allProducts.filter((product) =>
          product.variants.some((variant) => variant.size === req.query.size)
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

      // Get product offers - populate the product field
      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      })
        .populate("product")
        .exec();

      // Get category offers - populate the category field
      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      })
        .populate("category")
        .exec();

      console.log("Product offers found:", productOffers.length);
      console.log("Category offers found:", categoryOffers.length);

      // Add offer information to each product
      const productsWithOffers = allProducts.map((product) => {
        const productObj = product.toObject();

        // Find product offer - fix the comparison
        const productOffer = productOffers.find((offer) => {
          // Handle both populated and non-populated cases
          const offerProductId = offer.product._id
            ? offer.product._id.toString()
            : offer.product.toString();
          return offerProductId === product._id.toString();
        });

        // Find category offer - fix the comparison
        const categoryOffer = categoryOffers.find((offer) => {
          // Handle both populated and non-populated cases
          const offerCategoryId = offer.category._id
            ? offer.category._id.toString()
            : offer.category.toString();
          return offerCategoryId === product.category._id.toString();
        });

        console.log(`Product ${product.name}:`);
        console.log(`  Product ID: ${product._id.toString()}`);
        console.log(`  Category ID: ${product.category._id.toString()}`);
        console.log(`  Has product offer: ${!!productOffer}`);
        console.log(`  Has category offer: ${!!categoryOffer}`);

        // Add offer information
        productObj.hasProductOffer = !!productOffer;
        productObj.hasCategoryOffer = !!categoryOffer;
        productObj.productOffer = productOffer;
        productObj.categoryOffer = categoryOffer;

        return productObj;
      });

      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      if (
        req.headers["x-requested-with"] === "XMLHttpRequest" ||
        req.query.json
      ) {
        res.json(productsWithOffers);
      } else {
        res.render("userviews/allproducts", {
          title: "All Products",
          allProducts: productsWithOffers,
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
      console.error("Error in getAllProducts: " + error);
      res.status(500).json({ message: "Internal server error" });
    }
  },

  filterproducts: async (req, res) => {
    try {
      let filteredProducts;

      let query = { blocked: false };
      if (req.query.query) {
        const searchQuery = req.query.query;
        query.name = { $regex: new RegExp(searchQuery, "i") };
      }

      filteredProducts = await Product.find(query).populate("category").exec();

      if (req.query.size) {
        filteredProducts = filteredProducts.filter((product) =>
          product.variants.some((variant) => variant.size === req.query.size)
        );
      }

      if (req.query.sortOption === "priceLowToHigh") {
        filteredProducts.sort((a, b) => a.price - b.price);
      } else if (req.query.sortOption === "priceHighToLow") {
        filteredProducts.sort((a, b) => b.price - b.price);
      }

      res.json(filteredProducts);
    } catch (error) {
      console.error("Error in filterproducts: " + error);
      res.status(500).json({ message: "Internal server error" });
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
      console.error("Error fetching product offers: " + error);
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
      console.error("Error fetching category offers: " + error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  // Sample addToCart controller (assuming it doesn't exist)
  addToCart: async (req, res) => {
    try {
      const { productId, quantity, size } = req.body;
      const user = req.session.user;

      if (!user) {
        return res.redirect("/login");
      }

      if (!productId || !size || !quantity || isNaN(quantity) || quantity < 1) {
        return res.status(400).json({
          error: "Invalid product ID, size, or quantity",
        });
      }

      const product = await Product.findById(productId).exec();
      if (!product) {
        return res.status(404).json({
          error: "Product not found",
        });
      }

      const variant = product.variants.find((v) => v.size === size);
      if (!variant) {
        return res.status(400).json({
          error: "Selected size not available",
        });
      }

      if (variant.stock < quantity) {
        return res.status(400).json({
          error: "Insufficient stock for the selected size",
        });
      }

      let cart = await Cart.findOne({ user: user._id }).exec();
      if (!cart) {
        cart = new Cart({ user: user._id, items: [] });
      }

      const existingItem = cart.items.find(
        (item) => item.product.toString() === productId && item.size === size
      );

      if (existingItem) {
        const newQuantity = existingItem.quantity + quantity;
        if (variant.stock < newQuantity) {
          return res.status(400).json({
            error: "Insufficient stock for the selected size",
          });
        }
        existingItem.quantity = newQuantity;
      } else {
        cart.items.push({
          product: productId,
          quantity: quantity,
          size: size,
        });
      }

      await cart.save();

      res.json({
        success: true,
        message: "Product added to cart successfully",
      });
    } catch (error) {
      console.error("Error in addToCart: " + error);
      res.status(500).json({
        error: "Internal server error",
      });
    }
  },

  updateCategoryOfferPrice,
};
