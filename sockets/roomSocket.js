const bcrypt = require('bcrypt');
const MessageModel = require('../models/Message');
const UserModel = require('../models/User');
const QuestionModel = require('../models/Question');

// --- Mémoire partagée ---
const usersByRoom = new Map();       // roomName => Set des usernames
const roomPasswords = new Map();     // roomName => hashedPassword
const roomAdmins = new Map();        // roomName => username admin
const avatarsByUser = new Map();     // username => avatar string
const quizzesByRoom = new Map();     // roomName => quiz data

function emitUserList(io, room) {
  const usersSet = usersByRoom.get(room);
  if (!usersSet) return;
  const users = Array.from(usersSet).map(username => ({
    username,
    avatar: avatarsByUser.get(username) || 'avatar1.svg'
  }));
  io.to(room).emit('userList', users);
}

function isAdmin(room, username) {
  return roomAdmins.get(room) === username;
}

async function fetchAvatar(username) {
  if (avatarsByUser.has(username)) return avatarsByUser.get(username);
  const user = await UserModel.findOne({ username }).lean();
  const avatar = user?.avatar || 'avatar1.svg';
  avatarsByUser.set(username, avatar);
  return avatar;
}

async function handleJoinRoom(socket, io, { room, password }) {
  if (!room || !password) {
    return socket.emit('errorMessage', 'Room ou mot de passe manquant.');
  }

  const username = socket.data.username;
  const role = socket.data.role;

  if (usersByRoom.has(room)) {
    const hashedPassword = roomPasswords.get(room);
    const passwordMatch = await bcrypt.compare(password, hashedPassword);
    if (!passwordMatch) {
      return socket.emit('errorMessage', 'Mot de passe incorrect pour cette room.');
    }
    if (usersByRoom.get(room).has(username)) {
      return socket.emit('errorMessage', 'Ce pseudo est déjà utilisé dans cette room.');
    }
  } else {
    if (role !== 'admin') {
      return socket.emit('errorMessage', 'Seul un admin peut créer une nouvelle room.');
    }
    const hashed = await bcrypt.hash(password, 10);
    roomPasswords.set(room, hashed);
    roomAdmins.set(room, username);
    usersByRoom.set(room, new Set());
  }

  await fetchAvatar(username);

  socket.join(room);
  socket.data.room = room;
  usersByRoom.get(room).add(username);

  emitUserList(io, room);
  io.to(room).emit('notification', `${username} a rejoint la room.`);
  socket.to(room).emit('chatMessage', { user: 'System', message: `${username} a rejoint la room.` });

  const lastMessages = await MessageModel.find({ room }).sort({ createdAt: -1 }).limit(3).lean();
  socket.emit('chatHistory', lastMessages.reverse());
}

async function handleSendMessage(socket, io, { room, message }) {
  if (!room || !message) return;
  const username = socket.data.username;

  const msg = new MessageModel({
    room,
    user: username,
    message,
    createdAt: new Date()
  });
  await msg.save();
  io.to(room).emit('chatMessage', { user: username, message, createdAt: msg.createdAt });
}

function handleTyping(socket, io, room) {
  const username = socket.data.username;
  if (room) io.to(room).emit('typing', username);
}

function cleanupRoom(room) {
  usersByRoom.delete(room);
  roomPasswords.delete(room);
  roomAdmins.delete(room);
  quizzesByRoom.delete(room);
}

function cleanupUserFromRoom(username, room) {
  const usersSet = usersByRoom.get(room);
  if (!usersSet) return;

  usersSet.delete(username);
  if (usersSet.size === 0) {
    cleanupRoom(room);
  }
  avatarsByUser.delete(username);
}

async function handleCloseRoom(socket, io, room) {
  const username = socket.data.username;
  if (!isAdmin(room, username)) {
    return socket.emit('errorMessage', 'Seul l’admin peut fermer la room.');
  }

  io.to(room).emit('notification', 'La room a été fermée par l’admin.');
  io.in(room).socketsLeave(room);
  cleanupRoom(room);
}

function calculateScoresAndEmit(io, room) {
  const quiz = quizzesByRoom.get(room);
  if (!quiz) return;

  const allCorrected = quiz.correctionResults.every(Boolean);
  if (!allCorrected) return;

  const questions = quiz.questions;

  Object.entries(quiz.answers).forEach(([user, answers]) => {
    let score = 0;
    answers.forEach((a, i) => {
      if (a !== undefined && quiz.correctionResults[i] && a === questions[i]?.correctAnswerIndex) {
        score++;
      }
    });
    quiz.scores[user] = score;
  });

  const ranking = Object.entries(quiz.scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 55)
    .map(([user, score], idx) => ({ rank: idx + 1, user, score }));

  quiz.correctionStarted = false;

  io.to(room).emit('answerCorrectionResult', {
    correct: true,
    lastAnswerToCorrect: true,
    finalScores: quiz.scores,
  });

  io.to(room).emit('quizRanking', ranking);
}

async function handleStartQuiz(socket, io) {
  const room = socket.data.room;
  const username = socket.data.username;

  if (!isAdmin(room, username)) {
    return socket.emit('errorMessage', 'Seul l’admin peut démarrer le quiz.');
  }

  const questions = await QuestionModel.aggregate([{ $sample: { size: 30 } }]);
  if (!questions.length) {
    return socket.emit('errorMessage', 'Aucune question disponible dans la base de données.');
  }

  quizzesByRoom.set(room, {
    questions,
    answers: {},
    scores: {},
    currentCorrectionIndex: 0,
    correctionStarted: false,
    correctionResults: new Array(questions.length).fill(false),
    validatedAnswers: {}
  });

  io.to(room).emit('quizReady', { questionsCount: questions.length });
  io.to(room).emit('startQuiz', questions);
  io.to(room).emit('notification', 'Le quiz commence !');
}

function handleSubmitAnswer(socket, data) {
  const room = socket.data.room;
  const username = socket.data.username;

  if (!room) return;

  const quiz = quizzesByRoom.get(room);
  if (!quiz) return;

  const { qIndex, answerIndex } = data;
  if (!Number.isInteger(qIndex) || (answerIndex !== null && !Number.isInteger(answerIndex))) return;

  if (!quiz.answers[username]) quiz.answers[username] = [];

  if (quiz.answers[username][qIndex] !== undefined) return;

  quiz.answers[username][qIndex] = answerIndex;
  quiz.correctionResults[qIndex] = true;

  calculateScoresAndEmit(socket.server, room);
}

function handleCorrectionStep(socket, io, direction) {
  const room = socket.data.room;
  const username = socket.data.username;

  if (!isAdmin(room, username)) {
    return socket.emit('errorMessage', `Seul l’admin peut ${direction === 1 ? 'avancer' : 'revenir en arrière'} dans la correction.`);
  }

  const quiz = quizzesByRoom.get(room);
  if (!room || !quiz || !quiz.correctionStarted) return;

  if (direction === -1 && quiz.currentCorrectionIndex === 0) {
    return socket.emit('errorMessage', 'Déjà à la première question.');
  }

  if (direction === 1 && quiz.currentCorrectionIndex + 1 >= quiz.questions.length) {
    // Fin de correction, calcul scores et émission
    calculateScoresAndEmit(io, room);
    return;
  }

  quiz.currentCorrectionIndex += direction;
  const idx = quiz.currentCorrectionIndex;

  const event = direction === 1 ? 'nextCorrection' : 'previousCorrection';
  io.to(room).emit(event, {
    questionIndex: idx,
    question: quiz.questions[idx],
    userAnswers: quiz.answers,
  });
}

function handleStartCorrection(socket, io) {
  const room = socket.data.room;
  const role = socket.data.role;

  if (!room || role !== 'admin') return;

  const quiz = quizzesByRoom.get(room);
  if (!quiz) return;

  quiz.correctionStarted = true;
  quiz.currentCorrectionIndex = 0;
  quiz.correctionResults = new Array(quiz.questions.length).fill(false);

  io.to(room).emit('startCorrection', {
    questions: quiz.questions,
    userAnswers: quiz.answers,
  });
}

function handleEndCorrection(socket, io) {
  const room = socket.data.room;
  const username = socket.data.username;

  if (!isAdmin(room, username)) {
    return socket.emit('errorMessage', 'Seul l’admin peut terminer la correction.');
  }

  const quiz = quizzesByRoom.get(room);
  if (!room || !quiz || !quiz.correctionStarted) return;

  const questions = quiz.questions;

  Object.entries(quiz.answers).forEach(([user, answers]) => {
    let score = 0;
    answers.forEach((a, i) => {
      if (a !== undefined && a === questions[i]?.correctAnswerIndex) score++;
    });
    quiz.scores[user] = score;
  });

  const ranking = Object.entries(quiz.scores)
    .sort(([, a], [, b]) => b - a)
    .map(([user, score], idx) => ({ rank: idx + 1, user, score }));

  io.to(room).emit('notification', 'Correction terminée ! Voici les scores finaux.');
  io.to(room).emit('showScores', quiz.scores);
  io.to(room).emit('quizRanking', ranking);

  quiz.correctionStarted = false;
}

async function handleRoomSockets(socket, io, username, role) {
  try {
    const safeUsername = username || 'Invité';
    socket.data.username = safeUsername;
    socket.data.role = role;

    socket.on('joinRoom', data => handleJoinRoom(socket, io, data));

    socket.on('sendMessage', data => handleSendMessage(socket, io, data));

    socket.on('typing', room => handleTyping(socket, io, room));

    socket.on('closeRoom', room => handleCloseRoom(socket, io, room));

    socket.on('disconnect', () => {
      const room = socket.data.room;
      if (!room || !usersByRoom.has(room)) return;

      cleanupUserFromRoom(safeUsername, room);
      emitUserList(io, room);
      io.to(room).emit('notification', `${safeUsername} a quitté la room.`);
      socket.to(room).emit('chatMessage', { user: 'System', message: `${safeUsername} a quitté la room.` });
    });

    // Quiz events
    socket.on('startQuiz', () => handleStartQuiz(socket, io));
    socket.on('submitAnswer', data => handleSubmitAnswer(socket, data));
    socket.on('startCorrection', () => handleStartCorrection(socket, io));
    socket.on('endCorrection', () => handleEndCorrection(socket, io));
    socket.on('previousCorrection', () => handleCorrectionStep(socket, io, -1));
    socket.on('nextCorrection', () => handleCorrectionStep(socket, io, 1));

  } catch (error) {
    console.error('Erreur dans handleRoomSockets:', error);
    socket.emit('errorMessage', 'Une erreur est survenue côté serveur.');
  }
}

module.exports = { handleRoomSockets };
