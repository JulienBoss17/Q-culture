const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  text: String,
  answers: [String],
  correctAnswerIndex: Number,
  media: [{
    type: { type: String, enum: ['image', 'audio', 'video'], required: true },
    url: { type: String, required: true },
  }],
});




module.exports = mongoose.model('Question', QuestionSchema);
