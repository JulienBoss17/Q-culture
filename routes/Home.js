const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User'); 
const router = express.Router();

// Middleware pour injecter user dans les vues
router.use(async (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      res.locals.user = user; // accessible dans toutes les vues EJS
    } catch (err) {
      console.error("Erreur récupération user:", err);
    }
  } else {
    res.locals.user = null;
  }
  next();
});

router.get("/", async (req, res) => {
    res.render("home", { currentPath: req.path }) 
})

// Page d'inscription
router.get('/register', (req, res) => {
  res.render('register', { error: null, user: req.user, currentPath: req.path });
});

router.post('/register', async (req, res) => {
  const { username, password, avatar } = req.body;

  try {
    const existing = await User.findOne({ username });
    if (existing) {
      return res.render("register", { error: "Nom d’utilisateur déjà pris" });
    }

    const allowedAvatars = [
      "avatars/avatar1.svg",
      "avatars/avatar2.svg",
      "avatars/avatar3.svg"
    ];

    const selectedAvatar = allowedAvatars.includes(avatar) ? avatar : "avatars/avatar1.svg";

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed, avatar: selectedAvatar });
    await user.save();

    req.session.userId = user._id;
    res.redirect("/");
  } catch (err) {
    console.error("Erreur d'inscription :", err);
    res.render("register", { error: "Erreur lors de l’inscription" });
  }
});



// Page login
router.get("/login", (req, res) => {
  res.render("login", { error: null, user: req.user, currentPath: req.path });
});

// Login
router.post("/login", async (req, res) => {
    try {
        const user = await User.findOne({ nom: req.body.nom });

        if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
            req.flash("error2", "Utilisateur ou mot de passe incorrect.");
            return res.redirect('/compte');
        }

        user.status = 'Connecté'; 
        await user.save();

        req.session.user = user;
        req.session.userId = user._id;
        req.session.status = user.status;

        req.session.save(err => {
            if (err) {
                console.error('Erreur lors de la sauvegarde de la session:', err);
                return res.status(500).send('Erreur serveur.');
            }
            res.redirect('/'); 
        });
    } catch (error) {
        console.error('Erreur lors de la tentative de connexion:', error);
        res.status(500).send('Erreur serveur.');
    }
})

// Page profil
router.get("/me", async (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login");
  }

  const user = await User.findById(req.session.userId);
  if (!user) {
    return res.redirect("/login");
  }

  res.render("me", { user, currentPath: req.path });  // <-- passer user à la vue
});


// Logout
router.get("/logout", async (req, res) => {
    try {
        const userId = req.session.userId;  

        if (!userId) {
            return res.redirect('/');
        }

        const user = await User.findById(userId);

        if (user) {
            user.status = 'Non connecté';
            await user.save();
        }

        req.session.destroy(err => {
            if (err) {
                return res.status(500).send('Erreur lors de la déconnexion');
            }
            res.redirect('/'); 
        });
    } catch (err) {
        console.error('Erreur lors de la déconnexion:', err.message);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
