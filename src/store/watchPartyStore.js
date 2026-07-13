/**
 * Guild Watch Party Store - Synchronized streaming control
 */
import create from 'zustand'
import { supabase } from '../lib/supabase'

const useWatchPartyStore = create((set, get) => ({
  watchParty: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  loading: false,
  error: null,

  // Initiate watch party
  initiateWatchParty: async (guildId, streamUrl) => {
    try {
      set({ loading: true })
      const user = (await supabase.auth.getUser()).data.user

      const { data, error } = await supabase
        .from('guild_watch_parties')
        .insert([
          {
            guild_id: guildId,
            initiated_by: user.id,
            stream_url: streamUrl,
          },
        ])
        .select()
        .single()

      if (error) throw error
      set({ watchParty: data })
    } catch (err) {
      set({ error: err.message })
    } finally {
      set({ loading: false })
    }
  },

  // Subscribe to watch party updates
  subscribeToWatchParty: async (guildId) => {
    const channel = supabase.channel(`watch-party-${guildId}`)

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'guild_watch_parties',
        filter: `guild_id=eq.${guildId}`,
      },
      (payload) => {
        const update = payload.new
        set({
          isPlaying: update.is_playing,
          currentTime: update.current_playback_time,
        })
      }
    ).subscribe()
  },

  // Control playback
  updatePlayback: async (guildId, isPlaying, currentTime) => {
    try {
      const { error } = await supabase
        .from('guild_watch_parties')
        .update({
          is_playing: isPlaying,
          current_playback_time: currentTime,
        })
        .eq('guild_id', guildId)

      if (error) throw error
      set({ isPlaying, currentTime })
    } catch (err) {
      set({ error: err.message })
    }
  },

  // End watch party
  endWatchParty: async (guildId) => {
    try {
      const { error } = await supabase
        .from('guild_watch_parties')
        .delete()
        .eq('guild_id', guildId)

      if (error) throw error
      set({ watchParty: null, isPlaying: false, currentTime: 0 })
    } catch (err) {
      set({ error: err.message })
    }
  },

  clearError: () => set({ error: null }),
}))

export default useWatchPartyStore
