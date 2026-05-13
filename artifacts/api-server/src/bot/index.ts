import { Telegraf, Markup } from "telegraf";
import cron from "node-cron";
import { logger } from "../lib/logger";
import {
  getOrCreateUser,
  getUser,
  getUserHabits,
  addHabit,
  deleteHabit,
  markHabitDone,
  getTodayCompletions,
  getStreakForHabit,
  setUserTimezone,
  setEkstrajenStartDate,
} from "./db";
import { getEkstrajenStatus } from "./ekstrajen";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

export const bot = new Telegraf(token);

const userState: Record<string, { step: string; data?: Record<string, string> }> = {};

function todayStr(timezone = "UTC"): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function clearState(telegramId: string): void {
  delete userState[telegramId];
}

function mainMenu() {
  return Markup.keyboard([
    ["📋 My Habits", "➕ Add Habit"],
    ["✅ Check Today", "📊 Streaks"],
    ["🌸 Ekstrajen Cycle", "⚙️ Settings"],
  ]).resize();
}

bot.start(async (ctx) => {
  const id = String(ctx.from.id);
  await getOrCreateUser(id, ctx.from.username);
  await ctx.reply(
    `👋 Hi ${ctx.from.first_name}! I'm your *Habit Tracker Bot*.\n\nI'll send you daily reminders and help you build streaks. Use the menu below to get started!`,
    { parse_mode: "Markdown", ...mainMenu() },
  );
});

bot.help((ctx) =>
  ctx.reply(
    "Here's what I can do:\n\n" +
      "📋 *My Habits* — view your habit list\n" +
      "➕ *Add Habit* — add a new habit with a reminder time\n" +
      "✅ *Check Today* — mark habits done for today\n" +
      "📊 *Streaks* — see your current streaks\n" +
      "🌸 *Ekstrajen Cycle* — view your cycle phase\n" +
      "⚙️ *Settings* — set timezone or cycle start date",
    { parse_mode: "Markdown" },
  ),
);

bot.hears("📋 My Habits", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const habits = await getUserHabits(id);
  if (habits.length === 0) {
    await ctx.reply("You have no habits yet. Tap ➕ Add Habit to get started!");
    return;
  }
  const lines = habits.map((h, i) => `${i + 1}. *${h.name}* — ⏰ ${h.reminderTime}`).join("\n");
  await ctx.reply(`Your habits:\n\n${lines}`, { parse_mode: "Markdown" });
});

bot.hears("➕ Add Habit", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  userState[id] = { step: "add_habit_name" };
  await ctx.reply("What's the habit you want to track? (e.g. *Drink water*, *Exercise*, *Read*)", {
    parse_mode: "Markdown",
    ...Markup.forceReply(),
  });
});

bot.hears("✅ Check Today", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const user = await getUser(id);
  const habits = await getUserHabits(id);
  if (habits.length === 0) {
    await ctx.reply("No habits to check off yet! Add some first with ➕ Add Habit.");
    return;
  }
  const today = todayStr(user?.timezone);
  const done = await getTodayCompletions(id, today);
  const doneIds = new Set(done.map((d) => d.habitId));

  const buttons = habits.map((h) => [
    Markup.button.callback(doneIds.has(h.id) ? `✅ ${h.name}` : `⬜ ${h.name}`, `toggle_${h.id}`),
  ]);

  await ctx.reply(`*Today's habits* (${today})\n\nTap to check off:`, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
});

bot.action(/^toggle_(\d+)$/, async (ctx): Promise<void> => {
  const habitId = parseInt(ctx.match[1]!);
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  const today = todayStr(user?.timezone);

  const marked = await markHabitDone(habitId, id, today);

  const habits = await getUserHabits(id);
  const done = await getTodayCompletions(id, today);
  const doneIds = new Set(done.map((d) => d.habitId));

  const buttons = habits.map((h) => [
    Markup.button.callback(doneIds.has(h.id) ? `✅ ${h.name}` : `⬜ ${h.name}`, `toggle_${h.id}`),
  ]);

  await ctx.answerCbQuery(marked ? "✅ Marked as done!" : "Already done today!");
  await ctx.editMessageReplyMarkup(Markup.inlineKeyboard(buttons).reply_markup);
});

bot.hears("📊 Streaks", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const habits = await getUserHabits(id);
  if (habits.length === 0) {
    await ctx.reply("No habits tracked yet!");
    return;
  }

  const lines = await Promise.all(
    habits.map(async (h) => {
      const streak = await getStreakForHabit(h.id, id);
      const fire = streak >= 7 ? " 🔥" : streak >= 3 ? " ⚡" : "";
      return `*${h.name}*: ${streak} day${streak === 1 ? "" : "s"}${fire}`;
    }),
  );

  await ctx.reply(`📊 *Your Streaks*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.hears("🌸 Ekstrajen Cycle", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const user = await getUser(id);
  if (!user?.ekstrajenStartDate) {
    await ctx.reply(
      "I don't have your cycle start date yet.\n\nTap ⚙️ Settings → Set Cycle Start Date to configure it.",
    );
    return;
  }
  const status = getEkstrajenStatus(user.ekstrajenStartDate);
  await ctx.reply(status, { parse_mode: "Markdown" });
});

bot.hears("⚙️ Settings", async (ctx): Promise<void> => {
  await ctx.reply(
    "⚙️ Settings",
    Markup.inlineKeyboard([
      [Markup.button.callback("🕐 Set Timezone", "settings_timezone")],
      [Markup.button.callback("🌸 Set Cycle Start Date", "settings_ekstrajen")],
      [Markup.button.callback("🗑️ Delete a Habit", "settings_delete")],
    ]),
  );
});

bot.action("settings_timezone", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "set_timezone" };
  await ctx.answerCbQuery();
  await ctx.reply(
    "Enter your timezone (e.g. *Europe/Istanbul*, *America/New_York*, *Asia/Tokyo*).\n\nSee full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
    { parse_mode: "Markdown" },
  );
});

bot.action("settings_ekstrajen", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "set_ekstrajen_date" };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the *start date of your last period* in YYYY-MM-DD format (e.g. 2025-05-01):", {
    parse_mode: "Markdown",
  });
});

bot.action("settings_delete", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habits = await getUserHabits(id);
  await ctx.answerCbQuery();
  if (habits.length === 0) {
    await ctx.reply("You have no active habits to delete.");
    return;
  }
  const buttons = habits.map((h) => [Markup.button.callback(`🗑️ ${h.name}`, `delete_${h.id}`)]);
  await ctx.reply("Which habit would you like to delete?", Markup.inlineKeyboard(buttons));
});

bot.action(/^delete_(\d+)$/, async (ctx): Promise<void> => {
  const habitId = parseInt(ctx.match[1]!);
  const id = String(ctx.from!.id);
  await deleteHabit(habitId, id);
  await ctx.answerCbQuery("Habit deleted.");
  await ctx.editMessageText("✅ Habit deleted successfully.");
});

bot.on("text", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const state = userState[id];
  if (!state) return;

  const text = ctx.message.text.trim();

  if (state.step === "add_habit_name") {
    userState[id] = { step: "add_habit_time", data: { name: text } };
    await ctx.reply(
      `Great! What time should I remind you to *${text}*?\n\nEnter in HH:MM format (24h), e.g. *08:00*, *20:30*`,
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (state.step === "add_habit_time") {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) {
      await ctx.reply("Please enter a valid time in HH:MM format (e.g. 08:00, 20:30).");
      return;
    }
    const name = state.data?.name ?? "Habit";
    await addHabit(id, name, text);
    clearState(id);
    await ctx.reply(`✅ Habit *${name}* added with a daily reminder at *${text}*!`, {
      parse_mode: "Markdown",
      ...mainMenu(),
    });
    return;
  }

  if (state.step === "set_timezone") {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: text });
      await setUserTimezone(id, text);
      clearState(id);
      await ctx.reply(`✅ Timezone set to *${text}*`, { parse_mode: "Markdown", ...mainMenu() });
    } catch {
      await ctx.reply("Invalid timezone. Please try again (e.g. Europe/Istanbul, UTC, America/New_York).");
    }
    return;
  }

  if (state.step === "set_ekstrajen_date") {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(text) || isNaN(Date.parse(text))) {
      await ctx.reply("Please enter a valid date in YYYY-MM-DD format (e.g. 2025-05-01).");
      return;
    }
    await setEkstrajenStartDate(id, text);
    clearState(id);
    const status = getEkstrajenStatus(text);
    await ctx.reply(`✅ Cycle start date saved!\n\n${status}`, { parse_mode: "Markdown", ...mainMenu() });
  }
});

export function setupReminders(botInstance: Telegraf): void {
  cron.schedule("* * * * *", async () => {
    const now = new Date();

    try {
      const { db, habitsTable, usersTable, completionsTable } = await import("@workspace/db");
      const { eq, and } = await import("drizzle-orm");

      const habits = await db
        .select({
          habitId: habitsTable.id,
          habitName: habitsTable.name,
          reminderTime: habitsTable.reminderTime,
          telegramId: habitsTable.telegramId,
          timezone: usersTable.timezone,
        })
        .from(habitsTable)
        .leftJoin(usersTable, eq(habitsTable.telegramId, usersTable.telegramId))
        .where(eq(habitsTable.isActive, true));

      for (const habit of habits) {
        const tz = habit.timezone ?? "UTC";
        const localTime = now.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: tz,
        });

        if (localTime === habit.reminderTime) {
          const today = now.toLocaleDateString("en-CA", { timeZone: tz });
          const existing = await db
            .select()
            .from(completionsTable)
            .where(
              and(
                eq(completionsTable.habitId, habit.habitId),
                eq(completionsTable.telegramId, habit.telegramId),
                eq(completionsTable.completedDate, today),
              ),
            )
            .limit(1);

          if (existing.length === 0) {
            await botInstance.telegram.sendMessage(
              habit.telegramId,
              `⏰ *Reminder!*\n\nTime to: *${habit.habitName}*\n\nTap below to mark it done!`,
              {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                  [Markup.button.callback(`✅ Done — ${habit.habitName}`, `toggle_${habit.habitId}`)],
                ]),
              },
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Reminder cron error");
    }
  });

  logger.info("Reminder scheduler started");
}
