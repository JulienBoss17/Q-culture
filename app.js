const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
require("dotenv").config();
const ejs = require("ejs");
const socketIo = require("socket.io");
const http = require("http");

const handleRoomSockets = require('./sockets/roomSocket');
const sessionMiddleware = require('./middleware/sessionMiddleware');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: 'http://localhost:5000', methods: ['GET', 'POST'], credentials: true }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("public"));
app.use(sessionMiddleware);

// Routes
app.use(require("./routes/Home"));
app.use(require("./routes/Room"));

// Socket.io + session
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
  const session = socket.request.session;
  if (!session || !session.user) return next(new Error("Unauthorized socket"));
  next();
});

io.on('connection', async (socket) => {
  const user = socket.request.session.user || { username: 'Invité', role: 'guest' };
  await handleRoomSockets(socket, io, user.username, user.role);
});

// MongoDB & serveur
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected successfully");
    server.listen(process.env.PORT, () => console.log(`✅ Server running on port ${process.env.PORT}`));
  })
  .catch(err => console.error("MongoDB connection failed:", err));
