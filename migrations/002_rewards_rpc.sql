CREATE OR REPLACE FUNCTION distribute_rewards(action text, amount integer, guild_id text DEFAULT NULL, user_ids text[] DEFAULT NULL)
RETURNS TABLE(user_id text, old_credits integer, new_credits integer) AS $$
BEGIN
  IF action = 'daily' THEN
    WITH updated AS (
      UPDATE users
      SET credits = COALESCE(credits, 0) + amount,
          xp = COALESCE(xp, 0) + (amount / 2)::integer
      WHERE true
      RETURNING id AS user_id, (COALESCE(credits,0) - amount) AS old_credits, credits AS new_credits
    )
    INSERT INTO reward_logs (user_id, amount, action, created_at)
    SELECT user_id, amount, action, now() FROM updated;

    RETURN QUERY SELECT user_id, old_credits, new_credits FROM updated;

  ELSIF action = 'guild' THEN
    IF guild_id IS NULL THEN
      RAISE EXCEPTION 'guild_id is required for guild action';
    END IF;

    WITH members AS (
      SELECT user_id FROM guild_members WHERE guild_id = guild_id
    ), updated AS (
      UPDATE users u
      SET credits = COALESCE(u.credits, 0) + amount,
          xp = COALESCE(u.xp, 0) + (amount / 2)::integer
      FROM members m
      WHERE u.id = m.user_id
      RETURNING u.id AS user_id, (COALESCE(u.credits,0) - amount) AS old_credits, u.credits AS new_credits
    )
    INSERT INTO reward_logs (user_id, amount, action, created_at)
    SELECT user_id, amount, action, now() FROM updated;

    RETURN QUERY SELECT user_id, old_credits, new_credits FROM updated;

  ELSIF action = 'event' THEN
    IF user_ids IS NULL OR array_length(user_ids, 1) = 0 THEN
      RAISE EXCEPTION 'user_ids is required for event action';
    END IF;

    WITH updated AS (
      UPDATE users u
      SET credits = COALESCE(u.credits,0) + amount,
          xp = COALESCE(u.xp,0) + (amount / 2)::integer
      WHERE u.id = ANY(user_ids)
      RETURNING u.id AS user_id, (COALESCE(u.credits,0) - amount) AS old_credits, u.credits AS new_credits
    )
    INSERT INTO reward_logs (user_id, amount, action, created_at)
    SELECT user_id, amount, action, now() FROM updated;

    RETURN QUERY SELECT user_id, old_credits, new_credits FROM updated;

  ELSE
    RAISE EXCEPTION 'Unknown action: %', action;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
