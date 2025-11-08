const Order=require('../models/orderSchema')
const User=require('../models/user')

const getDashboardData = async () => {
  const paymentMethodCounts = await Order.aggregate([
    { $group: { _id: "$paymentMethod", count: { $sum: 1 } } },
  ]);

  const orderStatusCounts = await Order.aggregate([
    { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
  ]);

  const totalUsers = await User.countDocuments();
  const totalOrders = await Order.countDocuments();

  const totalProductQuantity = await Order.aggregate([
    { $unwind: "$items" },
    { $group: { _id: null, totalProductQuantity: { $sum: "$items.quantity" } } },
  ]);

  const productQuantity =
    totalProductQuantity.length > 0
      ? totalProductQuantity[0].totalProductQuantity
      : 0;

  const topSellingProducts = await Order.aggregate([
    { $unwind: "$items" },
    { $group: { _id: "$items.product", sales: { $sum: "$items.quantity" } } },
    { $sort: { sales: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    { $project: { name: "$product.name", sales: 1 } },
  ]);

  const topSellingCategories = await Order.aggregate([
    { $unwind: "$items" },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $group: { _id: "$product.category", sales: { $sum: "$items.quantity" } },
    },
    { $sort: { sales: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: "$category" },
    { $project: { name: "$category.name", sales: 1 } },
  ]);

  return {
    totalOrders,
    productQuantity,
    totalUsers,
    topSellingProducts,
    topSellingCategories,
    orderStatusData: {
      labels: orderStatusCounts.map((s) => s._id),
      data: orderStatusCounts.map((s) => s.count),
    },
    paymentMethodData: {
      labels: paymentMethodCounts.map((m) => m._id),
      data: paymentMethodCounts.map((m) => m.count),
    },
  };
};


module.exports={
    getDashboardData
}