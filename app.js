const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
require("dotenv").config();
const ejs = require("ejs");
const socketIo = require("socket.io");
const http = require("http");

const { handleRoomSockets } = require('./sockets/roomSocket');
const sessionMiddleware = require('./middleware/sessionMiddleware');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:5000',  // adapte à ton front
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

// Middleware Express
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("public"));
app.use(sessionMiddleware);

// Routes
const homeRouter = require("./routes/Home");
const roomRouter = require("./routes/Room");
app.use("/site3", homeRouter);
app.use("/site3", roomRouter);

// Intégration de la session dans Socket.io
const wrap = middleware => (socket, next) => {
  middleware(socket.request, {}, next);
};
io.use(wrap(sessionMiddleware));

// Vérification session dans Socket.io
io.use((socket, next) => {
  const session = socket.request.session;
  if (!session || !session.user) {
    console.log('❌ Session manquante ou user manquant dans socket');
    return next(new Error("Unauthorized socket"));
  }
  next();
});

io.on('connection', async (socket) => {
  try {
    const user = socket.request.session.user || { username: 'Invité', role: 'guest' };
    await handleRoomSockets(socket, io, user.username, user.role);
  } catch (error) {
    console.error('Erreur dans handleRoomSockets:', error);
    socket.disconnect(true);
  }
});



// Connexion MongoDB et lancement serveur
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected successfully");
    server.listen(process.env.PORT, "127.0.0.1",() => console.log(`✅ Server running on port ${process.env.PORT}`));
  })
  .catch((err) => console.error("MongoDB connection failed:", err));
