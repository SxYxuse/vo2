-- The app was renamed from VO to VO2. Strava sign-ins get a placeholder address (src/lib/auth.ts);
-- move existing ones to the new domain. Better Auth finds these users by account, not email.
UPDATE "user" SET "email" = replace("email", '@users.vo.local', '@users.vo2.local')
WHERE "email" LIKE 'strava-%@users.vo.local';
