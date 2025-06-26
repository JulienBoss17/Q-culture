const express = require("express");
const router = express.Router();

// Page de création ou d'entrée dans une room
router.get("/room/:roomName", (req, res) => {
  if (!req.session.userId) return res.redirect("/login");
  const roomName = req.params.roomName;
  res.render("room", { roomName, currentPath: req.path });
});

module.exports = router;
