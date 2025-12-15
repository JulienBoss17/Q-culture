// managers/roomManager.js
const User = require('../models/User');
const bcrypt = require('bcrypt');

const usersByRoom = new Map();     // roomName => Set of usernames
const roomPasswords = new Map();   // roomName => hashed password
const roomAdmins = new Map();      // roomName => admin username
const avatarsByUser = new Map();   // username => avatar URL
const quizzesByRoom = new Map();   // roomName => quiz data

async function fetchAvatar(username) {
  const user = await User.findOne({ username });
  return user?.avatar || 'avatars/avatar1.svg';
}

function createRoom(roomName, plainPassword, adminUsername) {
  if (usersByRoom.has(roomName)) return false; // room exists

  usersByRoom.set(roomName, new Set());
  roomAdmins.set(roomName, adminUsername);

  const hashedPwd = plainPassword ? bcrypt.hashSync(plainPassword, 10) : null;
  roomPasswords.set(roomName, hashedPwd);

  return true;
}

function checkRoomPassword(roomName, plainPassword) {
  const hashed = roomPasswords.get(roomName);
  if (!hashed) return true; // pas de mot de passe requis
  return bcrypt.compareSync(plainPassword || "", hashed);
}

function isAdmin(roomName, username) {
  return roomAdmins.get(roomName) === username;
}

function cleanupUserFromRoom(username, roomName) {
  const set = usersByRoom.get(roomName);
  if (set) set.delete(username);
  avatarsByUser.delete(username);
}

function cleanupRoom(roomName) {
  usersByRoom.delete(roomName);
  roomPasswords.delete(roomName);
  roomAdmins.delete(roomName);
  quizzesByRoom.delete(roomName);
}

function emitUserList(io, roomName) {
  const users = Array.from(usersByRoom.get(roomName) || []).map(u => ({
    username: u,
    avatar: avatarsByUser.get(u) || 'avatars/avatar1.svg'
  }));
  io.to(roomName).emit('userList', users);
}

module.exports = {
  usersByRoom,
  roomPasswords,
  roomAdmins,
  avatarsByUser,
  quizzesByRoom,
  fetchAvatar,
  createRoom,
  checkRoomPassword, // <-- Ajoute ça
  isAdmin,
  cleanupUserFromRoom,
  cleanupRoom,
  emitUserList
};

