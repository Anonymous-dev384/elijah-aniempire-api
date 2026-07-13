const express = require('express');
const { adminSupabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/users/:id/profile
router.get('/:id/profile', requireAuth, async (req, res) => {
  const userId = req.params.id;
  try {
    const { data: profile, error } = await adminSupabase.from('users').select('id, email, username, xp, credits, role').eq('id', userId).single();
    if (error) return res.status(404).json({ error: 'User not found' });

    // achievements & guilds
    const { data: achievements } = await adminSupabase.from('achievements').select('*').eq('user_id', userId);
    const { data: guilds } = await adminSupabase.from('guild_members').select('guild_id').eq('user_id', userId);

    return res.json({ profile, achievements, guilds });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
