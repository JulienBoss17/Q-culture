const Message = require('../models/Message');
const bcrypt = require('bcrypt');
const {
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
  checkRoomPassword // <-- Ajoute ici
} = require('../managers/roomManager');

const { createQuizForRoom, initQuizStorage, storeAnswer, computeFinalScores } = require('../managers/quizManager');

module.exports = async function handleRoomSockets(socket, io, username, role){
  if(!username) return socket.disconnect();
  let currentRoom=null;
  let questionTimer=null;
  const QUESTION_DURATION=10000;

  // JOIN ROOM
socket.on("joinRoom", async ({ room, password }) => {
    if (!room) return socket.emit("errorMessage", "Nom de room manquant.");

    const roomExists = usersByRoom.has(room);

    // room existe
    if (roomExists) {
        const ok = checkRoomPassword(room, password);
        if (!ok) return socket.emit("errorMessage", "Mot de passe incorrect.");
    }
    // room n’existe pas -> seul l’admin peut créer
    else {
        if (role !== "admin") return socket.emit("errorMessage", "La room n’existe pas, seul l’admin peut la créer.");
        createRoom(room, password, username);
    }

    socket.join(room);
    currentRoom = room;
    usersByRoom.get(room).add(username);

    const avatar = await fetchAvatar(username);
    avatarsByUser.set(username, avatar);

    const history = await Message.find({ room }).sort({ createdAt: 1 }).lean();
    socket.emit("chatHistory", history);

    io.to(room).emit("notification", `${username} a rejoint la room.`);
    emitUserList(io, room);

    const quiz = quizzesByRoom.get(room);
    if (quiz && quiz.currentQuestion != null) {
        const remainingTime = quiz.questionEndTime - Date.now();
        socket.emit("startQuiz", { questions: quiz.questions, endTime: Date.now() + remainingTime });
    }

    // signal admin côté client pour afficher les boutons
    if (isAdmin(room, username)) {
        socket.emit("adminPrivileges");
    }
});


  // CHAT
  socket.on("sendMessage", async ({ room, message })=>{
    if(!room||!message) return;
    await Message.create({ room, user: username, message });
    io.to(room).emit("chatMessage",{ user: username, message, createdAt: new Date() });
  });

// Typing indicator
socket.on("typing", (room) => {
    socket.to(room).emit("typing", username); // Envoie aux autres utilisateurs seulement
});


  // START QUIZ (ADMIN)
  socket.on("startQuiz", async ()=>{
    if(!currentRoom||!isAdmin(currentRoom, username)) return socket.emit("errorMessage","Seul l'admin peut lancer un quiz.");

    const { questions } = await createQuizForRoom(currentRoom);
    initQuizStorage(quizzesByRoom, currentRoom, questions);

    const quiz = quizzesByRoom.get(currentRoom);
    quiz.currentQuestion=0;
    quiz.questionEndTime=Date.now()+QUESTION_DURATION;
    io.to(currentRoom).emit("startQuiz",{ questions: quiz.questions, endTime: quiz.questionEndTime });
    startServerTimer(io, currentRoom);
  });

  // SUBMIT ANSWER
  socket.on("submitAnswer", ({ qIndex, answerIndex })=>{
    if(!currentRoom) return;
    const saved = storeAnswer(quizzesByRoom, currentRoom, username, qIndex, answerIndex);
    if(!saved) socket.emit("errorMessage","Réponse déjà envoyée ou quiz non actif.");
  });

  // CLOSE ROOM
  socket.on("closeRoom", ()=>{
    if(!currentRoom||!isAdmin(currentRoom, username)) return;
    io.to(currentRoom).emit("roomClosed","La room a été fermée par l'admin");
    io.socketsLeave(currentRoom);

    cleanupUserFromRoom(username, currentRoom);
    quizzesByRoom.delete(currentRoom);
    roomPasswords.delete(currentRoom);
    roomAdmins.delete(currentRoom);
    usersByRoom.delete(currentRoom);
  });

  // DISCONNECT
  socket.on("disconnect", ()=>{
    if(!currentRoom) return;
    cleanupUserFromRoom(username, currentRoom);
    io.to(currentRoom).emit("notification", `${username} a quitté la room.`);
    emitUserList(io, currentRoom);
  });

  // TIMER SERVEUR
  function startServerTimer(io, roomName){
    const quiz = quizzesByRoom.get(roomName);
    if(!quiz) return;
    if(questionTimer) clearTimeout(questionTimer);

    questionTimer=setTimeout(async ()=>{
        const qIndex = quiz.currentQuestion;

        for(const user in quiz.answers){
            if(quiz.answers[user][qIndex]===null) storeAnswer(quizzesByRoom, roomName, user, qIndex, null);
        }

        if(qIndex<quiz.questions.length-1){
            quiz.currentQuestion++;
            quiz.questionEndTime=Date.now()+QUESTION_DURATION;
            io.to(roomName).emit("nextQuestion",{ qIndex: quiz.currentQuestion, endTime: quiz.questionEndTime });
            startServerTimer(io, roomName);
        } else {
            quiz.currentQuestion=null;
            quiz.questionEndTime=null;
            io.to(roomName).emit("endQuiz");

            const scores = await computeFinalScores(quizzesByRoom, roomName);

            io.to(roomName).emit("startCorrection",{
                questions: quiz.questions,
                userAnswers: quiz.answers,
                correctAnswers: quiz.questions.map(q => q.correctAnswerIndex),
                scores
            });

            const ranking = Object.entries(scores)
                .sort((a,b)=>b[1]-a[1])
                .map(([user,score])=>({ user, score }));
            io.to(roomName).emit("quizRanking", ranking);
        }
    }, QUESTION_DURATION);
  }
};
