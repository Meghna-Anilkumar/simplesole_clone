// controllers/cartController.js
const mongoose = require("mongoose");
const Cart = require("../models/cartSchema");
const Product = require("../models/product");
const ProductOffer = require("../models/productoffermodel");
const CategoryOffer = require("../models/categoryoffer");
const Wishlist = require("../models/wishlist");
const { calculateTotalPrice } = require("../utils/cartfunctions");
const Category = require("../models/category");
const messages = require("../constants/messages");
const STATUS_CODES = require("../enums/statusCodes");

module.exports = {
  getcart: async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) return res.redirect("/login");

      const cart = await Cart.findOne({ user }).populate({
        path: "items.product",
        populate: { path: "variants" },
      });

      const wishlist = await Wishlist.findOne({ user: user._id }).populate(
        "items.product"
      );

      let unavailableItems = [];
      let canProceedToCheckout = true;

      if (cart && cart.items.length > 0) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          for (const item of cart.items) {
            const product = item.product;
            if (!product || product.blocked) {
              unavailableItems.push({
                name: product?.name || "Unknown Product",
                size: item.size,
                reason: "Product no longer available",
              });
              canProceedToCheckout = false;
              continue;
            }

            const variant = product.variants.find((v) => v.size === item.size);
            if (!variant) {
              unavailableItems.push({
                name: product.name,
                size: item.size,
                reason: "Selected size no longer exists",
              });
              canProceedToCheckout = false;
              continue;
            }

            // CORRECT STOCK CALCULATION FOR CURRENT USER
            const userReservedQty = item.quantity;
            const othersReserved = Math.max(
              0,
              (variant.reserved || 0) - userReservedQty
            );
            const stockAvailableExcludingUser = variant.stock - othersReserved;
            const totalAvailableForThisUser =
              stockAvailableExcludingUser + userReservedQty;

            // Only block if someone else took the stock
            if (stockAvailableExcludingUser < 0) {
              unavailableItems.push({
                name: product.name,
                size: item.size,
                reason: `Only ${
                  variant.stock - othersReserved + userReservedQty
                } left (over-reserved)`,
              });
              canProceedToCheckout = false;
            }

            // Expire old reservations (10 minutes)
            if (
              item.reservedAt &&
              item.reservedAt < new Date(Date.now() - 10 * 60 * 1000)
            ) {
              await Product.findOneAndUpdate(
                { _id: product._id, "variants.size": item.size },
                {
                  $inc: {
                    "variants.$.reserved": -item.quantity,
                    reserved: -item.quantity,
                    version: 1,
                  },
                },
                { session }
              );

              cart.items = cart.items.filter(
                (i) =>
                  !(
                    i.product.toString() === product._id.toString() &&
                    i.size === item.size
                  )
              );

              unavailableItems.push({
                name: product.name,
                size: item.size,
                reason: "Reservation expired (10 mins)",
              });
              canProceedToCheckout = false;
            }
          }

          await cart.save({ session });
          await session.commitTransaction();
        } catch (err) {
          await session.abortTransaction();
          throw err;
        } finally {
          session.endSession();
        }
      }

      const totalPrice =
        cart?.items.length > 0
          ? await calculateTotalPrice(
              cart.items,
              await ProductOffer.find({
                startDate: { $lte: new Date() },
                expiryDate: { $gte: new Date() },
              }),
              await CategoryOffer.find({
                startDate: { $lte: new Date() },
                expiryDate: { $gte: new Date() },
              })
            )
          : 0;

      if (cart) {
        cart.total = totalPrice;
        if (!req.session.couponCode) cart.newTotal = totalPrice;
        await cart.save();
      }

      res.render("userviews/cart", {
        title: "Cart",
        category: await Category.find(),
        cart,
        data: { total: totalPrice },
        productOffers: await ProductOffer.find({
          startDate: { $lte: new Date() },
          expiryDate: { $gte: new Date() },
        }),
        wishlist,
        unavailableItems,
        canProceedToCheckout,
      });
    } catch (error) {
      console.error("getcart error:", error);
      res.status(500).render("error", { message: "Something went wrong" });
    }
  },

  addtocart: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { productId, quantity, size } = req.body;
      const qty = parseInt(quantity);
      const userId = req.session.user._id;

      console.log("\n========== ADD TO CART DEBUG ==========");
      console.log("Product ID:", productId);
      console.log("Requested Quantity:", qty);
      console.log("Size:", size);
      console.log("User ID:", userId);

      // Validate input
      if (!mongoose.Types.ObjectId.isValid(productId) || !size || qty < 1) {
        console.log("❌ Invalid request parameters");
        return res
          .status(400)
          .json({ success: false, error: "Invalid request" });
      }

      // Get product with session lock
      const product = await Product.findById(productId).session(session);
      if (!product || product.blocked) {
        console.log("❌ Product unavailable or blocked");
        throw new Error("Product unavailable");
      }

      console.log("Product Name:", product.name);

      // Find the variant for requested size
      const variant = product.variants.find((v) => v.size === size);
      if (!variant) {
        console.log("❌ Size not available");
        throw new Error("Size not available");
      }

      console.log("\n--- VARIANT STOCK INFO ---");
      console.log("Variant stock (total physical):", variant.stock);
      console.log("Variant reserved (all users):", variant.reserved || 0);

      // Get or create cart
      let cart = await Cart.findOne({ user: userId }).session(session);
      if (!cart) {
        console.log("Creating new cart for user");
        cart = new Cart({ user: userId, items: [] });
      }

      // Check if item already exists in cart
      const existingItem = cart.items.find(
        (i) => i.product.toString() === productId && i.size === size
      );

      const currentQtyInCart = existingItem ? existingItem.quantity : 0;
      const newTotalQty = currentQtyInCart + qty;

      console.log("\n--- CART STATUS ---");
      console.log("Current quantity in cart:", currentQtyInCart);
      console.log("Adding quantity:", qty);
      console.log("New total quantity:", newTotalQty);

      // ========== CORRECTED STOCK CALCULATION ==========
      // Available stock = Total stock - Reserved by OTHER users
      const currentlyReservedByThisUser = currentQtyInCart;
      const totalReserved = variant.reserved || 0;
      const reservedByOthers = Math.max(
        0,
        totalReserved - currentlyReservedByThisUser
      );
      const realAvailableStock = variant.stock - reservedByOthers;

      console.log("\n--- AVAILABILITY CALCULATION ---");
      console.log(
        "Currently reserved by THIS user:",
        currentlyReservedByThisUser
      );
      console.log("Reserved by OTHERS:", reservedByOthers);
      console.log("Real available stock:", realAvailableStock);

      // Validate if we can add the requested quantity
      if (newTotalQty > realAvailableStock) {
        const canAdd = realAvailableStock - currentQtyInCart;
        console.log("\n❌ VALIDATION FAILED");
        console.log(
          `User wants total of ${newTotalQty} but only ${realAvailableStock} available`
        );
        console.log(`Can only add ${canAdd} more items`);
        throw new Error(
          canAdd > 0
            ? `Only ${canAdd} more available (you have ${currentQtyInCart} in cart)`
            : `No more available (you have ${currentQtyInCart} in cart)`
        );
      }

      console.log("✅ VALIDATION PASSED");
      console.log(
        `Can add ${qty} items (total will be ${newTotalQty}/${realAvailableStock})`
      );

      // Update or add item to cart
      if (existingItem) {
        console.log("\n--- UPDATING EXISTING ITEM ---");
        existingItem.quantity = newTotalQty;
        existingItem.reservedAt = new Date();
        console.log(
          "Updated quantity from",
          currentQtyInCart,
          "to",
          newTotalQty
        );
      } else {
        console.log("\n--- ADDING NEW ITEM ---");
        const price =
          product.categoryofferprice < product.price
            ? product.categoryofferprice
            : product.price;

        cart.items.push({
          product: productId,
          quantity: qty,
          size,
          price: price,
          reservedAt: new Date(),
        });
        console.log("Added new item with quantity:", qty, "at price:", price);
      }

      // Reserve the additional quantity in product
      await Product.findOneAndUpdate(
        { _id: productId, "variants.size": size },
        {
          $inc: {
            "variants.$.reserved": qty,
            reserved: qty,
            version: 1,
          },
        },
        { session }
      );

      console.log("\n--- RESERVATION UPDATE ---");
      console.log("Increased variant.reserved by:", qty);
      console.log(
        "New variant.reserved will be:",
        (variant.reserved || 0) + qty
      );

      // Calculate and save cart total
      const total = await calculateTotalPrice(cart.items, [], []);
      cart.total = cart.newTotal = total;
      await cart.save({ session });
      await session.commitTransaction();

      console.log("\n--- RESPONSE ---");
      console.log("Cart total:", total);
      console.log("Items in cart:", cart.items.length);
      console.log("==========================================\n");

      res.json({
        success: true,
        cartTotal: total,
        itemCount: cart.items.length,
      });
    } catch (error) {
      console.log("\n❌ ADD TO CART ERROR:", error.message);
      console.log("==========================================\n");
      await session.abortTransaction();
      res.status(400).json({ success: false, error: error.message });
    } finally {
      session.endSession();
    }
  },

  updatequantity: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { productId, change } = req.params;
      const changeAmt = parseInt(change);
      const user = req.session.user._id;

      console.log("\n========== UPDATE QUANTITY DEBUG ==========");
      console.log("Product ID:", productId);
      console.log("Change Amount:", changeAmt);
      console.log("User ID:", user);

      const cart = await Cart.findOne({ user: user }).populate({
        path: "items.product",
        populate: { path: "variants" },
      });

      const item = cart.items.find(
        (i) => i.product && i.product._id.toString() === productId
      );

      if (!item) throw new Error("Item not found");

      console.log("\n--- BEFORE UPDATE ---");
      console.log("Product Name:", item.product.name);
      console.log("Size:", item.size);
      console.log("Current cart quantity:", item.quantity);
      console.log("Requested new quantity:", item.quantity + changeAmt);

      const variant = item.product.variants.find((v) => v.size === item.size);
      if (!variant) throw new Error("Size not found");

      console.log("\n--- VARIANT STOCK INFO ---");
      console.log("Variant stock (total physical):", variant.stock);
      console.log("Variant reserved (all users):", variant.reserved || 0);

      const newQty = item.quantity + changeAmt;
      if (newQty < 1) throw new Error("Minimum quantity is 1");

      // ========== CORRECTED STOCK CALCULATION ==========
      // The actual available stock is:
      // Total stock MINUS reservations by OTHER users
      // This user's current reservation doesn't count as "taken"

      const currentlyReservedByThisUser = item.quantity;
      const totalReserved = variant.reserved || 0;
      const reservedByOthers = Math.max(
        0,
        totalReserved - currentlyReservedByThisUser
      );

      // Real available stock (excluding what others have reserved)
      const realAvailableStock = variant.stock - reservedByOthers;

      console.log("\n--- AVAILABILITY CALCULATION ---");
      console.log(
        "Currently reserved by THIS user:",
        currentlyReservedByThisUser
      );
      console.log("Reserved by OTHERS:", reservedByOthers);
      console.log("Real available stock (for this user):", realAvailableStock);
      console.log("Attempting to set quantity to:", newQty);

      // Check if new quantity exceeds available stock
      if (newQty > realAvailableStock) {
        console.log("\n❌ VALIDATION FAILED");
        console.log(
          `User wants ${newQty} but only ${realAvailableStock} available`
        );
        throw new Error(`Only ${realAvailableStock} available`);
      }

      console.log("\n✅ VALIDATION PASSED");
      console.log(
        `User can have ${newQty} items (${realAvailableStock} available)`
      );

      // Update the product's reserved count
      // If increasing: reserve more (+changeAmt)
      // If decreasing: release some (-changeAmt)
      await Product.findOneAndUpdate(
        { _id: productId, "variants.size": item.size },
        {
          $inc: {
            "variants.$.reserved": changeAmt,
            reserved: changeAmt,
            version: 1,
          },
        },
        { session }
      );

      console.log("\n--- AFTER UPDATE ---");
      console.log("Updated variant.reserved by:", changeAmt);
      console.log(
        "New variant.reserved will be:",
        (variant.reserved || 0) + changeAmt
      );

      item.quantity = newQty;
      item.reservedAt = new Date();

      const total = await calculateTotalPrice(cart.items, [], []);
      cart.total = cart.newTotal = total;
      await cart.save({ session });
      await session.commitTransaction();

      console.log("\n--- RESPONSE ---");
      console.log("New quantity:", newQty);
      console.log("Cart total:", total);
      console.log("Max available for this user:", realAvailableStock);
      console.log("==========================================\n");

      res.json({
        success: true,
        quantity: newQty,
        total,
        itemPrice: item.price * newQty,
        maxAvailable: realAvailableStock,
        isAtMax: newQty >= realAvailableStock,
      });
    } catch (error) {
      console.log("\n❌ ERROR:", error.message);
      console.log("==========================================\n");
      await session.abortTransaction();
      res.status(400).json({ success: false, error: error.message });
    } finally {
      session.endSession();
    }
  },

  deleteitem: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { productId } = req.params;
      const user = req.session.user;

      const cart = await Cart.findOne({ user }).populate({
        path: "items.product",
        populate: { path: "variants" },
      });

      const item = cart.items.find(
        (i) =>
          i.product && i.product._id && i.product._id.toString() === productId
      );

      if (!item) throw new Error("Item not found");

      await Product.findOneAndUpdate(
        { _id: productId, "variants.size": item.size },
        {
          $inc: {
            "variants.$.reserved": -item.quantity,
            reserved: -item.quantity,
            version: 1,
          },
        },
        { session }
      );

      cart.items = cart.items.filter(
        (i) =>
          !(
            i.product &&
            i.product._id &&
            i.product._id.toString() === productId &&
            i.size === item.size
          )
      );

      const total = await calculateTotalPrice(
        cart.items,
        await ProductOffer.find().session(session),
        await CategoryOffer.find().session(session)
      );
      cart.total = cart.newTotal = total;
      await cart.save({ session });
      await session.commitTransaction();

      res.json({ success: true });
    } catch (error) {
      await session.abortTransaction();
      res.status(400).json({ error: error.message });
    } finally {
      session.endSession();
    }
  },

  updateSize: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { productId, newSize } = req.params;
      const user = req.session.user;

      const cart = await Cart.findOne({ user }).populate({
        path: "items.product",
        populate: { path: "variants" },
      });

      const item = cart.items.find((i) => i.product.toString() === productId);
      if (!item) throw new Error("Item not found");

      const product = item.product;
      const newVariant = product.variants.find((v) => v.size === newSize);

      if (!newVariant) throw new Error(`Size ${newSize} not available`);
      if (newVariant.stock - (newVariant.reserved || 0) < item.quantity)
        throw new Error(
          `Only ${newVariant.stock - (newVariant.reserved || 0)} left`
        );

      // Release old
      await Product.findOneAndUpdate(
        { _id: productId, "variants.size": item.size },
        {
          $inc: {
            "variants.$.reserved": -item.quantity,
            reserved: -item.quantity,
            version: 1,
          },
        },
        { session }
      );

      // Reserve new
      await Product.findOneAndUpdate(
        { _id: productId, "variants.size": newSize },
        {
          $inc: {
            "variants.$.reserved": item.quantity,
            reserved: item.quantity,
            version: 1,
          },
        },
        { session }
      );

      item.size = newSize;
      item.reservedAt = new Date();

      const total = await calculateTotalPrice(
        cart.items,
        await ProductOffer.find().session(session),
        await CategoryOffer.find().session(session)
      );
      cart.total = cart.newTotal = total;
      await cart.save({ session });
      await session.commitTransaction();

      res.json({ success: true, total });
    } catch (error) {
      await session.abortTransaction();
      res.status(400).json({ error: error.message });
    } finally {
      session.endSession();
    }
  },

  getCartTotal: async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      // Properly populate product + variants to get real-time reserved count
      const cart = await Cart.findOne({ user }).populate({
        path: "items.product",
        populate: { path: "variants" },
      });

      if (!cart || cart.items.length === 0) {
        return res.json({ success: true, total: 0, newTotal: 0 });
      }

      const productOffers = await ProductOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      const categoryOffers = await CategoryOffer.find({
        startDate: { $lte: new Date() },
        expiryDate: { $gte: new Date() },
      });

      const total = await calculateTotalPrice(
        cart.items,
        productOffers,
        categoryOffers
      );

      // Update cart totals
      cart.total = total;
      if (!req.session.couponCode) {
        cart.newTotal = total;
      }
      await cart.save();

      res.json({
        success: true,
        total,
        newTotal: cart.newTotal || total,
      });
    } catch (error) {
      console.error("getCartTotal error:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch cart total" });
    }
  },

  validateStockBeforeCheckout: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const user = req.session.user;

      console.log("\n========== VALIDATE STOCK BEFORE CHECKOUT ==========");
      console.log("User ID:", user._id);

      const cart = await Cart.findOne({ user })
        .populate({
          path: "items.product",
          populate: { path: "variants" },
        })
        .session(session);

      if (!cart || cart.items.length === 0) {
        console.log("Cart is empty - validation passed");
        await session.commitTransaction();
        return res.json({ success: true });
      }

      console.log("Cart items count:", cart.items.length);

      const unavailable = [];

      for (const item of cart.items) {
        console.log(
          "\n--- Validating item:",
          item.product.name,
          "size:",
          item.size
        );
        console.log("User wants quantity:", item.quantity);

        const variant = item.product.variants.find((v) => v.size === item.size);

        if (!variant) {
          console.log("❌ Variant not found");
          unavailable.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            reason: "Size not found",
          });
          continue;
        }

        console.log("Variant info:", {
          stock: variant.stock,
          totalReserved: variant.reserved || 0,
        });

        // CRITICAL: Check if this user's reservation is still valid
        const userReservedQty = item.quantity;
        const othersReserved = Math.max(
          0,
          (variant.reserved || 0) - userReservedQty
        );
        const realAvailable = variant.stock - othersReserved;

        console.log("Availability calculation:", {
          userReservedQty,
          othersReserved,
          realAvailable,
        });

        // Check if user's cart quantity can be fulfilled
        if (realAvailable < item.quantity) {
          console.log("❌ INSUFFICIENT STOCK");
          console.log(
            `User wants ${item.quantity} but only ${realAvailable} available`
          );

          unavailable.push({
            productId: item.product._id,
            name: item.product.name,
            size: item.size,
            available: realAvailable,
            needed: item.quantity,
            reason: `Only ${realAvailable} items available for size ${item.size}`,
          });
        } else {
          console.log("✅ Stock available for this item");
        }

        // Renew reservation timestamp
        item.reservedAt = new Date();
      }

      await cart.save({ session });

      if (unavailable.length > 0) {
        console.log(
          "\n❌ VALIDATION FAILED - Unavailable items:",
          unavailable.length
        );
        console.log("Unavailable items:", JSON.stringify(unavailable, null, 2));
        console.log("=================================================\n");

        await session.commitTransaction();
        return res.status(400).json({
          success: false,
          error: "Some items are unavailable",
          unavailableItems: unavailable,
        });
      }

      console.log("\n✅ VALIDATION PASSED - All items available");
      console.log("=================================================\n");

      await session.commitTransaction();
      res.json({ success: true });
    } catch (error) {
      console.log("\n❌ VALIDATION ERROR:", error.message);
      console.log("=================================================\n");
      await session.abortTransaction();
      res.status(500).json({ success: false, error: "Server error" });
    } finally {
      session.endSession();
    }
  },
};
