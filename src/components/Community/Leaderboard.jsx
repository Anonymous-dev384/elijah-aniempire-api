/**
 * Leaderboard Component - Display top users by various metrics
 */
import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { motion } from 'framer-motion'

const LEADERBOARD_TYPES = [
  { id: 'xp', label: 'Total XP', icon: '⭐' },
  { id: 'reviews', label: 'Reviews Written', icon: '📝' },
  { id: 'followers', label: 'Most Followers', icon: '👥' },
  { id: 'level', label: 'Highest Level', icon: '🏆' },
]

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([])
  const [selectedType, setSelectedType] = useState('xp')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeaderboard()
  }, [selectedType])

  const fetchLeaderboard = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('user_stats')
        .select('*, profiles(username, avatar_url, is_donor)')
        .order(selectedType === 'xp' ? 'experience' : selectedType, { ascending: false })
        .limit(10)

      const { data, error } = await query
      if (error) throw error
      setLeaderboard(data)
    } catch (err) {
      console.error('Leaderboard error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-text-primary mb-4">Community Leaderboard</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {LEADERBOARD_TYPES.map((type) => (
            <motion.button
              key={type.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setSelectedType(type.id)}
              className={`py-2 px-3 rounded-lg font-semibold text-sm transition ${
                selectedType === type.id
                  ? 'bg-gold text-bg-primary'
                  : 'bg-bg-card border border-border-default text-text-secondary hover:border-gold'
              }`}
            >
              {type.icon} {type.label}
            </motion.button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-muted">Loading leaderboard...</div>
      ) : (
        <div className="space-y-2">
          {leaderboard.map((user, rank) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: rank * 0.05 }}
              className="bg-bg-card border border-border-subtle rounded-lg p-4 flex items-center gap-4"
            >
              {/* Rank Medal */}
              <div className="text-2xl font-bold w-8 text-center">
                {rank === 0 && '🥇'}
                {rank === 1 && '🥈'}
                {rank === 2 && '🥉'}
                {rank > 2 && `#${rank + 1}`}
              </div>

              {/* User Info */}
              <div className="flex items-center gap-3 flex-1">
                <img
                  src={user.profiles?.avatar_url || '/avatar-placeholder.png'}
                  alt={user.profiles?.username}
                  className="w-12 h-12 rounded-full"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-text-primary truncate">
                      {user.profiles?.username}
                    </p>
                    {user.profiles?.is_donor && (
                      <span className="text-xs bg-gold text-bg-primary px-2 py-0.5 rounded">DONOR</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted">Level {user.level || 1}</p>
                </div>
              </div>

              {/* Score */}
              <div className="text-right">
                <p className="text-lg font-bold text-gold">
                  {selectedType === 'xp' && `${user.experience || 0} XP`}
                  {selectedType === 'reviews' && `${user.reviews_count || 0}`}
                  {selectedType === 'followers' && `${user.followers_count || 0}`}
                  {selectedType === 'level' && `Level ${user.level || 1}`}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
