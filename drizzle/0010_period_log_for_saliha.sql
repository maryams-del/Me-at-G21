-- Switch the Period log back on for saliha.ummehisham's account (it starts hidden for invited people). Nothing else changes.
UPDATE "users"
SET "settings" = "settings" || jsonb_build_object(
      'spaceOverrides',
      COALESCE("settings"->'spaceOverrides', '{}'::jsonb)
        || jsonb_build_object('/care/period', COALESCE("settings"->'spaceOverrides'->'/care/period', '{}'::jsonb) || '{"hidden": false}'::jsonb)
    ),
    "updated_at" = now()
WHERE lower("email") LIKE 'saliha.ummehisham@%';
