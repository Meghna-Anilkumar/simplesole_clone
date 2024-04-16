const express = require('express')
const session = require('express-session')


module.exports = {
    islogged: (req, res, next) => {
        if (req.session.isAuth) {
            console.log('User is already logged in');
            res.redirect('/')
        }
        next()
    },

    userexist: (req, res, next) => {
        if (!req.session.user) {
            next()
        }
        else {
            res.redirect('/')
        }
    },

    checkAuth: (req, res, next) => {
        if (req.session.user) {
            next();
        } else {
            res.redirect('/login')
        }
    }




}
