// managers/roomManager.js
const User = require('../models/User');

const usersByRoom = new Map();     // roomName => Set of usernames
const roomPasswords = new Map();   // roomName => hashed password
const roomAdmins = new Map();      // roomName => admin username
const avatarsByUser = new Map();   // username => avatar URL
const quizzesByRoom = new Map();   // roomName => quiz data

// ==== Room creation / user management ====
async function fetchAvatar(username) {
  const user = await User.findOne({ username });
  return user?.avatar || 'avatars/avatar1.svg';
}

function createRoom(roomName, hashedPassword, adminUsername) {
  if (!usersByRoom.has(roomName)) {
    usersByRoom.set(roomName, new Set());
    roomPasswords.set(roomName, hashedPassword);
    roomAdmins.set(roomName, adminUsername);
  }
}

function emitUserList(io, roomName) {
  const users = Array.from(usersByRoom.get(roomName) || []).map(username => ({
    username,
    avatar: avatarsByUser.get(username) || 'avatars/avatar1.svg'
  }));
  io.to(roomName).emit('userList', users);
}

function isAdmin(roomName, username) {
  return roomAdmins.get(roomName) === username;
}

function cleanupUserFromRoom(username, roomName) {
  const set = usersByRoom.get(roomName);
  if (set) set.delete(username);
  avatarsByUser.delete(username);
}

function cleanupRoom(room) {
  usersByRoom.delete(room);
  roomPasswords.delete(room);
  roomAdmins.delete(room);
  avatarsByUser.forEach((v, k) => {
    if (v.room === room) avatarsByUser.delete(k);
  });
  quizzesByRoom.delete(room);
}


module.exports = {
  usersByRoom,
  roomPasswords,
  roomAdmins,
  avatarsByUser,
  quizzesByRoom,
  fetchAvatar,
  emitUserList,
  isAdmin,
  createRoom,
  cleanupUserFromRoom,
  cleanupRoom
};
