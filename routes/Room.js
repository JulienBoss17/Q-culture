const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get("/room/:roomName", async (req, res) => {
  if (!req.session.userId) return res.redirect("/login");

  const user = await User.findById(req.session.userId);
  if (!user) return res.redirect("/login");

  const roomName = req.params.roomName;
  const userRole = user.role || "participant";

  res.render("room", {
    roomName,
    userRole,
    user
  });
});

module.exports = router;
