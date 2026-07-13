const express = require('express');
const { adminSupabase } = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /api/activity/rewards - admin only; distribute rewards based on a payload
router.post('/rewards', requireAuth, requireAdmin, async (req, res) => {
  const { action } = req.body; // e.g., 'daily', 'event', or custom rules
  try {
    // This is a simple example: grant 10 credits to all active users
    if (action === 'daily') {
      const { data, error } = await adminSupabase.from('users').update({ credits: adminSupabase.rpc ? 0 : 0 });
      // Above update is a placeholder; implement business rules as needed
      return res.json({ message: 'Rewards dispatched (placeholder)', debug: { data, error } });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/achievements - list achievement metadata
router.get('/achievements', async (req, res) => {
  try {
    const { data, error } = await adminSupabase.from('achievements_meta').select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ achievements: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leaderboard - top players by xp
router.get('/leaderboard', async (req, res) => {
  const { limit = 50 } = req.query;
  try {
    const { data, error } = await adminSupabase.from('users').select('id, username, xp, credits').order('xp', { ascending: false }).limit(Number(limit));
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ leaderboard: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
