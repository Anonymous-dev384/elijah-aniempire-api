const jwt = require('jsonwebtoken');
const { adminSupabase } = require('../lib/supabase');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.warn('JWT_SECRET is not set.');

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await adminSupabase.from('users').select('role').eq('id', userId).single();
    if (error || !data) return res.status(403).json({ error: 'Forbidden' });
    if (data.role !== 'admin' && data.role !== 'staff') return res.status(403).json({ error: 'Forbidden' });
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  requireAuth,
  requireAdmin
};
