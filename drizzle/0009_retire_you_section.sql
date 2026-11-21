-- The "You" section is gone from Spaces: custom spaces that sat under it move to "Life admin".
UPDATE "custom_spaces" SET "section" = 'Life admin', "updated_at" = now() WHERE "section" = 'You';
