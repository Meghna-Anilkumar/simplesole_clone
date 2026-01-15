const Product = require("../models/product");
const Category = require("../models/category");
const Wishlist = require("../models/wishlist");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const Cart = require("../models/cartSchema");
const cloudinary = require("cloudinary").v2;
const HttpStatusCode = require("../enums/statusCodes");
const { calculateCategoryOfferPrice } = require("../utils/cartfunctions");
const mongoose = require("mongoose");
const messages = require('../constants/messages');
const STATUS_CODES=require('../enums/statusCodes');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const getEffectivePrice = (
  product,
  productOffers = [],
  categoryOffers = []
) => {
  const now = new Date();

  const activeProductOffer = productOffers.find((offer) => {
    const offerProductId = offer.product._id
      ? offer.product._id.toString()
      : offer.product.toString();
    return (
      offerProductId === product._id.toString() &&
      now >= new Date(offer.startDate) &&
      now <= new Date(offer.expiryDate)
    );
  });

  if (activeProductOffer) {
    return activeProductOffer.newPrice;
  }

  const activeCategoryOffer = categoryOffers.find((offer) => {
    const offerCatId = offer.category._id
      ? offer.category._id.toString()
      : offer.category.toString();
    const productCatId = product.category._id
      ? product.category._id.toString()
      : product.category.toString();
    return (
      offerCatId === productCatId &&
      now >= new Date(offer.startDate) &&
      now <= new Date(offer.expiryDate)
    );
  });

  if (activeCategoryOffer) {
    return product.price * (1 - activeCategoryOffer.discountPercentage / 100);
  }
  return product.price;
};

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
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: err.message, type: "danger" });
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
          return res.status(STATUS_CODES.BAD_REQUEST).json({
            message: "Invalid croppedImages format",
            type: "danger",
          });
        }
      }

      if (!Array.isArray(croppedImages) || croppedImages.length === 0) {
        return res.status(STATUS_CODES.BAD_REQUEST).json({
          message: "Please upload and crop at least one image.",
          type: "danger",
        });
      }

      const requiredFields = ["name", "description", "category", "price"];
      for (const field of requiredFields) {
        if (!req.body[field] || req.body[field].toString().trim() === "") {
          return res.status(STATUS_CODES.BAD_REQUEST).json({
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
            return res.status(STATUS_CODES.BAD_REQUEST).json({
              message: "At least one variant is required",
              type: "danger",
            });
          }

          for (const variant of variants) {
            if (!variant.size || isNaN(variant.stock) || variant.stock < 0) {
              return res.status(STATUS_CODES.BAD_REQUEST).json({
                message: "Invalid variant data: size and stock are required",
                type: "danger",
              });
            }
          }
        } catch (parseError) {
          console.error("Error parsing variants: " + parseError);
          return res.status(STATUS_CODES.BAD_REQUEST).json({
            message: "Invalid variants format",
            type: "danger",
          });
        }
      } else {
        return res.status(STATUS_CODES.BAD_REQUEST).json({
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
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        message: error.message ||messages.INTERNAL_SERVER_ERROR,
        type: "danger",
      });
    }
  },

  editproduct: async (req, res) => {
    try {
      let id = req.params.id;
      const product = await Product.findById(id).exec();

      if (!product) {
        return res.status(STATUS_CODES.NOT_FOUND).json({ message: "Product not found" });
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
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: messages.INTERNAL_SERVER_ERROR });
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
        .json({ error:messages.INTERNAL_SERVER_ERROR });
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

  getproductdetails: async (req, res) => {
    try {
      const productId = req.params.id;
      console.log(`[getproductdetails] Fetching product with ID: ${productId}`);

      // Validate ObjectId early
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res
          .status(404)
          .render("error", { message: "Product not found" });
      }

      const productDoc = await Product.findById(productId)
        .populate({ path: "category", select: "name _id" })
        .lean(); // Use lean() for performance

      if (!productDoc) {
        return res
          .status(404)
          .render("error", { message: "Product not found" });
      }

      const user = req.session.user;

      // Fetch cart and wishlist in parallel
      const [cart, wishlist, allCategories] = await Promise.all([
        user ? Cart.findOne({ user: user._id }).lean() : null,
        user ? Wishlist.findOne({ user: user._id }).lean() : null,
        Category.find().lean(), // Fetch all categories for header
      ]);

      // Helper: Get how many of this variant this user has in cart
      const getUserCartQty = (size) => {
        if (!cart || !cart.items) return 0;
        const item = cart.items.find(
          (i) =>
            i.product && i.product.toString() === productId && i.size === size
        );
        return item ? item.quantity : 0;
      };

      // Process variants with correct available stock
      const processedVariants = (productDoc.variants || [])
        .filter((v) => v.size && typeof v.stock === "number")
        .map((variant) => {
          const totalReserved = variant.reserved || 0;
          const userHasQty = getUserCartQty(variant.size);
          const reservedByOthers = Math.max(0, totalReserved - userHasQty);
          const availableQuantity = Math.max(
            0,
            variant.stock - reservedByOthers
          );
          const isAvailable = availableQuantity > 0;

          return {
            size: variant.size,
            stock: variant.stock,
            _id: variant._id.toString(),
            isAvailable,
            availableQuantity,
            userHasInCart: userHasQty,
          };
        });

      const product = {
        ...productDoc,
        variants: processedVariants,
        allVariantsOutOfStock: processedVariants.every((v) => !v.isAvailable),
      };

      // Wishlist check
      const productInWishlist =
        wishlist?.items?.some(
          (item) => item.product && item.product.toString() === productId
        ) || false;

      // Similar products
      const similarProducts = await Product.find({
        category: productDoc.category._id,
        _id: { $ne: productId },
        blocked: false,
      })
        .limit(4)
        .lean();

      // Offers
      const productOffers = await ProductOffer.find({
        product: productId,
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      }).lean();

      // FIX: Pass both category and selectedCategory
      res.render("userviews/productdetails", {
        title: product.name,
        product,
        productInWishlist,
        productOffers,
        wishlist,
        cart,
        similarProducts,
        category: allCategories, 
        selectedCategory: productDoc.category,
      });
    } catch (error) {
      console.error(`[getproductdetails] Error:`, error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).render("error", { message: "Something went wrong" });
    }
  },

  blockProduct: async (req, res) => {
    const productId = req.body.productId;

    try {
      const product = await Product.findById(productId);

      if (!product) {
        return res.status(STATUS_CODES.NOT_FOUND).json({ message: "Product not found" });
      }

      product.blocked = !product.blocked;
      await product.save();

      res.redirect("/products");
    } catch (error) {
      console.error("Error in blockProduct: " + error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: messages.INTERNAL_SERVER_ERROR});
    }
  },

  getAllProducts: async (req, res) => {
    try {
      console.log("\n========== getAllProducts START ==========");
      const perPage = 12;
      const page = parseInt(req.query.page) || 1;
      const skip = (page - 1) * perPage;

      let query = { blocked: false };

      if (req.query.query) {
        const searchQuery = req.query.query.trim();
        query.name = { $regex: new RegExp(searchQuery, "i") };
      }

      let allProducts = await Product.find(query).populate("category").exec();

      // Fetch active offers once
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

      // Apply size filter BEFORE sorting
      if (req.query.size) {
        const size = req.query.size.toString().trim();
        allProducts = allProducts.filter((product) =>
          product.variants.some((v) => v.size.toString().trim() === size)
        );
      }

      // APPLY SORTING BY FINAL DISCOUNTED PRICE
      if (req.query.sortOption) {
        allProducts.sort((a, b) => {
          const priceA = getEffectivePrice(a, productOffers, categoryOffers);
          const priceB = getEffectivePrice(b, productOffers, categoryOffers);

          return req.query.sortOption === "priceLowToHigh"
            ? priceA - priceB
            : priceB - priceA;
        });
      }

      const totalProducts = allProducts.length;
      const totalPages = Math.ceil(totalProducts / perPage);
      const paginatedProducts = allProducts.slice(skip, skip + perPage);

      const category = await Category.find().exec();
      const user = req.session.user;
      const cart = await Cart.findOne({ user })
        .populate("items.product")
        .exec();

      // Attach offer info for EJS rendering
      const productsWithOffers = paginatedProducts.map((product) => {
        const productObj = product.toObject();

        const prodOffer = productOffers.find(
          (o) => o.product._id.toString() === product._id.toString()
        );
        const catOffer = categoryOffers.find(
          (o) => o.category._id.toString() === product.category._id.toString()
        );

        productObj.effectivePrice = getEffectivePrice(
          product,
          productOffers,
          categoryOffers
        );
        productObj.hasProductOffer = !!prodOffer;
        productObj.hasCategoryOffer = !!catOffer;
        productObj.productOffer = prodOffer || null;
        productObj.categoryOffer = catOffer || null;

        return productObj;
      });

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
          searchQuery: req.query.query || "",
        });
      }
    } catch (error) {
      console.error("Error in getAllProducts:", error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: messages.INTERNAL_SERVER_ERROR });
    }
  },

  filterproducts: async (req, res) => {
    try {
      console.log("\n========== filterproducts START ==========");

      let query = { blocked: false };
      if (req.query.query) {
        query.name = { $regex: new RegExp(req.query.query.trim(), "i") };
      }

      let filteredProducts = await Product.find(query)
        .populate("category")
        .exec();

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

      if (req.query.size) {
        const size = req.query.size.toString().trim();
        filteredProducts = filteredProducts.filter((product) =>
          product.variants.some((v) => v.size.toString().trim() === size)
        );
      }
      if (req.query.sortOption) {
        filteredProducts.sort((a, b) => {
          const priceA = getEffectivePrice(a, productOffers, categoryOffers);
          const priceB = getEffectivePrice(b, productOffers, categoryOffers);

          return req.query.sortOption === "priceLowToHigh"
            ? priceA - priceB
            : priceB - priceA;
        });
      }

      const result = filteredProducts.map((product) => {
        const p = product.toObject();
        p.effectivePrice = getEffectivePrice(
          product,
          productOffers,
          categoryOffers
        );
        return p;
      });

      res.json(result);
    } catch (error) {
      console.error("Error in filterproducts:", error);
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
