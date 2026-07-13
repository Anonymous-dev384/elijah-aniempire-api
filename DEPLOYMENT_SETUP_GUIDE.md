/**
 * Deployment & Setup Guide
 */

# 🚀 AniEmpire Gamified Ecosystem - Setup Guide

## Prerequisites

- Node.js 18+
- Supabase account (https://supabase.com)
- React 19 + Vite project
- Zustand for state management
- Framer Motion for animations

---

## 1. Database Setup (Supabase)

### Step 1: Create Tables

Run migrations in order:

```bash
# 1. Base gamified ecosystem schema
supabase/migrations/002_gamified_ecosystem.sql

# 2. RLS Policies
supabase/migrations/003_rls_policies.sql
```

In Supabase Dashboard:
1. Go to SQL Editor
2. Create new query
3. Copy & paste each migration file
4. Execute

### Step 2: Enable Realtime

```sql
-- Enable Realtime on messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE guild_watch_parties;
```

### Step 3: Verify Functions

Test the activity rewards function:

```sql
SELECT add_user_activity_rewards(
  'user-uuid-here',
  'chat_message_sent'
);
```

---

## 2. Frontend Installation

### Install Dependencies

```bash
npm install zustand framer-motion
```

### Copy Files

```bash
# Copy stores
cp src/store/chatStore.js .
cp src/store/guildStore.js .
cp src/store/watchPartyStore.js .

# Copy components
cp -r src/components/Onboarding .
cp -r src/components/Profile .
cp -r src/components/Chat .
cp -r src/components/Guilds .
cp -r src/components/Community .
```

### Environment Variables

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=http://localhost:3000/api

# Feature Flags
VITE_ENABLE_GUILDS=true
VITE_ENABLE_CHAT=true
VITE_ENABLE_WATCH_PARTY=true
VITE_ENABLE_PROFILING=true

# Chat Configuration
VITE_CHAT_COOLDOWN_SECONDS=10
VITE_MAX_MESSAGE_LENGTH=500
VITE_MESSAGE_HISTORY_LIMIT=50

# Guild Configuration
VITE_MIN_LEVEL_CREATE_GUILD=5
VITE_DEFAULT_GUILD_MAX_MEMBERS=30

# Reward Multipliers
VITE_DONOR_XP_MULTIPLIER=1.25
VITE_DONOR_CREDIT_MULTIPLIER=1.5
```

---

## 3. Profile Effects Setup

### Create Effect Templates

Create `public/effects/` directory and add HTML files:

```bash
mkdir -p public/effects
```

Create three template files:
- `cherry-blossoms.html`
- `digital-rain.html`
- `ember-glow.html`

(Templates provided in `public/effects/templates.js`)

---

## 4. Integration into App

### Update App.jsx

```jsx
import OnboardingWizard from './components/Onboarding/OnboardingWizard'
import UserProfile from './components/Profile/UserProfile'
import ChatInterface from './components/Chat/ChatInterface'
import GuildHideout from './components/Guilds/GuildHideout'
import Leaderboard from './components/Community/Leaderboard'
import Achievements from './components/Community/Achievements'

// Add routes
<Route path="/onboarding" element={<OnboardingWizard />} />
<Route path="/profile/:userId" element={<UserProfile />} />
<Route path="/chat" element={<ChatInterface />} />
<Route path="/guilds" element={<GuildHideout />} />
<Route path="/leaderboard" element={<Leaderboard />} />
<Route path="/achievements/:userId" element={<Achievements />} />
```

---

## 5. Testing

### Test Chat System

```bash
# Start dev server
npm run dev

# Open multiple browser tabs
# Type in chat input
# Messages should appear in real-time
```

### Test Guild Creation

1. Create account
2. Reach Level 5 (manually update in DB for testing)
3. Try creating guild
4. Invite another user
5. Test chat sync

### Test Rewards

```sql
-- Manually call reward function
SELECT add_user_activity_rewards('user-id', 'episode_tracked');

-- Check updated stats
SELECT * FROM user_stats WHERE user_id = 'user-id';
```

---

## 6. Performance Optimization

### Caching Strategy

```javascript
// Cache guild list (5 min)
const CACHE_TTL = 5 * 60 * 1000
const cachedGuilds = localStorage.getItem('guilds')
const cachedAt = localStorage.getItem('guilds_cached_at')

if (cachedGuilds && Date.now() - cachedAt < CACHE_TTL) {
  return JSON.parse(cachedGuilds)
}
```

### Message Pagination

```javascript
// Load messages in batches
const PAGE_SIZE = 50
let page = 0

const loadMore = async () => {
  const { data } = await supabase
    .from('messages')
    .select()
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
  page++
  return data
}
```

---

## 7. Security Checklist

- [ ] Enable RLS on all tables
- [ ] Verify auth triggers
- [ ] Test data isolation (users see only their data)
- [ ] Validate message length (server-side)
- [ ] Check cooldown enforcement
- [ ] Test XP cap
- [ ] Verify donor flag authentication
- [ ] Sandbox iframe effects

---

## 8. Monitoring & Maintenance

### Key Metrics to Monitor

- Active users in chat
- Guild creation rate
- XP distribution fairness
- Cooldown violations
- Database query performance

### Regular Tasks

- Weekly: Check leaderboard data accuracy
- Monthly: Review achievement unlock patterns
- Quarterly: Analyze guild health metrics
- As needed: Moderate chat for spam/abuse

---

## 9. Troubleshooting

### Chat not syncing

```javascript
// Check if Realtime is enabled
const channel = supabase.channel('test')
channel.subscribe((status) => {
  console.log('Status:', status) // Should be 'SUBSCRIBED'
})
```

### XP not rewarding

```sql
-- Check activity log
SELECT * FROM transactions WHERE user_id = 'user-id' LIMIT 10;

-- Verify function is working
SELECT add_user_activity_rewards('user-id', 'review_written');
```

### Guild creation locked

```sql
-- Check user level
SELECT level, experience FROM user_stats WHERE user_id = 'user-id';

-- Manually update level for testing
UPDATE user_stats SET experience = 500 WHERE user_id = 'user-id';
```

---

## 10. Future Enhancements

- [ ] Voice chat integration (Twilio/Agora)
- [ ] Guild wars system
- [ ] Trading between users
- [ ] Seasonal events
- [ ] Admin moderation panel
- [ ] Advanced profiling
- [ ] Tournament system
- [ ] Guilds treasury
- [ ] Marketplace

---

## Support

For issues or questions:

1. Check Supabase docs: https://supabase.com/docs
2. Check React docs: https://react.dev
3. Check Zustand docs: https://github.com/pmndrs/zustand
4. Open issue on GitHub

