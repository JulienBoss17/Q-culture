const Message = require('../models/Message');
const bcrypt = require('bcrypt');
const { usersByRoom, roomPasswords, roomAdmins, avatarsByUser, quizzesByRoom,
        fetchAvatar, emitUserList, isAdmin, createRoom, cleanupUserFromRoom } = require('../managers/roomManager');
const { createQuizForRoom, initQuizStorage, storeAnswer, computeFinalScores } = require('../managers/quizManager');

module.exports = async function handleRoomSockets(socket, io, username, role) {
  if (!username) return socket.disconnect();
  let currentRoom = null;
  let currentQuestionIndex = 0;
  let questionTimer = null;

  // ==== JOIN ROOM ====
  socket.on("joinRoom", async ({ room, password }) => {
    if (!room) return socket.emit("errorMessage", "Nom de room manquant.");

    const exists = roomPasswords.has(room);
    if (exists) {
      const hashed = roomPasswords.get(room);
      if (!password) return socket.emit("errorMessage", "Mot de passe requis.");
      const ok = await bcrypt.compare(password, hashed);
      if (!ok) return socket.emit("errorMessage", "Mot de passe incorrect.");
    } else {
      const hashedPwd = await bcrypt.hash(password || "", 10);
      createRoom(room, hashedPwd, username);
    }

    socket.join(room);
    currentRoom = room;

    const set = usersByRoom.get(room);
    set.add(username);

    const avatar = await fetchAvatar(username);
    avatarsByUser.set(username, avatar);

    const history = await Message.find({ room }).sort({ createdAt: 1 }).lean();
    socket.emit("chatHistory", history);

    io.to(room).emit("notification", `${username} a rejoint la room.`);
    emitUserList(io, room);

    // Si quiz actif, envoyer la question en cours et le temps restant
    const quiz = quizzesByRoom.get(room);
    if (quiz && quiz.currentQuestion != null) {
      const endTime = quiz.questionEndTime || Date.now();
      socket.emit("startQuiz", { questions: quiz.questions, endTime });
    }
  });

  // ==== CHAT ====
  socket.on("sendMessage", async ({ room, message }) => {
    if (!room || !message) return;
    await Message.create({ room, user: username, message });
    io.to(room).emit("chatMessage", { user: username, message, createdAt: new Date() });
  });

  socket.on("typing", room => {
    io.to(room).emit("typing", username);
  });

  // ==== START QUIZ (ADMIN) ====
  socket.on("startQuiz", async () => {
    if (!currentRoom || !isAdmin(currentRoom, username)) return socket.emit("errorMessage", "Seul l'admin peut lancer un quiz.");

    const { questions } = await createQuizForRoom(currentRoom);
    initQuizStorage(quizzesByRoom, currentRoom, questions);

    const quiz = quizzesByRoom.get(currentRoom);
    quiz.currentQuestion = 0;
    quiz.questionEndTime = Date.now() + 15000; // 15s pour la première question

    io.to(currentRoom).emit("startQuiz", { questions: quiz.questions, endTime: quiz.questionEndTime });

    // Lance le timer serveur
    startServerTimer(io, currentRoom);
  });

  // ==== SUBMIT ANSWER ====
  socket.on("submitAnswer", ({ qIndex, answerIndex }) => {
    if (!currentRoom) return;
    const saved = storeAnswer(quizzesByRoom, currentRoom, username, qIndex, answerIndex);
    if (!saved) socket.emit("errorMessage", "Réponse déjà envoyée ou quiz non actif.");
  });

  // ==== START CORRECTION (ADMIN) ====
  socket.on("startCorrection", async () => {
    if (!currentRoom || !isAdmin(currentRoom, username)) return;

    const quiz = quizzesByRoom.get(currentRoom);
    if (!quiz) return;

    io.to(currentRoom).emit("startCorrection", { questions: quiz.questions, userAnswers: quiz.answers });

    const scores = await computeFinalScores(quizzesByRoom, currentRoom);
    io.to(currentRoom).emit("showScores", scores);

    const ranking = Object.entries(scores)
      .sort((a,b)=>b[1]-a[1])
      .map(([u,s])=>({ user:u, score:s }));
    io.to(currentRoom).emit("quizRanking", ranking);
  });

  // ==== CLOSE ROOM (ADMIN) ====
socket.on("closeRoom", () => {
    if (!currentRoom || !isAdmin(currentRoom, username)) return;

    const room = currentRoom;

    // Notifier tout le monde et stopper le quiz
    io.to(room).emit("roomClosed", "La room a été fermée par l'admin");

    // Déconnecter tous les sockets de la room
    io.socketsLeave(room);

    // Nettoyer toutes les données côté serveur
    cleanupUserFromRoom(username, room);
    quizzesByRoom.delete(room);
    roomPasswords.delete(room);
    roomAdmins.delete(room);
    usersByRoom.delete(room);
});




  // ==== DISCONNECT ====
  socket.on("disconnect", () => {
    if (!currentRoom) return;
    cleanupUserFromRoom(username, currentRoom);
    io.to(currentRoom).emit("notification", `${username} a quitté la room.`);
    emitUserList(io, currentRoom);
  });


  // ==== TIMER SERVEUR PAR QUESTION ====
  function startServerTimer(io, roomName){
    const quiz = quizzesByRoom.get(roomName);
    if(!quiz) return;

    if(questionTimer) clearTimeout(questionTimer);

    questionTimer = setTimeout(()=>{
      const qIndex = quiz.currentQuestion;
      // Pour tous ceux qui n'ont pas répondu
      for(const username in quiz.answers){
        if(quiz.answers[username][qIndex] === null){
          storeAnswer(quizzesByRoom, roomName, username, qIndex, null);
        }
      }

      // Passage à la question suivante
      if(qIndex < quiz.questions.length -1){
        quiz.currentQuestion++;
        quiz.questionEndTime = Date.now() + 15000; // 15s pour la suivante
        io.to(roomName).emit("startQuiz", { questions: quiz.questions, endTime: quiz.questionEndTime });
        startServerTimer(io, roomName);
      } else {
        // Fin du quiz
        quiz.currentQuestion = null;
        quiz.questionEndTime = null;
        io.to(roomName).emit("endQuiz");
        // Calcul classement final
        computeFinalScores(quizzesByRoom, roomName).then(scores=>{
          io.to(roomName).emit("showScores", scores);
          const ranking = Object.entries(scores)
            .sort((a,b)=>b[1]-a[1])
            .map(([u,s])=>({ user:u, score:s }));
          io.to(roomName).emit("quizRanking", ranking);
        });
      }
    }, 15000);
  }
};
