const Category = require('../models/category')

module.exports = {
  //to get add category page  
  addCategory: async (req, res) => {
    res.render('adminviews/addcategory',
      { title: 'Add Category' })
  },

  //to add new category
  addNewCat: async (req, res) => {
    try {
      const { name } = req.body;
  
      const existingCategory = await Category.findOne({
        $or: [
          { name: name },
          { name: { $regex: new RegExp(`^${name}$`, 'i') } }
        ]
      });
  
      if (existingCategory) {
        return res.render('adminviews/addcategory',{error:'category already exists',title: 'Add Category'})
      }

      const category = new Category({
        name
      });
  
      await category.save();
      console.log('Category added successfully')
      req.session.message = {
        type: 'success',
        message: 'Category added successfully'
      };
  
      res.redirect('/categories');
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal Server Error', type: 'danger' });
    }
  },

  //get all categories with pagination and search
  getcategories: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const search = req.query.search || '';
      
      // Build query
      const query = search ? 
        { name: { $regex: search, $options: 'i' } } : 
        {};
      
      const totalCategories = await Category.countDocuments(query);
      const totalPages = Math.ceil(totalCategories / limit);
      const skip = (page - 1) * limit;

      const categories = await Category.find(query)
        .skip(skip)
        .limit(limit)
        .exec();

      res.render('adminviews/categories', {
        title: 'Categories',
        category: categories,
        currentPage: page,
        totalPages: totalPages,
        limit: limit,
        search: search,
        totalCategories: totalCategories
      });
    } catch (err) {
      res.json({ message: err.message });
    }
  },

  //edit a category 
  editcategory: async (req, res) => {
    let id = req.params.id;
    Category.findById(id)
      .then(category => {
        if (category === null) {
          res.redirect('/categories');
        } else {
          res.render('adminviews/editcategory', {
            title: 'Edit Category',
            category: category
          });
        }
      })
      .catch(err => {
        console.error(err);
        res.redirect('/categories');
      });
  },

  //Update user route(update button click event)
  updatecategory: async (req, res) => {
    let id = req.params.id;
    try {
      const result = await Category.findByIdAndUpdate(id, {
        name: req.body.name,
      });

      req.session.message = {
        type: 'success',
        message: 'Category updated successfully!',
      };
      console.log('category updated successfully')
      res.redirect('/categories');
    } catch (err) {
      res.json({ message: err.message, type: 'danger' });
    }
  },

  //block and unblock the category
  blockCategory: async (req, res) => {
    const categoryId = req.body.categoryId;

    try {
      console.log('categoryId:', categoryId);
      const category = await Category.findById(categoryId);
      console.log(category);

      if (!category) {
        return res.status(404).send('Category not found');
      }

      category.blocked = !category.blocked;

      await category.save();

      res.redirect('/categories');
    } catch (error) {
      console.error(error);
      res.status(500).send('Internal Server Error');
    }
  },
}