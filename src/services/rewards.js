const { adminSupabase } = require('../lib/supabase');

// Reward distribution service using a Postgres RPC for atomic updates when applying changes
async function distribute({ action, amount = 10, guildId = null, dryRun = true, criteria = {} }) {
  // Validation
  if (!['daily', 'guild', 'event'].includes(action)) throw new Error('Invalid action');
  if (action === 'guild' && !guildId) throw new Error('guildId is required for guild distributions');
  if (action === 'event' && (!criteria.userIds || !Array.isArray(criteria.userIds) || criteria.userIds.length === 0)) throw new Error('criteria.userIds is required for event distributions');

  // Dry-run: preview affected users without making changes
  if (dryRun) {
    if (action === 'daily') {
      const { data, error } = await adminSupabase.from('users').select('id, credits, xp');
      if (error) throw new Error(error.message);
      return {
        ok: true,
        report: {
          action,
          amount,
          affected: data.length,
          dryRun: true,
          changes: data.map((u) => ({ id: u.id, oldCredits: u.credits || 0, newCredits: (u.credits || 0) + amount }))
        }
      };
    }

    if (action === 'guild') {
      const { data: members, error: mErr } = await adminSupabase.from('guild_members').select('user_id').eq('guild_id', guildId);
      if (mErr) throw new Error(mErr.message);
      const ids = members.map((m) => m.user_id);
      const { data, error } = await adminSupabase.from('users').select('id, credits, xp').in('id', ids);
      if (error) throw new Error(error.message);
      return {
        ok: true,
        report: {
          action,
          amount,
          guildId,
          affected: data.length,
          dryRun: true,
          changes: data.map((u) => ({ id: u.id, oldCredits: u.credits || 0, newCredits: (u.credits || 0) + amount }))
        }
      };
    }

    if (action === 'event') {
      const ids = criteria.userIds;
      const { data, error } = await adminSupabase.from('users').select('id, credits, xp').in('id', ids);
      if (error) throw new Error(error.message);
      return {
        ok: true,
        report: {
          action,
          amount,
          affected: data.length,
          dryRun: true,
          changes: data.map((u) => ({ id: u.id, oldCredits: u.credits || 0, newCredits: (u.credits || 0) + amount }))
        }
      };
    }
  }

  // Apply: call the Postgres RPC for atomic updates
  try {
    const rpcParams = {
      action,
      amount: Number(amount),
      guild_id: guildId,
      user_ids: (criteria.userIds && criteria.userIds.length) ? criteria.userIds : null
    };

    const { data, error } = await adminSupabase.rpc('distribute_rewards', rpcParams);
    if (error) throw new Error(error.message);
    return { ok: true, report: { action, amount, affected: data.length, dryRun: false, changes: data } };
  } catch (err) {
    throw err;
  }
}

module.exports = { distribute };
