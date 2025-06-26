const MessageModel = require('../models/Message');
const UserModel = require('../models/User'); // <== AJOUTÉ

const usersByRoom = {}; // { roomName: Set(username) }
const roomPasswords = {}; // { roomName: password }
const roomAdmins = {}; // { roomName: adminUsername }
const avatarsByUser = {}; // <== NOUVEAU : { username: avatar }

function emitUserList(io, room) {
  const users = Array.from(usersByRoom[room] || []).map(username => ({
    username,
    avatar: avatarsByUser[username] || 'avatar1.svg' // <== AVATAR AJOUTÉ
  }));
  console.log(`[emitUserList] Room: ${room}, Users:`, users);
  io.to(room).emit('userList', users);
}

async function handleRoomSockets(socket, io, username, role) {
  try {
    const safeUsername = username || 'Invité';
    socket.data.username = safeUsername;

    socket.on('joinRoom', async ({ room, password }) => {
      if (usersByRoom[room]) {
        if (roomPasswords[room] !== password) {
          socket.emit('errorMessage', 'Mot de passe incorrect pour cette room.');
          return;
        }
      } else {
        if (role !== 'admin') {
          socket.emit('errorMessage', 'Seul un admin peut créer une nouvelle room.');
          return;
        }
        roomPasswords[room] = password;
        roomAdmins[room] = safeUsername;
        usersByRoom[room] = new Set();
      }

      // 🔎 Récupérer l'avatar depuis la base de données
      const userFromDB = await UserModel.findOne({ username: safeUsername });
      if (userFromDB) {
        avatarsByUser[safeUsername] = userFromDB.avatar || 'avatar1.svg'; 
      }

      socket.join(room);
      socket.data.room = room;
      usersByRoom[room].add(safeUsername);

      emitUserList(io, room);
      io.to(room).emit('notification', `${safeUsername} a rejoint la room.`);
      socket.to(room).emit('chatMessage', { user: 'System', message: `${safeUsername} a rejoint la room.` });

      const lastMessages = await MessageModel.find({ room }).sort({ createdAt: -1 }).limit(3).lean();
      socket.emit('chatHistory', lastMessages.reverse());
    });

    socket.on('sendMessage', async ({ room, message }) => {
      const msg = new MessageModel({
        room,
        user: safeUsername,
        message,
        createdAt: new Date()
      });
      await msg.save();
      io.to(room).emit('chatMessage', { user: safeUsername, message });
    });

    socket.on('typing', (room) => {
      io.to(room).emit('typing', safeUsername);
    });

    socket.on('closeRoom', (room) => {
      if (roomAdmins[room] !== safeUsername) {
        socket.emit('errorMessage', 'Seul l’admin peut fermer la room.');
        return;
      }
      io.to(room).emit('notification', 'La room a été fermée par l’admin.');
      io.in(room).socketsLeave(room);
      delete usersByRoom[room];
      delete roomPasswords[room];
      delete roomAdmins[room];
      console.log(`[closeRoom] Room "${room}" fermée par ${safeUsername}`);
    });

    socket.on('disconnect', () => {
      const room = socket.data.room;
      if (!room || !usersByRoom[room]) {
        return;
      }

      usersByRoom[room].delete(safeUsername);
      emitUserList(io, room);

      io.to(room).emit('notification', `${safeUsername} a quitté la room.`);
      socket.to(room).emit('chatMessage', { user: 'System', message: `${safeUsername} a quitté la room.` });

      if (usersByRoom[room].size === 0) {
        delete usersByRoom[room];
        delete roomPasswords[room];
        delete roomAdmins[room];
        console.log(`[disconnect] Suppression de la room vide "${room}"`);
      }
    });

  } catch (error) {
    console.error('Erreur dans handleRoomSockets:', error);
  }
}

module.exports = { handleRoomSockets };
