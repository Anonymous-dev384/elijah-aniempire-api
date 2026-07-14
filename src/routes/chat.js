const express = require('express')
const router = express.Router()
const { supabase } = require('../config/supabaseClient')
const auth = require('../middleware/auth')

// GET /api/chat/history?channel=global&limit=50&before=<timestamp or id>
router.get('/history', async (req, res) => {
  try {
    const { channel = 'global', limit = 50, before } = req.query
    let query = supabase.from('chat_messages').select('id, user_id, message, channel, created_at').eq('channel', channel).order('created_at', { ascending: false }).limit(Number(limit))

    if (before) {
      // allow before to be either timestamp or id; here we treat as timestamp
      query = query.lt('created_at', before)
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })

    return res.json({ messages: data.reverse() }) // return oldest-first
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch chat history' })
  }
})

module.exports = router
