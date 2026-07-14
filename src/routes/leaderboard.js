const express = require('express')
const router = express.Router()
const { supabase } = require('../config/supabaseClient')

// GET /api/leaderboard?limit=50
router.get('/', async (req, res) => {
  try {
    const { limit = 50 } = req.query
    // user_stats table with xp and level; join profiles for username
    const { data, error } = await supabase
      .from('user_stats')
      .select('user_id, xp, level, profiles(username, avatar_url)')
      .order('xp', { ascending: false })
      .limit(Number(limit))

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ leaderboard: data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch leaderboard' })
  }
})

module.exports = router
