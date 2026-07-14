const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { supabase } = require('../config/supabaseClient')

// POST /api/activity/rewards - trigger reward distribution
// Body can be: { user_id?, type: 'activity'|'daily'|'achievement', amount, reason }
// If user_id omitted and you provide criteria, this endpoint can be used to bulk-award (admin use)
router.post('/rewards', auth, async (req, res) => {
  try {
    const { user_id, type = 'activity', amount = 0, reason = 'reward' } = req.body

    if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount is required and must be a number' })

    // If user_id provided, award that user
    if (user_id) {
      // Update user_stats (xp / credits) atomically via single update
      const { data, error } = await supabase
        .from('user_stats')
        .update({ xp: supabase.raw('xp + ?', [amount]) })
        .eq('user_id', user_id)

      // Fallback: if no stats row, insert one
      if (error) {
        console.warn('update user_stats error, attempting upsert', error.message)
        // try upsert
        const upsert = await supabase.from('user_stats').upsert({ user_id, xp: amount }, { onConflict: ['user_id'] })
        if (upsert.error) return res.status(500).json({ error: upsert.error.message })
        return res.json({ ok: true, message: 'Reward granted', details: upsert.data })
      }

      // record activity
      await supabase.from('activity_rewards').insert([{ user_id, amount, type, reason }])

      return res.json({ ok: true, message: 'Reward granted', details: data })
    }

    // If no user_id, this route acts as an admin broadcast (not allowed for normal users)
    // For safety, check user's role in metadata (simple check) - require admin flag
    const requester = req.user
    if (!requester?.app_metadata?.is_admin) return res.status(403).json({ error: 'Only admins can broadcast rewards' })

    // Example: award all users a small amount (dangerous -- admin only)
    const { data: users, error: uerr } = await supabase.from('profiles').select('id')
    if (uerr) return res.status(500).json({ error: uerr.message })

    const updates = users.map(u => ({ user_id: u.id, amount, type, reason }))
    await supabase.from('activity_rewards').insert(updates)

    // NOTE: More robust implementations should use RPCs / server-side transactions to update user_stats.
    return res.json({ ok: true, message: `Broadcasted ${amount} ${type} to ${users.length} users` })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to process rewards' })
  }
})

module.exports = router
