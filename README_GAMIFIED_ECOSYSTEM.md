# AniEmpire Gamified Ecosystem Documentation

## Overview

Complete gamified community ecosystem for AniEmpire featuring profiles, guilds, real-time chat, activity rewards, and watch parties.

---

## 1. DATABASE SCHEMA

### Profiles Enhancement
- `faction`: User's anime affinity (shonen, seinen, shoujo, cyberpunk)
- `gender_title_pref`: Preference for title gender (male, female, neutral)
- `custom_url`: Unique profile URL slug
- `profile_effect_iframe_url`: URL to iframe-based profile animation
- `avatar_border_css`: Custom CSS for avatar border styling
- `status_state`: Current online status (online, lurk, offline)
- `is_donor`: Donor status for reward multipliers
- `is_staff`: Staff member flag

### Hierarchy Title Function

Dynamic user titles based on XP levels:

```
Level 1-4 (0-499 XP): Peasant
Level 5-14 (500-1499 XP): Knight
Level 15-29 (1500-2999 XP): Noble
Level 30-44 (3000-4499 XP): High Priest/Priestess
Level 45-59 (4500-5999 XP): King/Queen/Sovereign
Level 60+ (6000+ XP): Overlord/Deity
```

### Activity Rewards System

**Episodes Tracked**: +10 XP, +5 Credits (Max 100/day)
**Review Written**: +100 XP, +50 Credits (Min 200 chars)
**Chat Message**: +2 XP, +1 Credit (10-sec cooldown)

**Donor Multipliers**:
- XP: 1.25x
- Credits: 1.5x

### Guilds System

- Max 30 members per guild (configurable)
- One guild per user (unique constraint)
- Owner can manage members and settings
- Guild XP for collective progression
- Watch party synchronization

### Real-time Chat

- Global chat (guild_id IS NULL)
- Guild-specific rooms
- Supabase Realtime subscriptions
- System message support
- Spam protection (10-sec cooldown)

---

## 2. STATE MANAGEMENT (Zustand)

### chatStore.js

```javascript
// State
globalMessages[]        // Global chat history
guildMessages[]         // Guild-specific messages
activeRoom             // Current room: 'global' or guild_id
cooldownActive         // Chat rate limiting
cooldownTime           // Seconds remaining

// Actions
subscribeToChat(guildId)      // Real-time subscription
sendMessage(content, guildId) // Send with validation
fetchHistory(guildId, limit)  // Load past messages
handleCommand(command)        // /lurk, /hype
```

### guildStore.js

```javascript
// State
guilds[]              // Available guilds
currentGuild          // User's current guild
guildMembers[]        // Guild member list

// Actions
fetchGuilds()              // List all guilds
createGuild(name, desc)    // Create (level >= 5)
joinGuild(guildId)         // Join (1 guild limit)
leaveGuild()               // Leave/disband
fetchGuildDetails(id)      // Full guild info
```

---

## 3. FRONTEND COMPONENTS

### OnboardingWizard (3-Step Setup)

**Step 1: Character Setup**
- Username input (3-30 chars)
- Gender title preference (M/F/N)
- Real-time validation

**Step 2: Faction Alignment**
- 4 faction choices with descriptions
- Visual preview with gradient backgrounds
- Anime theme icons

**Step 3: Profile Effects**
- 3 free effect templates:
  - Cherry Blossoms (drifting animation)
  - Digital Rain (matrix-style code)
  - Ember Glow (particle effect)
- Live preview via iframe
- Selected effect saved to profile

### UserProfile

- Dynamic hierarchy title display
- Level progress bar with XP
- Avatar with custom border CSS
- Profile effect iframe renderer (mix-blend-screen)
- Statistics display (anime/manga/reviews)
- Donor/Staff badges
- Status indicator

### ChatInterface

- Global & Guild chat tabs
- Real-time message sync
- User hierarchy titles with name glow
- Donor/Staff/Status indicators
- 10-second cooldown progress bar
- Command support (/lurk, /hype)
- Spam protection
- Auto-scroll to latest message
- Empty state handling

### GuildHideout

**No Guild State**:
- Create guild button (disabled <level 5
- List of available guilds with join button
- Guild preview cards (level, members, description)

**In Guild State**:
- Guild header with stats
- Member list with roles
- Leave button
- Watch party widget:
  - URL input for stream
  - Synchronized controls (play/pause/seek)
  - Broadcast via Supabase channels
- Chat sidebar (responsive, hidden on mobile)

---

## 4. SUPABASE REALTIME SETUP

### Enable Realtime on Tables

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE guild_watch_parties;
```

### Realtime Subscriptions

```javascript
const channel = supabase
  .channel('guild-123')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: 'guild_id=eq.123'
    },
    (payload) => {
      // Handle new message
    }
  )
  .subscribe()
```

---

## 5. SECURITY

### Row Level Security (RLS)

- Users can only edit their own profile
- Users can only leave their own guild (or if owner)
- Messages visible to all but deletable by author/staff
- Guild settings locked to owner/officers
- Watch party controls for guild leadership

### Data Validation

- Username: 3-30 chars, alphanumeric + underscore
- Review: Min 200 characters
- Chat: 10-second cooldown, max 500 chars
- Guild name: Unique, 3-50 chars
- Stream URL: Validated as iframe-safe

### Donor System

- Configurable in `is_donor` profile field
- 1.25x XP multiplier
- 1.5x Credit multiplier
- Visible badge in UI

---

## 6. ENVIRONMENT VARIABLES

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=http://localhost:3000/api
```

---

## 7. PERFORMANCE OPTIMIZATIONS

- Lazy load components
- Virtual scrolling for long chat histories
- Debounced status updates
- Cached guild list
- Optimized database queries with indexes
- Iframe sandboxing for profile effects

---

## 8. DEPLOYMENT CHECKLIST

- [ ] Run SQL migrations
- [ ] Enable Realtime on messages table
- [ ] Configure RLS policies
- [ ] Set up Supabase auth
- [ ] Create storage bucket for profile effects
- [ ] Test chat realtime sync
- [ ] Verify cooldown system
- [ ] Stress test guild creation
- [ ] Monitor XP reward distribution

---

## 9. FUTURE ENHANCEMENTS

- Guild wars/tournaments
- Trading system
- Achievements with rarity tiers
- Guild treasury management
- Seasonal events
- Voice chat integration
- Advanced profile customization
- Marketplace for cosmetics
