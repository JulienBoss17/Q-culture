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
    console.log(`[handleRoomSockets] ${safeUsername} connecté avec le rôle ${role}`);

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
  const room = socket.data.room;
  const username = socket.data.username;
  console.log(`[startQuiz] Reçu de ${username} dans room ${room}`);

  if (roomAdmins[room] !== username) {
    return socket.emit('errorMessage', 'Seul l’admin peut démarrer le quiz.');
  }

  const questions = await QuestionModel.aggregate([{ $sample: { size: 30 } }]);
  if (!questions.length) {
    return socket.emit('errorMessage', 'Aucune question disponible dans la base de données.');
  }

  console.log(`[startQuiz] ${questions.length} questions récupérées`);
  console.log(`[startQuiz] Exemple de question:`, questions[0]);

  quizzesByRoom[room] = {
    questions,
    answers: {},            // username => array des réponses (indexes)
    scores: {},             // username => score final
    currentCorrectionIndex: 0,
    correctionStarted: false,
    correctionResults: new Array(questions.length).fill(false),
    validatedAnswers: {}  // { questionIndex: [0, 2], ... }
  };

  console.log(`[startQuiz] Quiz initialisé pour room ${room}`);

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
  if (!quiz.answers[username]) quiz.answers[username] = [];

  if (quiz.answers[username][qIndex] !== undefined) return;

  quiz.answers[username][qIndex] = answerIndex;
  console.log(`[submitAnswer] ${username} dans ${room} a répondu ${answerIndex} à Q${qIndex}`);

  // Marquer la question corrigée automatiquement si correction auto
  quiz.correctionResults[qIndex] = true;

  // Calculer les scores dès que toutes les questions sont corrigées
  calculateAndEmitScores(room);
});


// --- LANCER CORRECTION ---
socket.on("startCorrection", () => {
  const room = socket.data.room;
  const username = socket.data.username;
  const role = socket.data.role;

  if (!room || role !== "admin") return;

  const quiz = quizzesByRoom[room];
  if (!quiz) return;

  quiz.correctionStarted = true;
  quiz.currentCorrectionIndex = 0;
  quiz.correctionResults = new Array(quiz.questions.length).fill(false);

  console.log(`[startCorrection] Lancement demandé par ${username}`);
  console.log(`[startCorrection] Correction lancée pour room ${room}`);

  io.to(room).emit("startCorrection", {
    questions: quiz.questions,
    userAnswers: quiz.answers,
  });
});

// --- ÉTAPE PRÉCÉDENTE DE CORRECTION ---
socket.on('previousCorrection', () => {
  const room = socket.data.room;
  const username = socket.data.username;

  if (roomAdmins[room] !== username) {
    return socket.emit('errorMessage', 'Seul l’admin peut revenir en arrière dans la correction.');
  }

  const quiz = quizzesByRoom[room];
  if (!room || !quiz || !quiz.correctionStarted) return;

  if (quiz.currentCorrectionIndex === 0) {
    return socket.emit('errorMessage', 'Déjà à la première question.');
  }

  quiz.currentCorrectionIndex--;
  const idx = quiz.currentCorrectionIndex;

  io.to(room).emit('previousCorrection', {
    questionIndex: idx,
    question: quiz.questions[idx],
    userAnswers: quiz.answers,
  });
});

// --- TERMINER MANUELLEMENT LA CORRECTION ---
socket.on('endCorrection', () => {
  const room = socket.data.room;
  const username = socket.data.username;

  if (roomAdmins[room] !== username) {
    return socket.emit('errorMessage', 'Seul l’admin peut terminer la correction.');
  }

  const quiz = quizzesByRoom[room];
  if (!room || !quiz || !quiz.correctionStarted) return;

  const questions = quiz.questions;

  console.log(`[endCorrection] Calcul scores finaux pour la room: ${room}`);

  Object.entries(quiz.answers).forEach(([user, answers]) => {
    let score = 0;
    console.log(`[endCorrection] Scores pour user: ${user}`);
    answers.forEach((a, i) => {
      const correctAnswer = questions[i]?.correctAnswerIndex;
      console.log(`User ${user} - Q${i} => donné: ${a}, attendu: ${correctAnswer}`);
      if (a !== undefined && a === correctAnswer) score++;
    });
    quiz.scores[user] = score;
    console.log(`[endCorrection] Score final ${user}: ${score}`);
  });

  const ranking = Object.entries(quiz.scores)
    .sort(([, a], [, b]) => b - a)
    .map(([user, score], idx) => ({ rank: idx + 1, user, score }));

  io.to(room).emit('notification', 'Correction terminée ! Voici les scores finaux.');
  io.to(room).emit('showScores', quiz.scores);
  io.to(room).emit('quizRanking', ranking);

  quiz.correctionStarted = false;
});

// --- ÉTAPE SUIVANTE DE CORRECTION ---
socket.on('nextCorrection', () => {
  const room = socket.data.room;
  const username = socket.data.username;

  if (roomAdmins[room] !== username) {
    return socket.emit('errorMessage', 'Seul l’admin peut avancer dans la correction.');
  }

  const quiz = quizzesByRoom[room];
  if (!room || !quiz || !quiz.correctionStarted) return;

  const questions = quiz.questions;

  if (quiz.currentCorrectionIndex + 1 >= questions.length) {
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

// --- Validation d'une réponse corrigée par l'admin ---
// socket.on('validateCorrectionAnswer', ({ questionIndex }) => {
//   const room = socket.data.room;
//   const username = socket.data.username;

//   if (roomAdmins[room] !== username) {
//     return socket.emit('errorMessage', 'Seul l’admin peut valider une correction.');
//   }

//   const quiz = quizzesByRoom[room];
//   if (!room || !quiz || !quiz.correctionStarted) return;

//   if (
//     typeof questionIndex !== 'number' ||
//     questionIndex < 0 ||
//     questionIndex >= quiz.questions.length
//   ) {
//     return socket.emit('errorMessage', 'Index de question invalide.');
//   }

//   quiz.correctionResults[questionIndex] = true;
//   console.log(`[validateCorrectionAnswer] Q${questionIndex} validée par ${username}`);

//   const allCorrected = quiz.correctionResults.every(v => v === true);
//   console.log(`[validateCorrectionAnswer] Toutes corrigées ? ${allCorrected}`);

//   if (allCorrected) {
//     const questions = quiz.questions;

//     Object.entries(quiz.answers).forEach(([user, answers]) => {
//       let score = 0;
//       answers.forEach((a, i) => {
//         const expected = questions[i].correctAnswerIndex;
//         console.log(`User ${user} - Q${i} => donné: ${a}, attendu: ${expected}, corrigé: ${quiz.correctionResults[i]}`);
//         if (a !== undefined && quiz.correctionResults[i] && a === expected) {
//           score++;
//         }
//       });
//       quiz.scores[user] = score;
//       console.log(`[validateCorrectionAnswer] Score final ${user}: ${score}`);
//     });

//     const ranking = Object.entries(quiz.scores)
//       .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
//       .slice(0, 55)
//       .map(([user, score], rank) => ({ rank: rank + 1, user, score }));

//     quiz.correctionStarted = false;

//     io.to(room).emit('answerCorrectionResult', {
//       questionIndex,
//       answerIndex: quiz.answers,
//       correct: true,
//       lastAnswerToCorrect: true,
//       finalScores: quiz.scores,
//     });

//     io.to(room).emit('quizRanking', ranking);
//   } else {
//     io.to(room).emit('answerCorrectionResult', {
//       questionIndex,
//       answerIndex: quiz.answers,
//       correct: true,
//       lastAnswerToCorrect: false,
//       finalScores: null,
//     });
//   }
// });

function calculateAndEmitScores(room) {
  const quiz = quizzesByRoom[room];
  if (!quiz) return;

  // Vérifier que toutes les questions sont corrigées
  const allCorrected = quiz.correctionResults.every(v => v === true);
  if (!allCorrected) return; // On ne calcule que si tout est corrigé

  const questions = quiz.questions;

  Object.entries(quiz.answers).forEach(([user, answers]) => {
    let score = 0;
    answers.forEach((a, i) => {
      const expected = questions[i].correctAnswerIndex;
      if (a !== undefined && quiz.correctionResults[i] && a === expected) {
        score++;
      }
    });
    quiz.scores[user] = score;
  });

  const ranking = Object.entries(quiz.scores)
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .slice(0, 55)
    .map(([user, score], rank) => ({ rank: rank + 1, user, score }));

  quiz.correctionStarted = false;

  io.to(room).emit('answerCorrectionResult', {
    correct: true,
    lastAnswerToCorrect: true,
    finalScores: quiz.scores,
  });

  io.to(room).emit('quizRanking', ranking);
}


  } catch (error) {
    console.error('Erreur dans handleRoomSockets:', error);
    socket.emit('errorMessage', 'Une erreur est survenue côté serveur.');
  }
}

module.exports = { handleRoomSockets };
