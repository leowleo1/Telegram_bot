const GOAL_ML = 2000;

const REWARDS: { threshold: number; msg: string }[] = [
  { threshold: 500,  msg: "💧 500ml in — great start!" },
  { threshold: 1000, msg: "🌊 Halfway there — 1 litre down!" },
  { threshold: 1500, msg: "💦 1.5L! Almost at your goal!" },
  { threshold: 2000, msg: "🎉 Goal reached! You hit 2 litres today!" },
  { threshold: 2500, msg: "🏆 2.5L — absolutely crushing it!" },
  { threshold: 3000, msg: "🌟 3 litres! You're a hydration legend!" },
];

export function getRewardMessage(prev: number, current: number): string | null {
  for (const r of REWARDS) {
    if (prev < r.threshold && current >= r.threshold) return r.msg;
  }
  return null;
}

export function buildWaterBar(totalMl: number): string {
  const pct = Math.min(totalMl / GOAL_ML, 1);
  const filled = Math.round(pct * 10);
  const bar = "💧".repeat(filled) + "⬜".repeat(10 - filled);
  const over = totalMl > GOAL_ML ? ` (+${totalMl - GOAL_ML}ml over!)` : "";
  return `${bar}\n${totalMl}ml / ${GOAL_ML}ml${over}`;
}

export function waterStatusText(totalMl: number, date: string): string {
  const pct = Math.round((totalMl / GOAL_ML) * 100);
  const overGoal = totalMl >= GOAL_ML;
  const header = overGoal
    ? `💧 *Water — ${date}* 🎉`
    : `💧 *Water — ${date}*`;
  return `${header}\n\n${buildWaterBar(totalMl)}\n_${pct}% of daily goal_`;
}

export const WATER_GOAL_ML = GOAL_ML;
