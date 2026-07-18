-- ============================================================================
-- MIGRATION 001: GAMIFIED SYSTEMS (Community, Profiles, Guilds, Chat, Shop)
-- ============================================================================

-- 1. EXTEND PROFILES TABLE WITH GAMIFICATION FIELDS
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS faction TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS gender_title_pref TEXT DEFAULT 'neutral' CHECK (gender_title_pref IN ('male', 'female', 'neutral')),
ADD COLUMN IF NOT EXISTS custom_url TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS profile_effect_iframe_url TEXT,
ADD COLUMN IF NOT EXISTS avatar_border_css TEXT DEFAULT 'border-2 border-slate-400',
ADD COLUMN IF NOT EXISTS xp INT DEFAULT 0 CHECK (xp >= 0),
ADD COLUMN IF NOT EXISTS credits INT DEFAULT 0 CHECK (credits >= 0),
ADD COLUMN IF NOT EXISTS is_donor BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_chat_message_timestamp TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS guild_id UUID REFERENCES public.guilds(id) ON DELETE SET NULL;

-- Create index for better performance on guild lookups and XP searches
CREATE INDEX IF NOT EXISTS idx_profiles_guild_id ON public.profiles(guild_id);
CREATE INDEX IF NOT EXISTS idx_profiles_xp ON public.profiles(xp DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_custom_url ON public.profiles(custom_url);

-- 2. HIERARCHY TITLES FUNCTION (Gender-aware XP-based ranking)
CREATE OR REPLACE FUNCTION get_user_hierarchy_title(p_xp INT, p_gender_pref TEXT)
RETURNS TEXT AS $$
DECLARE
  v_level INT;
BEGIN
  -- Determine level from XP
  v_level := CASE
    WHEN p_xp < 500 THEN 1
    WHEN p_xp < 1500 THEN 5
    WHEN p_xp < 3000 THEN 15
    WHEN p_xp < 4500 THEN 30
    WHEN p_xp < 6000 THEN 45
    ELSE 60
  END;

  -- Return title based on level and gender preference
  RETURN CASE v_level
    WHEN 1 THEN 'Peasant'
    WHEN 5 THEN 'Knight'
    WHEN 15 THEN 'Noble'
    WHEN 30 THEN 
      CASE p_gender_pref
        WHEN 'male' THEN 'High Priest'
        WHEN 'female' THEN 'High Priestess'
        ELSE 'High Priest'
      END
    WHEN 45 THEN
      CASE p_gender_pref
        WHEN 'male' THEN 'King'
        WHEN 'female' THEN 'Queen'
        ELSE 'Sovereign'
      END
    WHEN 60 THEN
      CASE p_gender_pref
        WHEN 'male' THEN 'Overlord'
        WHEN 'female' THEN 'Deity'
        ELSE 'Overlord'
      END
    ELSE 'Peasant'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create index for the function (computed columns)
CREATE INDEX IF NOT EXISTS idx_user_title ON public.profiles((get_user_hierarchy_title(xp, gender_title_pref)));

-- 3. GUILDS TABLE
CREATE TABLE IF NOT EXISTS public.guilds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  emblem_url TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level INT DEFAULT 1 CHECK (level > 0),
  xp INT DEFAULT 0 CHECK (xp >= 0),
  member_count INT DEFAULT 1 CHECK (member_count > 0),
  max_members INT DEFAULT 30 CHECK (max_members > 0),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  CONSTRAINT guild_name_length CHECK (LENGTH(name) >= 3 AND LENGTH(name) <= 50),
  CONSTRAINT guild_desc_length CHECK (description IS NULL OR LENGTH(description) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_guilds_owner_id ON public.guilds(owner_id);
CREATE INDEX IF NOT EXISTS idx_guilds_member_count ON public.guilds(member_count DESC);
CREATE INDEX IF NOT EXISTS idx_guilds_level ON public.guilds(level DESC);

-- 4. GUILD MEMBERS JUNCTION TABLE (Enforce 1 guild per user)
CREATE TABLE IF NOT EXISTS public.guild_members (
  guild_id UUID NOT NULL REFERENCES public.guilds(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT now(),
  PRIMARY KEY (guild_id, user_id),
  UNIQUE(user_id) -- One guild per user
);

CREATE INDEX IF NOT EXISTS idx_guild_members_user_id ON public.guild_members(user_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild_id ON public.guild_members(guild_id);

-- 5. REAL-TIME CHAT MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guild_id UUID REFERENCES public.guilds(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT message_content_length CHECK (LENGTH(content) > 0 AND LENGTH(content) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_messages_guild_id ON public.messages(guild_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_global_chat ON public.messages((guild_id IS NULL)) WHERE guild_id IS NULL;

-- 6. ACTIVITY REWARDS TRACKING (Spam prevention + Daily caps)
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  xp_gained INT,
  credits_gained INT,
  created_at TIMESTAMP DEFAULT now(),
  CHECK (activity_type IN ('episode_tracked', 'review_written', 'chat_message_sent', 'custom'))
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON public.activity_logs(activity_type);

-- 7. XP/CREDITS REWARDS FUNCTION (With daily caps & donor multiplier)
CREATE OR REPLACE FUNCTION add_user_activity_rewards(
  p_user_id UUID,
  p_activity_type TEXT,
  p_metadata JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_xp_gain INT;
  v_credit_gain INT;
  v_is_donor BOOLEAN;
  v_today_credits INT;
  v_today_start TIMESTAMP;
  v_multiplier FLOAT := 1.0;
  v_result JSONB;
BEGIN
  -- Get user's donor status
  SELECT is_donor INTO v_is_donor FROM public.profiles WHERE id = p_user_id;
  
  -- Apply donor multiplier (2x)
  IF v_is_donor THEN
    v_multiplier := 2.0;
  END IF;

  -- Calculate rewards based on activity type
  CASE p_activity_type
    WHEN 'episode_tracked' THEN
      v_xp_gain := 10;
      v_credit_gain := CEIL(5 * v_multiplier);
    WHEN 'review_written' THEN
      -- Check if review meets criteria (200+ chars or AI approved)
      IF (p_metadata->>'review_length')::INT >= 200 OR (p_metadata->>'ai_approved')::BOOLEAN = TRUE THEN
        v_xp_gain := 100;
        v_credit_gain := CEIL(50 * v_multiplier);
      ELSE
        RETURN jsonb_build_object('success', false, 'reason', 'Review too short or not approved');
      END IF;
    WHEN 'chat_message_sent' THEN
      v_xp_gain := 2;
      v_credit_gain := CEIL(1 * v_multiplier);
    ELSE
      RETURN jsonb_build_object('success', false, 'reason', 'Unknown activity type');
  END CASE;

  -- Check daily credit cap
  v_today_start := DATE_TRUNC('day', NOW());
  SELECT COALESCE(SUM(credits_gained), 0)
  INTO v_today_credits
  FROM public.activity_logs
  WHERE user_id = p_user_id
    AND created_at >= v_today_start
    AND activity_type IN ('episode_tracked', 'chat_message_sent', 'review_written');

  -- Cap daily credits at 100
  IF v_today_credits + v_credit_gain > 100 THEN
    v_credit_gain := GREATEST(0, 100 - v_today_credits);
  END IF;

  -- Update user profile
  UPDATE public.profiles
  SET xp = xp + v_xp_gain,
      credits = credits + v_credit_gain,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- Log activity
  INSERT INTO public.activity_logs (user_id, activity_type, xp_gained, credits_gained)
  VALUES (p_user_id, p_activity_type, v_xp_gain, v_credit_gain);

  v_result := jsonb_build_object(
    'success', true,
    'xp_gained', v_xp_gain,
    'credits_gained', v_credit_gain,
    'total_xp', (SELECT xp FROM public.profiles WHERE id = p_user_id),
    'total_credits', (SELECT credits FROM public.profiles WHERE id = p_user_id),
    'is_donor_multiplied', v_is_donor
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. SHOP ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.shop_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('avatar_border', 'profile_effect', 'title_effect')),
  price INT NOT NULL CHECK (price > 0),
  content_url TEXT,
  iframe_template TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_items_category ON public.shop_items(category);
CREATE INDEX IF NOT EXISTS idx_shop_items_active ON public.shop_items(is_active);

-- 9. USER INVENTORY/PURCHASES
CREATE TABLE IF NOT EXISTS public.user_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_item_id UUID NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  purchased_at TIMESTAMP DEFAULT now(),
  is_equipped BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, shop_item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id ON public.user_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_equipped ON public.user_inventory(user_id) WHERE is_equipped = TRUE;

-- 10. GUILD QUESTS (Weekly challenges)
CREATE TABLE IF NOT EXISTS public.guild_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id UUID NOT NULL REFERENCES public.guilds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  target_count INT NOT NULL DEFAULT 1,
  current_count INT DEFAULT 0,
  reward_xp INT DEFAULT 100,
  week_starting DATE NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guild_quests_guild_id ON public.guild_quests(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_quests_week ON public.guild_quests(week_starting);

-- 11. ACHIEVEMENTS/BADGES
CREATE TABLE IF NOT EXISTS public.achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_url TEXT,
  unlock_requirement JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user_id ON public.user_achievements(user_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- 1. PROFILES - Authenticated users can read their own or any public profile
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_read_own_or_public" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id OR 
    custom_url IS NOT NULL
  );

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2. GUILDS - Authenticated users can read, but only owner can update
ALTER TABLE public.guilds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guilds_read_all" ON public.guilds
  FOR SELECT USING (TRUE);

CREATE POLICY "guilds_update_owner" ON public.guilds
  FOR UPDATE USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "guilds_delete_owner" ON public.guilds
  FOR DELETE USING (auth.uid() = owner_id);

CREATE POLICY "guilds_insert_any" ON public.guilds
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- 3. GUILD MEMBERS - Users can view all, but can only manage their own
ALTER TABLE public.guild_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guild_members_read_all" ON public.guild_members
  FOR SELECT USING (TRUE);

CREATE POLICY "guild_members_insert_self" ON public.guild_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "guild_members_delete_self" ON public.guild_members
  FOR DELETE USING (auth.uid() = user_id);

-- 4. MESSAGES - Authenticated users can read all, insert own
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_read_all" ON public.messages
  FOR SELECT USING (TRUE);

CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "messages_delete_own_or_admin" ON public.messages
  FOR DELETE USING (
    auth.uid() = user_id OR
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()) = TRUE
  );

-- 5. ACTIVITY LOGS - Users can view own
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_logs_read_own" ON public.activity_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "activity_logs_insert_own" ON public.activity_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 6. SHOP ITEMS - Everyone can read active items
ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shop_items_read_active" ON public.shop_items
  FOR SELECT USING (is_active = TRUE);

-- 7. USER INVENTORY - Users can read/manage own
ALTER TABLE public.user_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_inventory_read_own" ON public.user_inventory
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_inventory_manage_own" ON public.user_inventory
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_inventory_update_own" ON public.user_inventory
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 8. GUILD QUESTS - Guild members can read, guild owner can update
ALTER TABLE public.guild_quests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guild_quests_read_member" ON public.guild_quests
  FOR SELECT USING (
    guild_id IN (
      SELECT guild_id FROM public.guild_members WHERE user_id = auth.uid()
    ) OR
    EXISTS (SELECT 1 FROM public.guilds WHERE id = guild_id AND owner_id = auth.uid())
  );

-- 9. ACHIEVEMENTS - Everyone can read
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "achievements_read_all" ON public.achievements
  FOR SELECT USING (TRUE);

-- 10. USER ACHIEVEMENTS - Users can read own
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_achievements_read_own" ON public.user_achievements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_achievements_insert_own" ON public.user_achievements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================================

-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guild_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guilds;

-- ============================================================================
-- SEED DATA: Sample Shop Items & Achievements
-- ============================================================================

INSERT INTO public.shop_items (name, description, category, price, iframe_template, is_active)
VALUES
  (
    'Cherry Blossom Effect',
    'Falling cherry blossoms overlay for your profile',
    'profile_effect',
    500,
    '<style>@keyframes fall{0%{transform:translateY(-10vh) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(360deg);opacity:0}}.blossom{position:absolute;width:10px;height:10px;background:radial-gradient(circle at 30% 30%, rgba(255,192,203,0.8), rgba(255,105,180,0.4));border-radius:50%;animation:fall 3s linear infinite;}}</style><div style="position:absolute;width:100%;height:100%;overflow:hidden;"><div class="blossom" style="left:10%;animation-delay:0s"></div><div class="blossom" style="left:20%;animation-delay:0.5s"></div><div class="blossom" style="left:30%;animation-delay:1s"></div></div>',
    TRUE
  ),
  (
    'Matrix Digital Rain',
    'Green cascading code effect inspired by The Matrix',
    'profile_effect',
    750,
    '<style>@keyframes matrixfall{0%{transform:translateY(-100%);opacity:1}100%{transform:translateY(100%);opacity:0}}.matrix-char{position:absolute;font-family:monospace;color:#00ff00;text-shadow:0 0 5px #00ff00;animation:matrixfall 2s linear infinite;font-size:12px;font-weight:bold;}</style><div style="position:absolute;width:100%;height:100%;overflow:hidden;background:rgba(0,0,0,0.3)"><div class="matrix-char" style="left:10%;animation-delay:0s">◊</div><div class="matrix-char" style="left:20%;animation-delay:0.3s">▲</div><div class="matrix-char" style="left:30%;animation-delay:0.6s">■</div></div>',
    TRUE
  ),
  (
    'Glowing Embers',
    'Fiery ember particles that dance around your profile',
    'profile_effect',
    600,
    '<style>@keyframes ember-float{0%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-50px) scale(0.5);opacity:0}}.ember{position:absolute;width:8px;height:8px;background:radial-gradient(circle at 40% 40%, #ffff00, #ff8800, #ff0000);border-radius:50%;animation:ember-float 2s ease-out infinite;box-shadow:0 0 8px #ff6600;}}</style><div style="position:absolute;width:100%;height:100%"><div class="ember" style="left:25%;bottom:10%"></div><div class="ember" style="left:50%;bottom:5%;animation-delay:0.5s"></div></div>',
    TRUE
  ),
  (
    'Gold Border',
    'Premium gold border for your avatar',
    'avatar_border',
    300,
    NULL,
    TRUE
  ),
  (
    'Neon Cyan Border',
    'Futuristic neon cyan glow border',
    'avatar_border',
    350,
    NULL,
    TRUE
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.achievements (name, description, icon_url, unlock_requirement)
VALUES
  ('First Episode Tracked', 'Track your first anime episode', 'https://via.placeholder.com/48?text=🎬', jsonb_build_object('activity', 'episode_tracked', 'count', 1)),
  ('Review Master', 'Write 10 reviews', 'https://via.placeholder.com/48?text=✍️', jsonb_build_object('activity', 'review_written', 'count', 10)),
  ('Social Butterfly', 'Send 100 chat messages', 'https://via.placeholder.com/48?text=💬', jsonb_build_object('activity', 'chat_message_sent', 'count', 100)),
  ('Guild Founder', 'Create your first guild', 'https://via.placeholder.com/48?text=🏰', jsonb_build_object('event', 'guild_created')),
  ('Level 30 Achieved', 'Reach High Priest/Priestess rank', 'https://via.placeholder.com/48?text=👑', jsonb_build_object('xp_threshold', 3000))
ON CONFLICT (name) DO NOTHING;
