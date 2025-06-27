const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  text: String,
  options: [String],
  correctIndex: Number
});

module.exports = mongoose.model('Question', QuestionSchema);
