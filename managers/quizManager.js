const Question = require('../models/Question');

// Initialise stockage des réponses pour une room
function initQuizStorage(quizzesByRoom, roomName, questions){
  quizzesByRoom.set(roomName,{
    questions,
    answers: {} // username => [answerIndex,...]
  });
}

// Génère un quiz (10 questions aléatoires)
async function createQuizForRoom(roomName){
  const questions = await Question.aggregate([{ $sample: { size: 10 } }]);
  return { questions };
}

// Stocke une réponse
function storeAnswer(quizzesByRoom, roomName, username, qIndex, answerIndex){
  const quiz = quizzesByRoom.get(roomName);
  if(!quiz) return false;
  if(!quiz.answers[username]) quiz.answers[username] = new Array(quiz.questions.length).fill(null);
  if(quiz.answers[username][qIndex] !== null) return false;
  quiz.answers[username][qIndex] = answerIndex;
  return true;
}

// Calcule scores finaux
async function computeFinalScores(quizzesByRoom, roomName, QuestionModel){
  const quiz = quizzesByRoom.get(roomName);
  if(!quiz) return {};

  const scores = {};
  const questions = quiz.questions;

  for(const [username, userAnswers] of Object.entries(quiz.answers)){
    let score = 0;
    userAnswers.forEach((ans, idx) => {
      if(ans !== null && ans === questions[idx].correctAnswerIndex) score++;
    });
    scores[username] = score;
  }

  return scores;
}

module.exports = {
  createQuizForRoom,
  initQuizStorage,
  storeAnswer,
  computeFinalScores
};
