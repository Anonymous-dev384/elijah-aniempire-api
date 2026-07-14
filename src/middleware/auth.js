const { supabase } = require('../config/supabaseClient')

// Auth middleware that validates a Supabase access token sent in Authorization: Bearer <token>
// Attaches `req.user` as the Supabase user object on success.
module.exports = async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const match = authHeader.match(/^Bearer (.+)$/)
    if (!match) return res.status(401).json({ error: 'Missing Authorization header' })

    const token = match[1]
    // supabase.auth.getUser accepts { access_token } in v2 SDK
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.user = data.user
    return next()
  } catch (err) {
    console.error('Auth middleware error', err)
    return res.status(500).json({ error: 'Authentication failed' })
  }
}
