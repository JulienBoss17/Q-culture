const session = require('express-session');
const MongoStore = require('connect-mongo');
require('dotenv').config();

const sessionMiddleware = session({
  secret: process.env.SECRETSESSION,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 1, // 1h
    sameSite: 'lax', // 'lax' est bien pour localhost, sinon 'none' + secure:true pour prod HTTPS
    // secure: true, // décommenter si HTTPS en prod
  },
});

module.exports = sessionMiddleware;
