require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const path=require('path')
const session = require('express-session')
const cookieParser = require('cookie-parser')
const MongoDBSession = require('connect-mongodb-session')(session)
const bodyParser = require('body-parser')
const morgan = require('morgan')


const app = express()
const PORT = process.env.PORT || 4000

//database connection
mongoose.connect(process.env.DB_URI)
const db = mongoose.connection
db.on('error', (error) => console.log(error))
db.once('open', () => console.log('connected to the database'))

const store = new MongoDBSession({
    uri: process.env.DB_URI,
    collection: 'mySessions'
})

// middlewares
app.use(bodyParser.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(morgan('tiny'));
app.use(session({
    secret: 'my secret key',
    saveUninitialized: false,
    resave: false,
    store: store,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, 
        secure: false,
    }
}))


//route for logout
app.get('/logout', (req, res) => {
    req.session.isAuth = false;
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
        } else {
            res.redirect('/login');
        }
    });
});


app.use((req, res, next) => {
    res.locals.message = req.session.message
    delete req.session.message
    next()
})


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/compressed_images', express.static(path.join(__dirname, 'compressed_images')));

app.use(express.static('uploads'))
app.use(express.static('public'))
app.use(express.static('compressed_images'))
app.use(cookieParser())

app.set('view engine', 'ejs')

//route prefix
app.use('', require('./routes/userrouter'))
app.use('', require('./routes/adminrouter'))




app.listen(PORT, () => {
    console.log(`server started at http://localhost:${PORT}`)
})
