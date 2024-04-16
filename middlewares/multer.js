const multer = require('multer')

//image upload
var storage = multer.diskStorage({
  destination: function (req, res, cb) {
    cb(null, './uploads')
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "_" + Date.now() + "_" + file.originalname)
  }
})

var upload = multer({
  storage: storage,
}).array('images', 10)

module.exports = upload
