const mongoose = require("mongoose");

// définir un modèle
const UserSchema = mongoose.Schema({
    username: {type: String, required: true, unique: true},
    password: {type: String, required: true},
    role: {type: String, enum: ['admin', 'user'], default: 'user'},
    status: {
      type: String,
      enum: ['Connecté', 'Non connecté'], 
      default: 'Non connecté'
    },
    avatar: { type: String, default: "avatars/avatar1.svg" },
})

const User = mongoose.model('User', UserSchema)

module.exports = User