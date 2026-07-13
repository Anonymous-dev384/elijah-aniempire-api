const express = require('express');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { anonSupabase, adminSupabase } = require('../lib/supabase');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret';

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  username: Joi.string().min(3).optional()
});

router.post('/register', async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const { email, password, username } = value;
  try {
    // Create user via Supabase (admin) to avoid email confirmation complexity
    const { data, error: supError } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (supError) return res.status(400).json({ error: supError.message });

    // create profile row in users table (if you have one)
    await adminSupabase.from('users').upsert({ id: data.user.id, email, username, role: 'user' });

    const token = jwt.sign({ sub: data.user.id }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: data.user.id, email, username } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

router.post('/login', async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const { email, password } = value;
  try {
    const { data, error: supError } = await anonSupabase.auth.signInWithPassword({ email, password });
    if (supError) return res.status(401).json({ error: supError.message });
    const userId = data.user.id;
    const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: userId, email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Discord OAuth skeleton - redirect to Supabase or Discord
router.get('/discord', (req, res) => {
  // Optional: redirect to Supabase OAuth endpoint or build Discord OAuth URL
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  return res.json({ message: 'Discord OAuth skeleton. Configure frontend to call Supabase OAuth endpoint.' });
});

module.exports = router;
