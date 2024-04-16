const express = require('express')
const session = require('express-session')


module.exports = {
  isadminlogged: (req, res, next) => {
    if (req.session.isadminlogged) {
      res.redirect('/dashboard')
    }
    else {
      next()
    }
  },

  adminexist:(req,res,next)=>{
    if(req.session.isadminlogged){
      next()
    }
    else{
      res.redirect('/adminlogin')
    }
  }

}