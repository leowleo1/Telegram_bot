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
  getStreakStats,
  setUserTimezone,
  setCycleStartDate,
  resetCycleToToday,
  checkSupplementToday,
  markSupplementTaken,
  getSupplementStreak,
  logWater,
  getTodayWater,
  undoLastWater,
} from "./db";
import { formatCycleMessage } from "./ekstrajen";
import { waterStatusText, getRewardMessage, WATER_GOAL_ML } from "./water";
import { buildMonthlyStats } from "./stats";

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
    ["✅ Check Today", "💧 Water"],
    ["💊 Daily Supplement", "📊 Monthly Stats"],
    ["⚙️ Settings"],
  ]).resize();
}

function waterButtons(totalMl: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("+100ml", "water_100"),
      Markup.button.callback("+200ml", "water_200"),
      Markup.button.callback("+300ml", "water_300"),
    ],
    [
      Markup.button.callback("+400ml", "water_400"),
      Markup.button.callback("+500ml", "water_500"),
      Markup.button.callback("✏️ Custom", "water_custom"),
    ],
    ...(totalMl > 0
      ? [[Markup.button.callback("↩️ Undo last", "water_undo"), Markup.button.callback("🔄 Refresh", "water_refresh")]]
      : []),
  ]);
}

bot.start(async (ctx) => {
  const id = String(ctx.from.id);
  await getOrCreateUser(id, ctx.from.username);
  await ctx.reply(
    `👋 Hi ${ctx.from.first_name}! I'm your *Habit Tracker Bot*.\n\nI'll send you daily reminders, track your water intake, and keep you on top of your supplement cycle. Use the menu below!`,
    { parse_mode: "Markdown", ...mainMenu() },
  );
});

bot.help((ctx) =>
  ctx.reply(
    "Here's what I can do:\n\n" +
      "📋 *My Habits* — view your habit list\n" +
      "➕ *Add Habit* — add a habit with a reminder time\n" +
      "✅ *Check Today* — mark habits done\n" +
      "💧 *Water* — track your daily water intake\n" +
      "💊 *Daily Supplement* — 20-day ON / 10-day break cycle tracker\n" +
      "📊 *Monthly Stats* — full month overview with streaks & progress\n" +
      "⚙️ *Settings* — timezone, cycle date, delete habits",
    { parse_mode: "Markdown" },
  ),
);

// ─── HABITS ─────────────────────────────────────────────────────────────────

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
  const completedCount = doneIds.size;
  const total = habits.length;
  const bar = buildMiniBar(completedCount, total);
  await ctx.reply(`*Today's habits* — ${today}\n${bar} ${completedCount}/${total} done\n\nTap to check off:`, {
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
  const completedCount = doneIds.size;
  const total = habits.length;
  const bar = buildMiniBar(completedCount, total);
  await ctx.editMessageText(
    `*Today's habits* — ${today}\n${bar} ${completedCount}/${total} done\n\nTap to check off:`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
  );
});

// ─── STREAKS ─────────────────────────────────────────────────────────────────

bot.hears("📊 Streaks", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const habits = await getUserHabits(id);
  if (habits.length === 0) {
    await ctx.reply("No habits tracked yet!");
    return;
  }
  const lines = await Promise.all(
    habits.map(async (h) => {
      const { current, longest } = await getStreakStats(h.id, id);
      const fire = current >= 7 ? " 🔥" : current >= 3 ? " ⚡" : "";
      return `*${h.name}*\n  Current: ${current} day${current === 1 ? "" : "s"}${fire}\n  Longest ever: ${longest} day${longest === 1 ? "" : "s"}`;
    }),
  );
  await ctx.reply(`📊 *Streaks*\n\n${lines.join("\n\n")}`, { parse_mode: "Markdown" });
});

// ─── WATER ───────────────────────────────────────────────────────────────────

async function sendWaterStatus(ctx: any, telegramId: string, timezone: string): Promise<void> {
  const today = todayStr(timezone);
  const totalMl = await getTodayWater(telegramId, today);
  const text = waterStatusText(totalMl, today);
  await ctx.reply(text, { parse_mode: "Markdown", ...waterButtons(totalMl) });
}

bot.hears("💧 Water", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const user = await getUser(id);
  await sendWaterStatus(ctx, id, user?.timezone ?? "UTC");
});

async function handleWaterAdd(ctx: any, amountMl: number): Promise<void> {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  const today = todayStr(user?.timezone ?? "UTC");
  const prevTotal = await getTodayWater(id, today);
  await logWater(id, amountMl, today);
  const newTotal = prevTotal + amountMl;

  const reward = getRewardMessage(prevTotal, newTotal);
  const text = waterStatusText(newTotal, today);

  await ctx.answerCbQuery(`+${amountMl}ml added!`);
  await ctx.editMessageText(text + (reward ? `\n\n${reward}` : ""), {
    parse_mode: "Markdown",
    ...waterButtons(newTotal),
  });
}

bot.action("water_100", (ctx) => handleWaterAdd(ctx, 100));
bot.action("water_200", (ctx) => handleWaterAdd(ctx, 200));
bot.action("water_300", (ctx) => handleWaterAdd(ctx, 300));
bot.action("water_400", (ctx) => handleWaterAdd(ctx, 400));
bot.action("water_500", (ctx) => handleWaterAdd(ctx, 500));

bot.action("water_refresh", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  const today = todayStr(user?.timezone ?? "UTC");
  const totalMl = await getTodayWater(id, today);
  const text = waterStatusText(totalMl, today);
  await ctx.answerCbQuery("Refreshed!");
  await ctx.editMessageText(text, { parse_mode: "Markdown", ...waterButtons(totalMl) });
});

bot.action("water_undo", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  const today = todayStr(user?.timezone ?? "UTC");
  const removed = await undoLastWater(id, today);
  if (removed === null) {
    await ctx.answerCbQuery("Nothing to undo!");
    return;
  }
  const newTotal = await getTodayWater(id, today);
  await ctx.answerCbQuery(`↩️ Removed ${removed}ml`);
  const text = waterStatusText(newTotal, today);
  await ctx.editMessageText(text, { parse_mode: "Markdown", ...waterButtons(newTotal) });
});

bot.action("water_custom", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "water_custom_amount" };
  await ctx.answerCbQuery();
  await ctx.reply("How much water? Enter the amount in ml (e.g. 350):");
});

// ─── SUPPLEMENT ───────────────────────────────────────────────────────────────

async function sendSupplementStatus(ctx: any, telegramId: string): Promise<void> {
  const user = await getUser(telegramId);
  if (!user?.ekstrajenStartDate) {
    await ctx.reply(
      "I don't have your cycle start date yet.\n\nTap ⚙️ Settings → Set Cycle Start Date to set when you started your course.",
    );
    return;
  }
  const today = todayStr(user.timezone);
  const takenToday = await checkSupplementToday(telegramId, today);
  const { current, longest } = await getSupplementStreak(telegramId);
  const msg = formatCycleMessage(user.ekstrajenStartDate);
  const streakLine =
    current > 0
      ? `\n\n💊 Streak: ${current} day${current === 1 ? "" : "s"}${current >= 7 ? " 🔥" : current >= 3 ? " ⚡" : ""} | Longest: ${longest}`
      : "";
  const statusLine = takenToday ? "\n\n✅ *Taken today!*" : "\n\n⬜ *Not taken yet today*";
  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
  if (!takenToday) buttons.push([Markup.button.callback("💊 Mark as taken today", "supplement_taken")]);
  buttons.push([Markup.button.callback("🔄 Reset Cycle", "confirm_reset_cycle")]);
  await ctx.reply(msg + statusLine + streakLine, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard(buttons),
  });
}

bot.hears("💊 Daily Supplement", async (ctx): Promise<void> => {
  await sendSupplementStatus(ctx, String(ctx.from.id));
});

bot.action("supplement_taken", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  const today = todayStr(user?.timezone);
  const marked = await markSupplementTaken(id, today);
  await ctx.answerCbQuery(marked ? "✅ Logged! Well done!" : "Already marked for today.");
  if (!user?.ekstrajenStartDate) return;
  const { current, longest } = await getSupplementStreak(id);
  const msg = formatCycleMessage(user.ekstrajenStartDate);
  const streakLine =
    current > 0
      ? `\n\n💊 Streak: ${current} day${current === 1 ? "" : "s"}${current >= 7 ? " 🔥" : current >= 3 ? " ⚡" : ""} | Longest: ${longest}`
      : "";
  await ctx.editMessageText(msg + "\n\n✅ *Taken today!*" + streakLine, {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Reset Cycle", "confirm_reset_cycle")]]),
  });
});

bot.action("confirm_reset_cycle", async (ctx): Promise<void> => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Are you sure you want to reset the cycle to today? This starts a new 90-day course.",
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Yes, reset now", "do_reset_cycle")],
      [Markup.button.callback("❌ Cancel", "cancel_reset")],
    ]),
  );
});

bot.action("do_reset_cycle", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  const today = await resetCycleToToday(id, user?.timezone ?? "UTC");
  await ctx.answerCbQuery("Cycle reset!");
  await ctx.editMessageText(
    `✅ Cycle reset! New course started on *${today}*.\n\nTap 💊 Daily Supplement to see your status.`,
    { parse_mode: "Markdown" },
  );
});

bot.action("cancel_reset", async (ctx): Promise<void> => {
  await ctx.answerCbQuery("Cancelled.");
  await ctx.deleteMessage();
});

// ─── MONTHLY STATS ────────────────────────────────────────────────────────────

bot.hears("📊 Monthly Stats", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const user = await getUser(id);
  await ctx.reply("Building your monthly report...");
  const stats = await buildMonthlyStats(id, user?.timezone ?? "UTC");
  await ctx.reply(stats, { parse_mode: "Markdown" });
});

// ─── SETTINGS ────────────────────────────────────────────────────────────────

bot.hears("⚙️ Settings", async (ctx): Promise<void> => {
  await ctx.reply(
    "⚙️ Settings",
    Markup.inlineKeyboard([
      [Markup.button.callback("🕐 Set Timezone", "settings_timezone")],
      [Markup.button.callback("💊 Set Cycle Start Date", "settings_cycle_date")],
      [Markup.button.callback("🗑️ Delete a Habit", "settings_delete")],
    ]),
  );
});

bot.action("settings_timezone", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "set_timezone" };
  await ctx.answerCbQuery();
  await ctx.reply(
    "Enter your timezone (e.g. Europe/Istanbul, America/New_York, Asia/Tokyo).\n\nFull list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones",
  );
});

bot.action("settings_cycle_date", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "set_cycle_date" };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the *date you started your supplement course* in YYYY-MM-DD format (e.g. 2025-05-01):", {
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

// ─── TEXT INPUT ───────────────────────────────────────────────────────────────

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

  if (state.step === "set_cycle_date") {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(text) || isNaN(Date.parse(text))) {
      await ctx.reply("Please enter a valid date in YYYY-MM-DD format (e.g. 2025-05-01).");
      return;
    }
    await setCycleStartDate(id, text);
    clearState(id);
    const msg = formatCycleMessage(text);
    await ctx.reply(`✅ Cycle start date saved!\n\n${msg}`, { parse_mode: "Markdown", ...mainMenu() });
    return;
  }

  if (state.step === "water_custom_amount") {
    const ml = parseInt(text.replace(/[^\d]/g, ""));
    if (isNaN(ml) || ml <= 0 || ml > 5000) {
      await ctx.reply("Please enter a valid amount between 1 and 5000 ml (e.g. 350).");
      return;
    }
    const user = await getUser(id);
    const today = todayStr(user?.timezone ?? "UTC");
    const prevTotal = await getTodayWater(id, today);
    await logWater(id, ml, today);
    const newTotal = prevTotal + ml;
    const reward = getRewardMessage(prevTotal, newTotal);
    const statusText = waterStatusText(newTotal, today);
    clearState(id);
    await ctx.reply(statusText + (reward ? `\n\n${reward}` : ""), {
      parse_mode: "Markdown",
      ...waterButtons(newTotal),
    });
  }
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────

bot.catch((err: unknown) => {
  logger.error({ err }, "Telegram bot error (handled)");
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildMiniBar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((done / total) * 8) : 0;
  return "▓".repeat(filled) + "░".repeat(8 - filled);
}

// ─── REMINDERS ───────────────────────────────────────────────────────────────

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
