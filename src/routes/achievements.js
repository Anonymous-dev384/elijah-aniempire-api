const express = require('express')
const router = express.Router()
const { supabase } = require('../config/supabaseClient')

// GET /api/achievements - list achievement metadata
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('achievements').select('*').order('tier', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ achievements: data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch achievements' })
  }
})

module.exports = router
