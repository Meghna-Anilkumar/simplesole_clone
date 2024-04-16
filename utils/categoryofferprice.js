const calculateCategoryOfferPrice = (originalPrice, discountPercentage) => {
    const discountAmount = (originalPrice * discountPercentage) / 100;
    return originalPrice - discountAmount;
};

module.exports={calculateCategoryOfferPrice}