const bcrypt = require('bcrypt');
const MessageModel = require('../models/Message');
const UserModel = require('../models/User');
const QuestionModel = require('../models/Question');

// --- Mémoire partagée ---
const usersByRoom = {};       // roomName => Set des usernames
const roomPasswords = {};     // roomName => hashedPassword
const roomAdmins = {};        // roomName => username admin
const avatarsByUser = {};     // username => avatar string
const quizzesByRoom = {};     // roomName => quiz data

function emitUserList(io, room) {
  const users = Array.from(usersByRoom[room] || []).map(username => ({
    username,
    avatar: avatarsByUser[username] || 'avatar1.svg'
  }));
  io.to(room).emit('userList', users);
}

async function handleRoomSockets(socket, io, username, role) {
  try {
    const safeUsername = username || 'Invité';
    socket.data.username = safeUsername;
    socket.data.role = role;

    // --- JOIN ROOM ---
    socket.on('joinRoom', async ({ room, password }) => {
      if (!room || !password) return socket.emit('errorMessage', 'Room ou mot de passe manquant.');

      if (usersByRoom[room]) {
        const passwordMatch = await bcrypt.compare(password, roomPasswords[room]);
        if (!passwordMatch) {
          return socket.emit('errorMessage', 'Mot de passe incorrect pour cette room.');
        }
        if (usersByRoom[room].has(safeUsername)) {
          return socket.emit('errorMessage', 'Ce pseudo est déjà utilisé dans cette room.');
        }
      } else {
        if (socket.data.role !== 'admin') {
          return socket.emit('errorMessage', 'Seul un admin peut créer une nouvelle room.');
        }
        roomPasswords[room] = await bcrypt.hash(password, 10);
        roomAdmins[room] = safeUsername;
        usersByRoom[room] = new Set();
      }

      // Avatar depuis Mongo
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

    // --- ENVOI MESSAGE ---
    socket.on('sendMessage', async ({ room, message }) => {
      if (!room || !message) return;
      const msg = new MessageModel({
        room,
        user: safeUsername,
        message,
        createdAt: new Date()
      });
      await msg.save();
      io.to(room).emit('chatMessage', { user: safeUsername, message });
    });

    // --- TYPING ---
    socket.on('typing', (room) => {
      if (room) io.to(room).emit('typing', safeUsername);
    });

    // --- FERMETURE ROOM ---
    socket.on('closeRoom', (room) => {
      if (roomAdmins[room] !== safeUsername) {
        return socket.emit('errorMessage', 'Seul l’admin peut fermer la room.');
      }

      io.to(room).emit('notification', 'La room a été fermée par l’admin.');
      io.in(room).socketsLeave(room);

      delete usersByRoom[room];
      delete roomPasswords[room];
      delete roomAdmins[room];
      delete quizzesByRoom[room];

      console.log(`[closeRoom] Room "${room}" fermée par ${safeUsername}`);
    });

    // --- DÉCONNEXION ---
    socket.on('disconnect', () => {
      const room = socket.data.room;
      if (!room || !usersByRoom[room]) return;

      usersByRoom[room].delete(safeUsername);
      emitUserList(io, room);
      io.to(room).emit('notification', `${safeUsername} a quitté la room.`);
      socket.to(room).emit('chatMessage', { user: 'System', message: `${safeUsername} a quitté la room.` });

      if (usersByRoom[room].size === 0) {
        delete usersByRoom[room];
        delete roomPasswords[room];
        delete roomAdmins[room];
        delete quizzesByRoom[room];
        console.log(`[disconnect] Suppression de la room vide "${room}"`);
      }

      delete avatarsByUser[safeUsername];
    });

    // === QUIZ ===

    // --- DÉMARRER QUIZ ---
    socket.on('startQuiz', async () => {
      if (socket.data.role !== 'admin') {
        return socket.emit('errorMessage', 'Seul l’admin peut démarrer le quiz.');
      }

      const room = socket.data.room;
      if (!room) return;

      const questions = await QuestionModel.aggregate([{ $sample: { size: 30 } }]);
      if (!questions.length) {
        return socket.emit('errorMessage', 'Aucune question disponible dans la base de données.');
      }

      quizzesByRoom[room] = {
        questions,
        answers: {},  // { username: [index, ...] }
        scores: {},
        currentCorrectionIndex: 0,
        correctionStarted: false,
      };

      io.to(room).emit('quizReady', { questionsCount: questions.length });
      io.to(room).emit('startQuiz', questions);
      io.to(room).emit('notification', 'Le quiz commence !');
    });

    // --- ENVOYER RÉPONSE ---
    socket.on('submitAnswer', ({ qIndex, answerIndex }) => {
      const room = socket.data.room;
      const username = socket.data.username;
      if (!room || !quizzesByRoom[room]) return;
      if (!Number.isInteger(qIndex) || !Number.isInteger(answerIndex)) return;

      const quiz = quizzesByRoom[room];
      if (!quiz.answers[username]) {
        quiz.answers[username] = [];
      }

      // Empêche la modification d'une réponse déjà donnée
      if (quiz.answers[username][qIndex] !== undefined) return;

      quiz.answers[username][qIndex] = answerIndex;
    });

    // --- LANCER CORRECTION ---
    socket.on('startCorrection', () => {
      if (socket.data.role !== 'admin') {
        return socket.emit('errorMessage', 'Seul l’admin peut lancer la correction.');
      }

      const room = socket.data.room;
      const quiz = quizzesByRoom[room];
      if (!room || !quiz) return;

      quiz.correctionStarted = true;
      quiz.currentCorrectionIndex = 0;

      io.to(room).emit('startCorrection', {
        questionIndex: 0,
        question: quiz.questions[0],
        userAnswers: quiz.answers,
      });
      io.to(room).emit('notification', 'Correction du quiz commencée.');
    });

    // --- ÉTAPE SUIVANTE DE CORRECTION ---
    socket.on('nextCorrection', () => {
      if (socket.data.role !== 'admin') {
        return socket.emit('errorMessage', 'Seul l’admin peut avancer dans la correction.');
      }

      const room = socket.data.room;
      const quiz = quizzesByRoom[room];
      if (!room || !quiz || !quiz.correctionStarted) return;

      const questions = quiz.questions;

      if (quiz.currentCorrectionIndex + 1 >= questions.length) {
        // Fin de correction
        Object.entries(quiz.answers).forEach(([user, answers]) => {
          let score = 0;
          answers.forEach((a, i) => {
            if (a !== undefined && a === questions[i].correctIndex) score++;
          });
          quiz.scores[user] = score;
        });

        io.to(room).emit('notification', 'Correction terminée ! Voici les scores finaux.');
        io.to(room).emit('showScores', quiz.scores);

        delete quiz.correctionStarted;
        return;
      }

      quiz.currentCorrectionIndex++;
      const idx = quiz.currentCorrectionIndex;

      io.to(room).emit('nextCorrection', {
        questionIndex: idx,
        question: questions[idx],
        userAnswers: quiz.answers,
      });
    });

  } catch (error) {
    console.error('Erreur dans handleRoomSockets:', error);
    socket.emit('errorMessage', 'Une erreur est survenue côté serveur.');
  }
}

module.exports = { handleRoomSockets };
