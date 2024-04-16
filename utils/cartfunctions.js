const Category = require('../models/category'); 

const calculateTotalPrice = async (items, productOffers, categoryOffers) => {
    let total = 0;
    if (!items || !Array.isArray(items)) {
        console.error('Items array is undefined or not an array:', items);
        return total;
    }

    for (const item of items) {
        console.log('item:', item);

        if (item.product) {
            let itemPrice = item.product.price; 

            if (productOffers && Array.isArray(productOffers)) {
                // Fetch the offers for the current product
                const productOffersFiltered = productOffers.filter(offer => offer.product.toString() === item.product._id.toString() &&
                    new Date() >= offer.startDate && new Date() <= offer.expiryDate);

                if (productOffersFiltered.length > 0) {
                    const offer = productOffersFiltered[0]; // Assuming there's only one valid offer for simplicity
                    itemPrice = offer.newPrice;
                }
            }

            // Check if categoryOffers is defined
            if (categoryOffers && Array.isArray(categoryOffers)) {
                // Fetch the offers for the category of the current product
                const category = await Category.findById(item.product.category); // Assuming you have a Category model
                if (category) {
                    const categoryOffersFiltered = categoryOffers.filter(offer =>
                        offer.category.toString() === category._id.toString() &&
                        new Date() >= offer.startDate && new Date() <= offer.expiryDate);

                    if (categoryOffersFiltered.length > 0) {
                        const offer = categoryOffersFiltered[0]; // Assuming there's only one valid offer for simplicity
                        itemPrice -= (itemPrice * offer.discountPercentage / 100);
                    }
                }
            }

            total += itemPrice * item.quantity;
        } else {
            console.error('Product is undefined for item:', item);
        }
    }

    return Number(total.toFixed(2)); // Convert total to number and return
}


module.exports = {
    calculateTotalPrice,
};
