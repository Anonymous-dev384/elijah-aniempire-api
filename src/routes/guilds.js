const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { supabase } = require('../config/supabaseClient')

// GET /api/guilds - list guilds with basic pagination
router.get('/', async (req, res) => {
  try {
    const { page = 1, per_page = 20 } = req.query
    const from = (page - 1) * per_page
    const to = from + Number(per_page) - 1

    const { data, error, count } = await supabase
      .from('guilds')
      .select('id,name,slug,description,owner_id,is_public,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ data, count })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch guilds' })
  }
})

// POST /api/guilds - create a new guild
router.post('/', auth, async (req, res) => {
  try {
    const { name, description = '', is_public = true } = req.body
    if (!name || name.length < 3) return res.status(400).json({ error: 'Name is required (min 3 chars)' })

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    const { data: existing } = await supabase.from('guilds').select('id').eq('slug', slug).limit(1)
    if (existing && existing.length) return res.status(409).json({ error: 'Guild with this name already exists' })

    const { data, error } = await supabase.from('guilds').insert([{ name, slug, description, owner_id: req.user.id, is_public }]).select().single()
    if (error) return res.status(500).json({ error: error.message })

    // Add the owner as a guild member with role 'owner'
    await supabase.from('guild_members').insert([{ guild_id: data.id, user_id: req.user.id, role: 'owner' }])

    return res.status(201).json({ guild: data })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to create guild' })
  }
})

// POST /api/guilds/:id/join - join a guild
router.post('/:id/join', auth, async (req, res) => {
  try {
    const { id } = req.params
    // Check guild exists
    const { data: guild } = await supabase.from('guilds').select('id,is_public,invite_code').eq('id', id).limit(1).single()
    if (!guild) return res.status(404).json({ error: 'Guild not found' })

    // If private, require invite code
    if (!guild.is_public) {
      const { invite_code } = req.body
      if (!invite_code || invite_code !== guild.invite_code) return res.status(403).json({ error: 'Invite code required for private guild' })
    }

    // Check membership
    const { data: membership } = await supabase.from('guild_members').select('id').eq('guild_id', id).eq('user_id', req.user.id).limit(1)
    if (membership && membership.length) return res.status(200).json({ message: 'Already a member' })

    const { error } = await supabase.from('guild_members').insert([{ guild_id: id, user_id: req.user.id, role: 'member' }])
    if (error) return res.status(500).json({ error: error.message })

    return res.json({ message: 'Joined guild' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to join guild' })
  }
})

module.exports = router
