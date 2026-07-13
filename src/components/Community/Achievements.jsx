/**
 * Achievements Component - Display user achievements
 */
import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { motion } from 'framer-motion'

const ACHIEVEMENT_RARITY = {
  common: { color: 'text-gray-300', bg: 'bg-gray-500/20', border: 'border-gray-500' },
  rare: { color: 'text-blue-300', bg: 'bg-blue-500/20', border: 'border-blue-500' },
  epic: { color: 'text-purple-300', bg: 'bg-purple-500/20', border: 'border-purple-500' },
  legendary: { color: 'text-gold', bg: 'bg-gold/20', border: 'border-gold' },
}

export default function Achievements({ userId }) {
  const [achievements, setAchievements] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedAch, setSelectedAch] = useState(null)

  useEffect(() => {
    fetchAchievements()
  }, [userId])

  const fetchAchievements = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*, achievements(*)')
        .eq('user_id', userId)

      if (error) throw error
      setAchievements(data)
    } catch (err) {
      console.error('Achievement fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="text-center py-12">Loading achievements...</div>

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-text-primary">Achievements</h2>

      {achievements.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          No achievements yet. Keep exploring!
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {achievements.map((ach) => {
            const rarity = ach.achievements?.rarity || 'common'
            const achStyle = ACHIEVEMENT_RARITY[rarity]

            return (
              <motion.button
                key={ach.id}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedAch(ach)}
                className={`aspect-square rounded-lg border-2 p-3 flex flex-col items-center justify-center text-center gap-2 transition ${
                  achStyle.bg
                } border-${rarity === 'common' ? 'gray-500' : rarity === 'rare' ? 'blue-500' : rarity === 'epic' ? 'purple-500' : 'gold'}`}
              >
                <span className="text-3xl">{ach.achievements?.icon}</span>
                <p className={`text-xs font-bold ${achStyle.color}`}>
                  {ach.achievements?.title}
                </p>
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Achievement Detail Modal */}
      {selectedAch && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setSelectedAch(null)}
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="bg-bg-card border border-border-subtle rounded-lg p-6 max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <p className="text-5xl mb-4">{selectedAch.achievements?.icon}</p>
              <h3 className="text-2xl font-bold text-text-primary mb-2">
                {selectedAch.achievements?.title}
              </h3>
              <p className="text-sm text-text-secondary mb-4">
                {selectedAch.achievements?.description}
              </p>
              <span className={`inline-block px-4 py-2 rounded-lg font-bold text-sm capitalize ${
                selectedAch.achievements?.rarity === 'common' ? 'bg-gray-500/20 text-gray-300' :
                selectedAch.achievements?.rarity === 'rare' ? 'bg-blue-500/20 text-blue-300' :
                selectedAch.achievements?.rarity === 'epic' ? 'bg-purple-500/20 text-purple-300' :
                'bg-gold/20 text-gold'
              }`}>
                {selectedAch.achievements?.rarity}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}
