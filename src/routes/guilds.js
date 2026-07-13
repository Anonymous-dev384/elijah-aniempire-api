const express = require('express');
const Joi = require('joi');
const { adminSupabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/guilds - list guilds with pagination & search
router.get('/', async (req, res) => {
  const { q, limit = 20, offset = 0 } = req.query;
  try {
    let query = adminSupabase.from('guilds').select('*').order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (q) query = adminSupabase.from('guilds').select('*').ilike('name', `%${q}%`).range(Number(offset), Number(offset) + Number(limit) - 1);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ guilds: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/guilds - create guild (owner=auth user)
const createSchema = Joi.object({ name: Joi.string().min(3).required(), description: Joi.string().allow('').optional() });
router.post('/', requireAuth, async (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try {
    const payload = { name: value.name, description: value.description || '', owner_id: req.user.id, created_at: new Date().toISOString() };
    const { data, error: supError } = await adminSupabase.from('guilds').insert([payload]).select().single();
    if (supError) return res.status(400).json({ error: supError.message });
    return res.status(201).json({ guild: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/guilds/:id/join - join guild
router.post('/:id/join', requireAuth, async (req, res) => {
  const guildId = req.params.id;
  try {
    // upsert membership
    const membership = { guild_id: guildId, user_id: req.user.id, joined_at: new Date().toISOString() };
    const { data, error } = await adminSupabase.from('guild_members').upsert(membership).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ membership: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
