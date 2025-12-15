const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
require("dotenv").config();

const store = new MongoDBStore({
  uri: process.env.MONGO_URI,
  collection: "sessions",
});

// Gestion des erreurs du store
store.on("error", (error) => {
  console.error("Erreur MongoDB store (sessions):", error);
});

const sessionMiddleware = session({
  secret: process.env.SECRETSESSION,
  resave: false,
  saveUninitialized: false,
  store: store,
cookie: {
  maxAge: 1000 * 60 * 60 * 1, // 1h
  sameSite: 'lax',
},
});

module.exports = sessionMiddleware;
