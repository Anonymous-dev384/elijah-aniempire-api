const express = require('express');
const { adminSupabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/chat/history - supports guildId, userId, limit, before (cursor)
router.get('/history', requireAuth, async (req, res) => {
  const { guildId, userId, limit = 50, before } = req.query;
  try {
    let query = adminSupabase.from('messages').select('*').order('created_at', { ascending: false }).limit(Number(limit));
    if (guildId) query = query.eq('guild_id', guildId);
    if (userId) query = query.eq('user_id', userId);
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ messages: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
