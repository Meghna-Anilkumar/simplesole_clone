// utils/upload.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name:'dxw9jbfkh',
  api_key: '992782861468145',
  api_secret: 'A9Pv3Ol7YjzsoX3Ye-TAX08zVSQ',
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'ecommerce_products', // Folder in Cloudinary to store images
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }], // Optional: Resize images
  },
});

const upload = multer({ storage: storage }).array('images', 10); // Allow up to 10 images

module.exports = upload;