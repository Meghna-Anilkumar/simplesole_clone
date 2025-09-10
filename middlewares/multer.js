const multer = require('multer');

// Disk storage for regular file uploads
const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './Uploads');
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '_' + Date.now() + '_' + file.originalname);
  }
});

// Memory storage for cropped image uploads
const memoryStorage = multer.memoryStorage();

// Multer instances
const diskUpload = multer({
  storage: diskStorage,
}).array('images', 10);

const memoryUpload = multer({
  storage: memoryStorage,
}).single('croppedImage');

module.exports = {
  diskUpload,
  memoryUpload,
};