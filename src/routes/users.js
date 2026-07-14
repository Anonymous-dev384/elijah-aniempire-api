const express = require('express')
const router = express.Router()
const { supabase } = require('../config/supabaseClient')
const auth = require('../middleware/auth')

// GET /api/users/:id/profile
router.get('/:id/profile', async (req, res) => {
  try {
    const { id } = req.params
    // profiles table and user_stats, user_achievements
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio, website, created_at')
      .eq('id', id)
      .single()

    if (error) return res.status(404).json({ error: 'Profile not found' })

    const { data: stats } = await supabase.from('user_stats').select('xp, level, credits').eq('user_id', id).single()
    const { data: achievements } = await supabase.from('user_achievements').select('achievement_id,progress,awarded_at').eq('user_id', id)

    return res.json({ profile, stats: stats || null, achievements: achievements || [] })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch profile' })
  }
})

module.exports = router
