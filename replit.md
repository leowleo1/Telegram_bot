# Leo's Reminders & Tracker Bot

A Telegram habit tracker bot that sends daily reminders, tracks streaks, and shows Ekstrajen cycle status.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Telegram bot (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required secret: `TELEGRAM_BOT_TOKEN` — from BotFather

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Telegram: Telegraf v4 (long polling)
- Scheduler: node-cron (checks every minute for due reminders)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/bot/index.ts` — main bot logic, all command/action handlers
- `artifacts/api-server/src/bot/db.ts` — database access helpers for the bot
- `artifacts/api-server/src/bot/ekstrajen.ts` — Ekstrajen cycle phase calculation
- `lib/db/src/schema/users.ts` — users table (telegramId, timezone, ekstrajenStartDate)
- `lib/db/src/schema/habits.ts` — habits table (name, reminderTime, isActive)
- `lib/db/src/schema/completions.ts` — daily completions table

## Architecture decisions

- Long polling (not webhooks) so it works out of the box in the Replit dev environment.
- Reminder scheduler runs every minute via node-cron and checks if local time matches any habit's reminderTime; skips if already completed today.
- User timezone stored per-user in DB; all date math uses that timezone.
- Ekstrajen cycle is a 28-day cycle split into 4 phases (Menstrual, Follicular, Ovulation, Luteal).
- In-memory userState map tracks multi-step conversation flows (adding habit, setting timezone, etc).

## Product

- Add habits with custom daily reminder times
- Inline button check-off when reminders fire (or on demand via "Check Today")
- Streak tracking with 🔥 fire for 7+ day streaks
- Ekstrajen (menstrual) cycle phase display with day count and advice
- Timezone support per user
- Habit deletion via Settings

## User preferences

- Bot name: Leo's reminders & tracker (@Leoremindersandtracker_bot)

## Gotchas

- After schema changes, always run `pnpm --filter @workspace/db run push` then restart the workflow.
- The bot uses long polling — only one process should run at a time (no multiple dev instances).
- Reminder cron fires every minute; only sends if habit not already completed today.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
