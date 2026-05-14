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
  setMorningReminderTime,
  getAllUsersWithMorningReminder,
  getHabitById,
  updateHabit,
  setEveningNudgeTime,
  getAllUsersWithEveningNudge,
  getAllUsers,
  pauseHabit,
  resumeHabit,
} from "./db";
import { formatCycleMessage, getCycleInfo } from "./ekstrajen";
import { waterStatusText, getRewardMessage, WATER_GOAL_ML } from "./water";
import { buildMonthlyStats } from "./stats";
import { buildWeeklyWrapup, isSundayEvening } from "./weekly";
import { getMilestoneMessage, pickNudgeMessage, pickMissMessage, HAPPY_EMOJIS, SAD_EMOJIS } from "./messages";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

export const bot = new Telegraf(token);

const userState: Record<string, { step: string; data?: Record<string, string> }> = {};

const CAT_LABELS: Record<string, string> = {
  vitamins: "💊 Vitamins",
  supplements: "🧴 Supplements",
  activity: "🏃 Activity",
  wellness: "🧘 Wellness",
  morning: "☀️ Morning",
  evening: "🌙 Evening",
  other: "✨ Other",
};

const DESC_PRESETS: { key: string; label: string; value: string }[] = [
  { key: "with_meal", label: "🍽️ With meal", value: "With meal" },
  { key: "bef_meal", label: "⏰ Before meal (20 min)", value: "20 min before meal" },
  { key: "aft_meal", label: "🥄 After meal", value: "After meal" },
  { key: "morning", label: "🌅 In the morning", value: "In the morning" },
  { key: "bedtime", label: "🌙 At bedtime", value: "At bedtime" },
  { key: "empty", label: "💧 Empty stomach", value: "On empty stomach" },
];

function catEmoji(cat: string | null | undefined): string {
  if (!cat) return "";
  const entry = CAT_LABELS[cat];
  return entry ? entry.split(" ")[0]! + " " : "";
}

function catKeyboard(prefix: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("💊 Vitamins", `${prefix}vitamins`),
      Markup.button.callback("🧴 Supplements", `${prefix}supplements`),
    ],
    [
      Markup.button.callback("🏃 Activity", `${prefix}activity`),
      Markup.button.callback("🧘 Wellness", `${prefix}wellness`),
    ],
    [
      Markup.button.callback("☀️ Morning", `${prefix}morning`),
      Markup.button.callback("🌙 Evening", `${prefix}evening`),
    ],
    [Markup.button.callback("✨ Other", `${prefix}other`)],
  ]);
}

function descKeyboard(prefix: string, skipLabel = "⏭️ Skip") {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🍽️ With meal", `${prefix}with_meal`),
      Markup.button.callback("⏰ Before meal (20 min)", `${prefix}bef_meal`),
    ],
    [
      Markup.button.callback("🥄 After meal", `${prefix}aft_meal`),
      Markup.button.callback("🌅 In the morning", `${prefix}morning`),
    ],
    [
      Markup.button.callback("🌙 At bedtime", `${prefix}bedtime`),
      Markup.button.callback("💧 Empty stomach", `${prefix}empty`),
    ],
    [
      Markup.button.callback("✏️ Custom note", `${prefix}custom`),
      Markup.button.callback(skipLabel, `${prefix}skip`),
    ],
  ]);
}

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
  const today = todayStr();
  const lines = habits
    .map((h, i) => {
      const cat = h.category ? `${catEmoji(h.category)}` : "";
      const catLabel = h.category ? ` _(${CAT_LABELS[h.category] ?? h.category})_` : "";
      const desc = h.description ? `\n   📝 ${h.description}` : "";
      const paused = h.pausedUntil && h.pausedUntil >= today ? `\n   ⏸️ _Paused until ${h.pausedUntil}_` : "";
      const times = [h.reminderTime, h.reminderTime2, h.reminderTime3].filter(Boolean).join(", ");
      return `${i + 1}. ${cat}*${h.name}* — ⏰ ${times}${catLabel}${desc}${paused}`;
    })
    .join("\n\n");
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

  if (marked) {
    const { current } = await getStreakStats(habitId, id);
    const milestone = getMilestoneMessage(current);
    if (milestone) {
      const habit = habits.find((h) => h.id === habitId);
      await ctx.reply(`🎉 *${habit?.name ?? "Habit"} streak milestone!*\n\n${milestone}`, { parse_mode: "Markdown" });
      await sendSticker(bot, id, HAPPY_EMOJIS);
    }
  }
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
  const stats = await buildMonthlyStats(id, user?.timezone ?? "UTC", user?.ekstrajenStartDate ?? null);
  await ctx.reply(stats, { parse_mode: "Markdown" });
});

// ─── SETTINGS ────────────────────────────────────────────────────────────────

bot.hears("⚙️ Settings", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const user = await getUser(id);
  const morningLabel = user?.morningReminderTime
    ? `🌅 Morning Briefing — ${user.morningReminderTime} ✅`
    : "🌅 Set Morning Briefing";
  const nudgeLabel = user?.eveningNudgeTime
    ? `🌙 Evening Nudge — ${user.eveningNudgeTime} ✅`
    : "🌙 Set Evening Nudge";
  await ctx.reply(
    "⚙️ Settings",
    Markup.inlineKeyboard([
      [Markup.button.callback("🕐 Set Timezone", "settings_timezone")],
      [Markup.button.callback("💊 Set Cycle Start Date", "settings_cycle_date")],
      [Markup.button.callback(morningLabel, "settings_morning")],
      [Markup.button.callback(nudgeLabel, "settings_nudge")],
      [Markup.button.callback("⏸️ Pause a Habit", "settings_pause")],
      [Markup.button.callback("✏️ Edit a Habit", "settings_edit")],
      [Markup.button.callback("🗑️ Delete a Habit", "settings_delete")],
    ]),
  );
});

// ─── ADD HABIT: CATEGORY & DESCRIPTION ACTIONS ───────────────────────────────

bot.action(/^hab_cat_(.+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const cat = ctx.match[1]!;
  await ctx.answerCbQuery();
  const state = userState[id];
  if (!state) return;
  userState[id] = { step: "add_habit_desc", data: { ...state.data, category: cat } };
  const catName = CAT_LABELS[cat] ?? cat;
  await ctx.editMessageText(
    `${catName} — got it!\n\nAny notes for this habit? (e.g. timing, how to take it)`,
    descKeyboard("hab_desc_"),
  );
});

bot.action(/^hab_desc_(.+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const key = ctx.match[1]!;
  await ctx.answerCbQuery();
  const state = userState[id];
  if (!state) return;
  if (key === "custom") {
    userState[id] = { step: "add_habit_desc_custom", data: state.data };
    await ctx.editMessageText("Type your custom note (e.g. _taken with juice_, _after dinner_):", {
      parse_mode: "Markdown",
    });
    return;
  }
  const description = key === "skip" ? null : (DESC_PRESETS.find((d) => d.key === key)?.value ?? null);
  userState[id] = { step: "add_habit_time", data: { ...state.data, ...(description ? { description } : {}) } };
  await ctx.editMessageText(
    `⏰ Almost done! What time should I remind you?\n\nEnter HH:MM (24h), e.g. *08:00*, *20:30*`,
    { parse_mode: "Markdown" },
  );
});

// ─── SETTINGS: EDIT HABIT ────────────────────────────────────────────────────

bot.action("settings_edit", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habits = await getUserHabits(id);
  await ctx.answerCbQuery();
  if (habits.length === 0) {
    await ctx.reply("You have no active habits to edit.");
    return;
  }
  const buttons = habits.map((h) => {
    const label = `${catEmoji(h.category)}${h.name} — ⏰ ${h.reminderTime}`;
    return [Markup.button.callback(label, `hab_edit_${h.id}`)];
  });
  await ctx.reply("Which habit would you like to edit?", Markup.inlineKeyboard(buttons));
});

bot.action(/^hab_edit_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = parseInt(ctx.match[1]!);
  await ctx.answerCbQuery();
  const habit = await getHabitById(habitId, id);
  if (!habit) { await ctx.reply("Habit not found."); return; }
  const catLabel = habit.category ? ` _(${CAT_LABELS[habit.category] ?? habit.category})_` : "";
  const descLabel = habit.description ? `\n📝 ${habit.description}` : "";
  const times = [habit.reminderTime, habit.reminderTime2, habit.reminderTime3].filter(Boolean).join(", ");
  await ctx.reply(
    `✏️ Editing: *${habit.name}*${catLabel}\n⏰ ${times}${descLabel}\n\nWhat do you want to change?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✏️ Name", `habedit_name_${habitId}`), Markup.button.callback("⏰ Time 1", `habedit_time_${habitId}`)],
        [Markup.button.callback("⏰ Time 2", `habedit_time2_${habitId}`), Markup.button.callback("⏰ Time 3", `habedit_time3_${habitId}`)],
        [Markup.button.callback("🏷️ Category", `habedit_cat_${habitId}`), Markup.button.callback("📝 Note", `habedit_desc_${habitId}`)],
        [Markup.button.callback("🗑️ Delete this habit", `delete_${habitId}`)],
      ]),
    },
  );
});

bot.action(/^habedit_name_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  userState[id] = { step: "edit_habit_name", data: { habitId } };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the new habit name:");
});

bot.action(/^habedit_time_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  userState[id] = { step: "edit_habit_time", data: { habitId } };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the new reminder time in HH:MM format (e.g. 08:00):");
});

bot.action(/^habedit_cat_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  await ctx.answerCbQuery();
  await ctx.reply("Choose the new category:", catKeyboard(`habec_${habitId}_`));
});

bot.action(/^habec_(\d+)_(.+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = parseInt(ctx.match[1]!);
  const cat = ctx.match[2]!;
  await updateHabit(habitId, id, { category: cat });
  await ctx.answerCbQuery("Category updated!");
  await ctx.editMessageText(`✅ Category updated to *${CAT_LABELS[cat] ?? cat}*!`, { parse_mode: "Markdown" });
});

bot.action(/^habedit_desc_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  await ctx.answerCbQuery();
  await ctx.reply("Choose a note or type a custom one:", descKeyboard(`habed_${habitId}_`, "🗑️ Remove note"));
});

bot.action(/^habed_(\d+)_(.+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = parseInt(ctx.match[1]!);
  const key = ctx.match[2]!;
  if (key === "custom") {
    userState[id] = { step: "edit_habit_desc_custom", data: { habitId: String(habitId) } };
    await ctx.answerCbQuery();
    await ctx.editMessageText("Type your custom note:");
    return;
  }
  if (key === "skip") {
    await updateHabit(habitId, id, { description: null });
    await ctx.answerCbQuery("Note removed.");
    await ctx.editMessageText("🗑️ Note removed.");
    return;
  }
  const description = DESC_PRESETS.find((d) => d.key === key)?.value ?? key;
  await updateHabit(habitId, id, { description });
  await ctx.answerCbQuery("Note updated!");
  await ctx.editMessageText(`✅ Note updated to: _${description}_`, { parse_mode: "Markdown" });
});

// ─── EXTRA REMINDER TIMES ────────────────────────────────────────────────────

bot.action(/^habedit_time2_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  userState[id] = { step: "edit_habit_time2", data: { habitId } };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the 2nd reminder time in HH:MM format (e.g. 13:00), or type *remove* to clear it:", { parse_mode: "Markdown" });
});

bot.action(/^habedit_time3_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  userState[id] = { step: "edit_habit_time3", data: { habitId } };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the 3rd reminder time in HH:MM format (e.g. 20:00), or type *remove* to clear it:", { parse_mode: "Markdown" });
});

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

bot.command("leaderboard", async (ctx): Promise<void> => {
  const id = String(ctx.from.id);
  const user = await getUser(id);
  const tz = user?.timezone ?? "UTC";
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: tz });
  const todayDate = new Date(today + "T12:00:00Z");
  const dayOfWeek = todayDate.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(todayDate);
  weekStart.setUTCDate(todayDate.getUTCDate() - daysFromMonday);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const daysElapsed = daysFromMonday + 1;

  const habits = await getUserHabits(id);
  const { db, completionsTable, waterLogsTable, supplementCheckinsTable } = await import("@workspace/db");
  const { eq, and, gte, lte } = await import("drizzle-orm");

  const completions = await db.select().from(completionsTable)
    .where(and(eq(completionsTable.telegramId, id), gte(completionsTable.completedDate, weekStartStr), lte(completionsTable.completedDate, today)));
  const completionsByHabit: Record<number, number> = {};
  for (const c of completions) completionsByHabit[c.habitId] = (completionsByHabit[c.habitId] ?? 0) + 1;

  const waterRows = await db.select().from(waterLogsTable)
    .where(and(eq(waterLogsTable.telegramId, id), gte(waterLogsTable.logDate, weekStartStr), lte(waterLogsTable.logDate, today)));
  const waterByDay: Record<string, number> = {};
  for (const r of waterRows) waterByDay[r.logDate] = (waterByDay[r.logDate] ?? 0) + r.amountMl;
  const waterGoalDays = Object.values(waterByDay).filter((ml) => ml >= WATER_GOAL_ML).length;

  const suppRows = await db.select().from(supplementCheckinsTable)
    .where(and(eq(supplementCheckinsTable.telegramId, id), gte(supplementCheckinsTable.checkinDate, weekStartStr), lte(supplementCheckinsTable.checkinDate, today)));

  const weekLabel = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const lines = [
    `🏆 *Weekly Stats — Week of ${weekLabel}*`,
    ``,
    `💧 Water 2L goal: *${waterGoalDays}/${daysElapsed} days*`,
    `💊 Supplement: *${suppRows.length}/${daysElapsed} days*`,
  ];

  if (habits.length > 0) {
    lines.push(``, `✨ *Habits:*`);
    for (const h of habits) {
      const done = completionsByHabit[h.id] ?? 0;
      const pct = daysElapsed > 0 ? Math.round((done / daysElapsed) * 100) : 0;
      lines.push(`• *${h.name}*: ${done}/${daysElapsed} days (${pct}%)`);
    }
  }

  const bestHabit = habits.reduce<{ name: string; done: number } | null>((best, h) => {
    const done = completionsByHabit[h.id] ?? 0;
    return !best || done > best.done ? { name: h.name, done } : best;
  }, null);
  if (bestHabit && bestHabit.done > 0) {
    lines.push(``, `🔥 Best this week: *${bestHabit.name}* (${bestHabit.done} days)`);
  }

  lines.push(``, `_Tracked by @Leoremindersandtracker_bot_`);
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
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

bot.action("settings_morning", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  await ctx.answerCbQuery();
  if (user?.morningReminderTime) {
    await ctx.reply(
      `Your morning briefing is set to *${user.morningReminderTime}* every day.\n\nWhat would you like to do?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✏️ Change time", "morning_set_new")],
          [Markup.button.callback("🔕 Turn off", "morning_disable")],
        ]),
      },
    );
  } else {
    userState[id] = { step: "set_morning_time" };
    await ctx.reply(
      "What time should I send your daily briefing?\n\nEnter in HH:MM format (24h), e.g. *08:00*, *07:30*",
      { parse_mode: "Markdown" },
    );
  }
});

bot.action("morning_set_new", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "set_morning_time" };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the new time in HH:MM format (e.g. 08:00):", { parse_mode: "Markdown" });
});

bot.action("morning_disable", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  await setMorningReminderTime(id, null);
  await ctx.answerCbQuery("Morning briefing turned off.");
  await ctx.editMessageText("🔕 Morning briefing disabled. You can turn it back on anytime via ⚙️ Settings.");
});

// ─── EVENING NUDGE SETTINGS ───────────────────────────────────────────────────

bot.action("settings_nudge", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const user = await getUser(id);
  await ctx.answerCbQuery();
  if (user?.eveningNudgeTime) {
    await ctx.reply(
      `Your evening nudge is set to *${user.eveningNudgeTime}*.\n\nI'll check if any habits are undone and give you a little push 😤`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✏️ Change time", "nudge_set_new")],
          [Markup.button.callback("🔕 Turn off", "nudge_disable")],
        ]),
      },
    );
  } else {
    userState[id] = { step: "set_nudge_time" };
    await ctx.reply("What time should I nudge you if habits are undone?\n\nEnter HH:MM (24h), e.g. *21:00*, *20:30*", {
      parse_mode: "Markdown",
    });
  }
});

bot.action("nudge_set_new", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  userState[id] = { step: "set_nudge_time" };
  await ctx.answerCbQuery();
  await ctx.reply("Enter the new nudge time in HH:MM format (e.g. 21:00):");
});

bot.action("nudge_disable", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  await setEveningNudgeTime(id, null);
  await ctx.answerCbQuery("Evening nudge turned off.");
  await ctx.editMessageText("🔕 Evening nudge disabled. Turn it back on anytime via ⚙️ Settings.");
});

// ─── PAUSE HABIT ─────────────────────────────────────────────────────────────

bot.action("settings_pause", async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habits = await getUserHabits(id);
  await ctx.answerCbQuery();
  if (habits.length === 0) { await ctx.reply("No habits to pause."); return; }
  const today = todayStr();
  const buttons = habits.map((h) => {
    const isPaused = !!(h.pausedUntil && h.pausedUntil >= today);
    const label = isPaused ? `▶️ Resume: ${h.name}` : `⏸️ Pause: ${h.name}`;
    const action = isPaused ? `hab_resume_${h.id}` : `hab_pause_${h.id}`;
    return [Markup.button.callback(label, action)];
  });
  await ctx.reply("Pick a habit to pause or resume:", Markup.inlineKeyboard(buttons));
});

bot.action(/^hab_pause_(\d+)$/, async (ctx): Promise<void> => {
  const habitId = parseInt(ctx.match[1]!);
  await ctx.answerCbQuery();
  await ctx.reply(
    "How long should I pause this habit?",
    Markup.inlineKeyboard([
      [Markup.button.callback("1 day", `habpause_1d_${habitId}`), Markup.button.callback("3 days", `habpause_3d_${habitId}`)],
      [Markup.button.callback("7 days", `habpause_7d_${habitId}`), Markup.button.callback("14 days", `habpause_14d_${habitId}`)],
      [Markup.button.callback("✏️ Custom", `habpause_custom_${habitId}`)],
    ]),
  );
});

bot.action(/^habpause_(\d+)d_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const days = parseInt(ctx.match[1]!);
  const habitId = parseInt(ctx.match[2]!);
  const until = new Date();
  until.setDate(until.getDate() + days);
  const untilStr = until.toISOString().slice(0, 10);
  await pauseHabit(habitId, id, untilStr);
  await ctx.answerCbQuery("Habit paused!");
  await ctx.editMessageText(`⏸️ Paused for *${days} day${days > 1 ? "s" : ""}* — until ${untilStr}.\n\nReminders will resume automatically after that.`, { parse_mode: "Markdown" });
});

bot.action(/^habpause_custom_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = ctx.match[1]!;
  userState[id] = { step: "pause_habit_days", data: { habitId } };
  await ctx.answerCbQuery();
  await ctx.reply("How many days to pause? Enter a number (e.g. 5):");
});

bot.action(/^hab_resume_(\d+)$/, async (ctx): Promise<void> => {
  const id = String(ctx.from!.id);
  const habitId = parseInt(ctx.match[1]!);
  await resumeHabit(habitId, id);
  await ctx.answerCbQuery("Habit resumed!");
  await ctx.editMessageText("▶️ Habit resumed! Reminders will fire again as normal.");
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
    userState[id] = { step: "add_habit_cat", data: { name: text } };
    await ctx.reply(
      `Nice! *${text}* — what category fits best?`,
      { parse_mode: "Markdown", ...catKeyboard("hab_cat_") },
    );
    return;
  }

  if (state.step === "add_habit_desc_custom") {
    userState[id] = { step: "add_habit_time", data: { ...state.data, description: text } };
    await ctx.reply("⏰ What time should I remind you?\n\nEnter HH:MM (24h), e.g. *08:00*, *20:30*", {
      parse_mode: "Markdown",
    });
    return;
  }

  if (state.step === "add_habit_time") {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) {
      await ctx.reply("Please enter a valid time in HH:MM format (e.g. 08:00, 20:30).");
      return;
    }
    const name = state.data?.name ?? "Habit";
    const category = state.data?.category ?? null;
    const description = state.data?.description ?? null;
    await addHabit(id, name, text, category, description);
    clearState(id);
    const catLine = category ? ` _(${CAT_LABELS[category] ?? category})_` : "";
    const descLine = description ? `\n📝 ${description}` : "";
    await ctx.reply(`✅ *${name}* added!${catLine}\n⏰ Reminder at *${text}*${descLine}`, {
      parse_mode: "Markdown",
      ...mainMenu(),
    });
    return;
  }

  if (state.step === "edit_habit_name") {
    const habitId = parseInt(state.data?.habitId ?? "0");
    if (!habitId) { clearState(id); return; }
    await updateHabit(habitId, id, { name: text });
    clearState(id);
    await ctx.reply(`✅ Habit name updated to *${text}*!`, { parse_mode: "Markdown", ...mainMenu() });
    return;
  }

  if (state.step === "edit_habit_time") {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) {
      await ctx.reply("Please enter a valid time in HH:MM format (e.g. 08:00, 20:30).");
      return;
    }
    const habitId = parseInt(state.data?.habitId ?? "0");
    if (!habitId) { clearState(id); return; }
    await updateHabit(habitId, id, { reminderTime: text });
    clearState(id);
    await ctx.reply(`✅ Reminder time updated to *${text}*!`, { parse_mode: "Markdown", ...mainMenu() });
    return;
  }

  if (state.step === "edit_habit_desc_custom") {
    const habitId = parseInt(state.data?.habitId ?? "0");
    if (!habitId) { clearState(id); return; }
    await updateHabit(habitId, id, { description: text });
    clearState(id);
    await ctx.reply(`✅ Note updated to: _${text}_`, { parse_mode: "Markdown", ...mainMenu() });
    return;
  }

  if (state.step === "edit_habit_time2") {
    const habitId = parseInt(state.data?.habitId ?? "0");
    if (!habitId) { clearState(id); return; }
    if (text.toLowerCase() === "remove") {
      await updateHabit(habitId, id, { reminderTime2: null });
      clearState(id);
      await ctx.reply("✅ 2nd reminder removed.", { ...mainMenu() });
      return;
    }
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) { await ctx.reply("Enter HH:MM (e.g. 13:00) or 'remove' to clear."); return; }
    await updateHabit(habitId, id, { reminderTime2: text });
    clearState(id);
    await ctx.reply(`✅ 2nd reminder set to *${text}*!`, { parse_mode: "Markdown", ...mainMenu() });
    return;
  }

  if (state.step === "edit_habit_time3") {
    const habitId = parseInt(state.data?.habitId ?? "0");
    if (!habitId) { clearState(id); return; }
    if (text.toLowerCase() === "remove") {
      await updateHabit(habitId, id, { reminderTime3: null });
      clearState(id);
      await ctx.reply("✅ 3rd reminder removed.", { ...mainMenu() });
      return;
    }
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) { await ctx.reply("Enter HH:MM (e.g. 20:00) or 'remove' to clear."); return; }
    await updateHabit(habitId, id, { reminderTime3: text });
    clearState(id);
    await ctx.reply(`✅ 3rd reminder set to *${text}*!`, { parse_mode: "Markdown", ...mainMenu() });
    return;
  }

  if (state.step === "set_nudge_time") {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) { await ctx.reply("Please enter a valid time in HH:MM format (e.g. 21:00)."); return; }
    await setEveningNudgeTime(id, text);
    clearState(id);
    await ctx.reply(
      `✅ Evening nudge set for *${text}*!\n\nIf any habits are undone by then, I'll give u a little push 😤`,
      { parse_mode: "Markdown", ...mainMenu() },
    );
    return;
  }

  if (state.step === "pause_habit_days") {
    const days = parseInt(text);
    if (isNaN(days) || days < 1 || days > 365) { await ctx.reply("Enter a number between 1 and 365."); return; }
    const habitId = parseInt(state.data?.habitId ?? "0");
    if (!habitId) { clearState(id); return; }
    const until = new Date();
    until.setDate(until.getDate() + days);
    const untilStr = until.toISOString().slice(0, 10);
    await pauseHabit(habitId, id, untilStr);
    clearState(id);
    await ctx.reply(`⏸️ Paused for *${days} day${days > 1 ? "s" : ""}* — until ${untilStr}.`, { parse_mode: "Markdown", ...mainMenu() });
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

  if (state.step === "set_morning_time") {
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text)) {
      await ctx.reply("Please enter a valid time in HH:MM format (e.g. 08:00, 07:30).");
      return;
    }
    await setMorningReminderTime(id, text);
    clearState(id);
    await ctx.reply(
      `✅ Morning briefing set for *${text}* every day!\n\nI'll send you a daily summary with your habits, water goal, and supplement status.`,
      { parse_mode: "Markdown", ...mainMenu() },
    );
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

// ─── STICKER HANDLER ─────────────────────────────────────────────────────────

const STICKER_PACKS = [
  "STrAYKiDs_best", "moodmorsh_by_fStikBot",
  "SKZ_5star_new", "hwanhj_by_fStikBot", "SkzRuvrV",
  "Forever_loved_ones_by_fStikBot", "straykidshyunjinstickerpack",
  "txtkku4", "vhhnkko_by_fStikBot", "homelessskids",
];

interface CachedSticker { fileId: string; emoji: string }
let cachedStickers: CachedSticker[] = [];

async function loadStickerPool(botInstance: Telegraf): Promise<CachedSticker[]> {
  if (cachedStickers.length > 0) return cachedStickers;
  const all: CachedSticker[] = [];
  for (const pack of STICKER_PACKS) {
    try {
      const set = await botInstance.telegram.getStickerSet(pack);
      for (const s of set.stickers) all.push({ fileId: s.file_id, emoji: s.emoji ?? "" });
    } catch (err) {
      logger.warn({ err, pack }, "Could not load sticker pack");
    }
  }
  cachedStickers = all;
  return all;
}

async function pickSticker(botInstance: Telegraf, filter?: Set<string>): Promise<string | null> {
  const pool = await loadStickerPool(botInstance);
  const filtered = filter ? pool.filter((s) => filter.has(s.emoji)) : pool;
  const source = filtered.length > 0 ? filtered : pool;
  if (source.length === 0) return null;
  return source[Math.floor(Math.random() * source.length)]!.fileId;
}

async function sendSticker(botInstance: Telegraf, chatId: string, filter?: Set<string>): Promise<void> {
  const fileId = await pickSticker(botInstance, filter);
  if (fileId) await botInstance.telegram.sendSticker(chatId, fileId);
}

bot.on("sticker", async (ctx): Promise<void> => {
  const fileId = await pickSticker(bot);
  if (!fileId) return;
  await ctx.replyWithSticker(fileId);
});

// ─── REMINDERS ───────────────────────────────────────────────────────────────

async function sendMorningBriefing(botInstance: Telegraf, telegramId: string, timezone: string, cycleStartDate: string | null): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const { db, habitsTable, completionsTable } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");

  const habits = await db
    .select()
    .from(habitsTable)
    .where(and(eq(habitsTable.telegramId, telegramId), eq(habitsTable.isActive, true)));

  const done = await db
    .select()
    .from(completionsTable)
    .where(and(eq(completionsTable.telegramId, telegramId), eq(completionsTable.completedDate, today)));
  const doneIds = new Set(done.map((d) => d.habitId));

  const dayName = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: timezone });
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: timezone });

  const greetings = [
    "you got this today 🌸",
    "stay consistent, it adds up ✨",
    "every day counts 💫",
    "soft and steady wins 🌷",
    "your future self will thank you 🌙",
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)]!;

  const habitLines = habits.length > 0
    ? habits.map((h) => `${doneIds.has(h.id) ? "✅" : "⬜"} ${h.name}`).join("\n")
    : "_No habits set up yet_";

  let supplementLine = "";
  if (cycleStartDate) {
    const info = getCycleInfo(cycleStartDate);
    if (!info.courseDone) {
      supplementLine = info.isOn
        ? `\n\n💊 *Supplement* — ON phase, Day ${info.dayInPhase}/${info.phaseTotal} (Cycle ${info.cycleNum}/3)`
        : `\n\n☕ *Supplement* — Break phase, Day ${info.dayInPhase}/${info.phaseTotal}`;
    }
  }

  const lines = [
    `🌅 *Good morning! ${dayName}, ${dateLabel}*`,
    `_${greeting}_`,
    ``,
    `📋 *Today's habits:*`,
    habitLines,
    ``,
    `💧 *Water goal:* 2,000ml — let's get hydrated!`,
    supplementLine,
  ].join("\n");

  const buttons = habits.length > 0
    ? [habits.slice(0, 4).map((h) => Markup.button.callback(doneIds.has(h.id) ? `✅ ${h.name}` : `⬜ ${h.name}`, `toggle_${h.id}`))]
    : [];

  await botInstance.telegram.sendMessage(telegramId, lines, {
    parse_mode: "Markdown",
    ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
  });
}

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
          reminderTime2: habitsTable.reminderTime2,
          reminderTime3: habitsTable.reminderTime3,
          pausedUntil: habitsTable.pausedUntil,
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
      // Extra reminder times (reminderTime2, reminderTime3)
      for (const habit of habits) {
        const tz = habit.timezone ?? "UTC";
        const today = now.toLocaleDateString("en-CA", { timeZone: tz });
        const localTime = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
        for (const extraTime of [habit.reminderTime2, habit.reminderTime3]) {
          if (!extraTime || localTime !== extraTime) continue;
          const { db: db2, completionsTable: ct2 } = await import("@workspace/db");
          const { eq: eq2, and: and2 } = await import("drizzle-orm");
          const existing2 = await db2.select().from(ct2).where(and2(eq2(ct2.habitId, habit.habitId), eq2(ct2.telegramId, habit.telegramId), eq2(ct2.completedDate, today))).limit(1);
          if (existing2.length === 0) {
            await botInstance.telegram.sendMessage(habit.telegramId, `⏰ *Reminder!*\n\nTime to: *${habit.habitName}*\n\nTap below to mark it done!`, {
              parse_mode: "Markdown",
              ...Markup.inlineKeyboard([[Markup.button.callback(`✅ Done — ${habit.habitName}`, `toggle_${habit.habitId}`)]]),
            });
          }
        }
      }

      // Morning briefing
      const usersWithMorning = await getAllUsersWithMorningReminder();
      for (const user of usersWithMorning) {
        if (!user.morningReminderTime) continue;
        const tz = user.timezone ?? "UTC";
        const localTime = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
        if (localTime === user.morningReminderTime) {
          try {
            await sendMorningBriefing(botInstance, user.telegramId, tz, user.ekstrajenStartDate ?? null);
          } catch (err) {
            logger.error({ err, telegramId: user.telegramId }, "Failed to send morning briefing");
          }
        }
      }

      // Evening nudge
      const usersWithNudge = await getAllUsersWithEveningNudge();
      for (const user of usersWithNudge) {
        if (!user.eveningNudgeTime) continue;
        const tz = user.timezone ?? "UTC";
        const localTime = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
        if (localTime !== user.eveningNudgeTime) continue;
        try {
          const { db: db3, habitsTable: ht3, completionsTable: ct3 } = await import("@workspace/db");
          const { eq: eq3, and: and3 } = await import("drizzle-orm");
          const today = now.toLocaleDateString("en-CA", { timeZone: tz });
          const activeHabits = await db3.select().from(ht3).where(and3(eq3(ht3.telegramId, user.telegramId), eq3(ht3.isActive, true)));
          const doneToday = await db3.select().from(ct3).where(and3(eq3(ct3.telegramId, user.telegramId), eq3(ct3.completedDate, today)));
          const doneIds = new Set(doneToday.map((d) => d.habitId));
          const undone = activeHabits.filter((h) => !doneIds.has(h.id) && !(h.pausedUntil && h.pausedUntil >= today));
          if (undone.length === 0) continue;
          const habitList = undone.map((h) => `⬜ ${h.name}`).join("\n");
          const msg = pickNudgeMessage();
          await botInstance.telegram.sendMessage(user.telegramId, `${msg}\n\n${habitList}`, {
            ...Markup.inlineKeyboard(undone.slice(0, 3).map((h) => [Markup.button.callback(`✅ ${h.name}`, `toggle_${h.id}`)])),
          });
        } catch (err) {
          logger.error({ err, telegramId: user.telegramId }, "Evening nudge failed");
        }
      }

      // Midnight miss (23:50)
      const allUsers = await getAllUsers();
      for (const user of allUsers) {
        const tz = user.timezone ?? "UTC";
        const localTime = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
        if (localTime !== "23:50") continue;
        try {
          const { db: db4, habitsTable: ht4, completionsTable: ct4 } = await import("@workspace/db");
          const { eq: eq4, and: and4 } = await import("drizzle-orm");
          const today = now.toLocaleDateString("en-CA", { timeZone: tz });
          const activeHabits = await db4.select().from(ht4).where(and4(eq4(ht4.telegramId, user.telegramId), eq4(ht4.isActive, true)));
          const doneToday = await db4.select().from(ct4).where(and4(eq4(ct4.telegramId, user.telegramId), eq4(ct4.completedDate, today)));
          const doneIds = new Set(doneToday.map((d) => d.habitId));
          const undone = activeHabits.filter((h) => !doneIds.has(h.id) && !(h.pausedUntil && h.pausedUntil >= today));
          if (undone.length === 0) continue;
          await botInstance.telegram.sendMessage(user.telegramId, pickMissMessage());
          await sendSticker(botInstance, user.telegramId, SAD_EMOJIS);
        } catch (err) {
          logger.error({ err, telegramId: user.telegramId }, "Midnight miss check failed");
        }
      }

      // Sunday wrap-up (20:00 local time)
      for (const user of allUsers) {
        const tz = user.timezone ?? "UTC";
        if (!isSundayEvening(tz)) continue;
        try {
          const summary = await buildWeeklyWrapup(user.telegramId, tz);
          await botInstance.telegram.sendMessage(user.telegramId, summary, { parse_mode: "Markdown" });
          await sendSticker(botInstance, user.telegramId, HAPPY_EMOJIS);
        } catch (err) {
          logger.error({ err, telegramId: user.telegramId }, "Weekly wrap-up failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "Reminder cron error");
    }
  });

  logger.info("Reminder scheduler started");
}
