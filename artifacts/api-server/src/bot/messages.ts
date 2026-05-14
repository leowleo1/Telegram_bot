// ─── STICKER EMOJI SETS ───────────────────────────────────────────────────────

export const HAPPY_EMOJIS = new Set([
  "😍","🥰","😘","😚","🥳","🤗","💕","❤️","😽","🫶","😻",
]);

export const SAD_EMOJIS = new Set([
  "🤨","😒","😔","☹️","😕","🙁","😡","🤬","😑","🤢",
]);

// ─── EVENING NUDGE MESSAGES ───────────────────────────────────────────────────

export const NUDGE_MESSAGES = [
  "what u doinnn gotta complete that goal cmoon 😤",
  "the habit is literally just sitting there waiting for u 👀",
  "babe. the habit. it's still not done. we need to talk.",
  "ur future self is giving u the most disappointed look rn 😔",
  "cmoon bestie u were doing SO well don't let today be the day 😭",
  "the streak is RIGHT THERE. don't abandon it like this.",
  "ur habits been patient all day. they are getting tired 😑",
  "ok so we're just NOT doing it today?? really?? 🤨",
  "reminder that ur future self is literally rooting for u rn go DO it",
  "this is ur sign. no seriously. this IS the sign. go.",
  "the habit said 'when r u coming' and honestly same 😒",
  "bestie the day is almost over and ur habits still undone hello??",
  "not to be dramatic but the habit misses u 😢",
  "u set this goal for a reason!! go!! now!! we believe in u!!",
  "the vibe check for today is incomplete until u do ur habits 🤨",
];

export function pickNudgeMessage(): string {
  return NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)]!;
}

// ─── MIDNIGHT MISS MESSAGES ───────────────────────────────────────────────────

export const MISS_MESSAGES = [
  "today's over and we didn't quite make it. tomorrow we go again 🌙",
  "day's done. some things didn't get checked off. that's okay — reset incoming.",
  "not every day is perfect. tomorrow is still there. go rest.",
  "it happens. tomorrow is a whole fresh shot. don't be too hard on urself 💙",
];

export function pickMissMessage(): string {
  return MISS_MESSAGES[Math.floor(Math.random() * MISS_MESSAGES.length)]!;
}

// ─── MILESTONE MESSAGES ───────────────────────────────────────────────────────

export const MILESTONE_MESSAGES: Record<number, string[]> = {
  7: [
    "7 Day Streak Achieved 🔥\n\"One whole week of showing up. Your discipline is lowkey unhinged (in the best way).\"",
    "One Week Strong 💫\n\"7 days in a row. ur habits slowly becoming ur personality and honestly? iconic.\"",
    "Weekly Warrior Unlocked 🏆\n\"Didn't miss a single day. Your future self is already planning a thank-you speech.\"",
  ],
  14: [
    "Two Weeks No Cap 🔥🔥\n\"14 days straight. At this point ur not building habits ur building CHARACTER.\"",
    "Fortnight Finisher 💪\n\"Two whole weeks. Your brain has literally started rewiring. The science said so.\"",
    "Half-Month Legend 🌟\n\"14 days. The habit is basically ur bestie now. It knows ur schedule.\"",
  ],
  30: [
    "30 Day Arc Complete 🏆👑\n\"A WHOLE MONTH. This is not a habit anymore this is just WHO U ARE.\"",
    "One Month Monster 🔥💀\n\"30 days in a row. Ur consistency is actually kind of terrifying (compliment).\"",
    "Monthly Milestone Achieved 🌙✨\n\"30 days. Studies say habits form around now. U didn't just track it — u BUILT it.\"",
  ],
};

export function getMilestoneMessage(streak: number): string | null {
  const pool = MILESTONE_MESSAGES[streak];
  if (!pool) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// ─── WEEKLY AWARD POOLS ───────────────────────────────────────────────────────

const HYDRATION_AWARDS = [
  (n: number) => `Wettest Citizen Alive 💧\n"${n} hydration goals hit. Your kidneys just kissed each other."`,
  (n: number) => `H2O Royalty 👑💧\n"Drank towards the goal ${n} days this week. Your cells probably glowing rn."`,
  (n: number) => `Hydration Arc Active 🌊\n"${n} water goals logged. Your organs finally relaxing a little. Love that for them."`,
  (n: number) => `Responsible Sipping Era 💧\n"${n} out of 7 days. Your body been sipping peacefully. Proud of u honestly."`,
];

const SUPPLEMENT_AWARDS = [
  (n: number) => `Pill Goblin (respectfully) 💊\n"${n} supplement days this week. Ur commitment to the routine is genuinely impressive."`,
  (n: number) => `Supplement Season Active 🧴\n"${n} days without missing. The cycle is literally eating. You feeding it right."`,
  (n: number) => `Cycle Guardian 💊✨\n"${n} days consistent. Ur future cells sending tiny thank-you notes rn."`,
];

const ACTIVITY_AWARDS = [
  (n: number) => `Gym Arc Alive and Breathing 🏃\n"${n} days of movement this week. Your future self definitely appreciated it."`,
  (n: number) => `Consistency Got Aura 💪\n"${n} habit days. Muscles probably gossiping about ur dedication rn."`,
  (n: number) => `Sweaty Glorious Era 🔥\n"${n} days of showing up. Every single one counted. Even the messy ones."`,
];

const WELLNESS_AWARDS = [
  (n: number) => `Gentle With Yourself Award 🧘\n"${n} wellness habits done. You kept going without abandoning yourself. Big win."`,
  (n: number) => `Nervous System Appreciation Week 💙\n"${n} days of intentional care. Your nervous system got some calmer moments."`,
  (n: number) => `Inner Peace Cultivator 🌸\n"${n} days. Healing isn't linear but dihh you still moving forward."`,
];

const PRODUCTIVITY_AWARDS = [
  (n: number) => `Quietly Cooking All Week 🔥\n"${n} habits done. Task by task you built something solid."`,
  (n: number) => `Showed Up Award 🏆\n"${n} days of just doing it. You did the hard stuff even when the vibe was off."`,
  (n: number) => `Consistency Looked Cute On You ✨\n"${n} out of 7 days. Not every day was perfect but look at you GO."`,
];

const GENERAL_AWARDS = [
  (n: number) => `Progress Report: Immaculate 🌟\n"${n} habits tracked this week. Somewhere in the future, you're thanking yourself."`,
  (n: number) => `Reliable Era Unlocked 💫\n"${n} days consistent. Dihh you really becoming someone reliable."`,
  (n: number) => `Little Wins Stacking 🏆\n"${n} habit days. Little wins stacking into something dangerous."`,
  (n: number) => `Becoming Someone Solid ✨\n"${n} days. Your habits slowly turning into home."`,
];

function pickFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export interface WeeklyAwardInput {
  waterGoalDays: number;
  suppDays: number;
  topHabit: { name: string; category: string | null; done: number } | null;
  totalHabitDays: number;
  daysElapsed: number;
}

export function generateWeeklyAward(input: WeeklyAwardInput): string {
  const { waterGoalDays, suppDays, topHabit, totalHabitDays, daysElapsed } = input;

  const awards: string[] = [];

  if (waterGoalDays >= 4) {
    awards.push(pickFrom(HYDRATION_AWARDS)(waterGoalDays));
  } else if (waterGoalDays >= 1) {
    awards.push(`Hydration In Progress 💧\n"${waterGoalDays} water goal days. Building the habit, one sip at a time."`);
  }

  if (suppDays >= 4) {
    awards.push(pickFrom(SUPPLEMENT_AWARDS)(suppDays));
  }

  if (topHabit && topHabit.done >= 4) {
    const cat = topHabit.category;
    const pool =
      cat === "activity" ? ACTIVITY_AWARDS :
      cat === "wellness" ? WELLNESS_AWARDS :
      (cat === "vitamins" || cat === "supplements") ? SUPPLEMENT_AWARDS :
      PRODUCTIVITY_AWARDS;
    awards.push(pickFrom(pool)(topHabit.done));
  }

  if (awards.length === 0) {
    awards.push(pickFrom(GENERAL_AWARDS)(totalHabitDays));
  }

  const totalDone = waterGoalDays + suppDays + totalHabitDays;
  const motiveLine =
    totalDone === 0 ? "_Hey, fresh start next week. You got this. 💙_" :
    daysElapsed <= 2 ? "_Week's just getting started — already moving 👀_" :
    pickFrom([
      "_Somewhere in the future, you're thanking yourself for this. 🌙_",
      "_Progress looked good on you this week. ✨_",
      "_Not perfect. Just consistent enough. That's real. 💫_",
      "_Honestly? Kinda proud of the person you're becoming. 🌸_",
      "_Your life quietly getting better in the background. 💙_",
      "_Dihh you really becoming someone reliable. 🔥_",
    ]);

  return awards.map((a) => `*${a.split("\n")[0]}*\n${a.split("\n").slice(1).join("\n")}`).join("\n\n") + `\n\n${motiveLine}`;
}

// ─── GENERAL MESSAGES ─────────────────────────────────────────────────────────

export const GENERAL_MESSAGES = [
  "Somewhere in the future, you're thanking yourself for this.",
  "Your habits slowly turning into home.",
  "Not perfect. Just consistent enough. That's real.",
  "Dihh you really becoming someone reliable.",
  "Progress looked good on you this week.",
  "Little wins stacking into something dangerous.",
  "You gave this week your best shot. That counts.",
  "Honestly? Kinda proud of the person you're becoming.",
  "Your life quietly getting better in the background.",
];
