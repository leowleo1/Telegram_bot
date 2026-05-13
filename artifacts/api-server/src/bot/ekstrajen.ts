const CYCLE_ON = 20;
const CYCLE_BREAK = 10;
const CYCLE_TOTAL = CYCLE_ON + CYCLE_BREAK;
const COURSE_DAYS = 90;

export interface CycleInfo {
  isOn: boolean;
  dayInPhase: number;
  phaseTotal: number;
  cycleNum: number;
  overallDay: number;
  overallProgress: number;
  courseDone: boolean;
}

export function getCycleInfo(startDateStr: string): CycleInfo {
  const start = new Date(startDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  const daysSinceStart = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const overallDay = daysSinceStart + 1;
  const posInCycle = daysSinceStart % CYCLE_TOTAL;
  const cycleNum = Math.min(Math.floor(daysSinceStart / CYCLE_TOTAL) + 1, 3);
  const isOn = posInCycle < CYCLE_ON;
  const dayInPhase = isOn ? posInCycle + 1 : posInCycle - CYCLE_ON + 1;
  const phaseTotal = isOn ? CYCLE_ON : CYCLE_BREAK;
  const overallProgress = Math.min(Math.round((daysSinceStart / COURSE_DAYS) * 100), 100);
  const courseDone = daysSinceStart >= COURSE_DAYS;

  return { isOn, dayInPhase, phaseTotal, cycleNum, overallDay, overallProgress, courseDone };
}

function dotsRow(filled: number, current: number, total: number, filledEmoji: string, emptyEmoji: string): string {
  const dots: string[] = [];
  for (let i = 1; i <= total; i++) {
    if (i < current) dots.push(filledEmoji);
    else if (i === current) dots.push("🔘");
    else dots.push(emptyEmoji);
  }
  return dots.join("");
}

export function formatCycleMessage(startDateStr: string): string {
  const info = getCycleInfo(startDateStr);

  if (info.courseDone) {
    return "🎉 *Congratulations!*\n\nYou've completed the full 90-day course! Tap Reset to start a new one.";
  }

  const onDots = dotsRow(info.dayInPhase, info.isOn ? info.dayInPhase : CYCLE_ON + 1, CYCLE_ON, "🟣", "⬜");
  const breakDots = dotsRow(
    info.isOn ? 0 : info.dayInPhase,
    info.isOn ? 0 : info.dayInPhase,
    CYCLE_BREAK,
    "🔵",
    "⬜",
  );

  const phaseLabel = info.isOn
    ? `💊 *ON phase* — Day ${info.dayInPhase} of ${CYCLE_ON}`
    : `☕ *Break* — Day ${info.dayInPhase} of ${CYCLE_BREAK}`;

  const advice = info.isOn
    ? "_Take 2 caps 20 min before lunch. Stay consistent!_"
    : "_Rest phase. Your body is absorbing the benefits._";

  const progressBar = buildProgressBar(info.overallProgress);

  return (
    `💊 *Specific Daily Supplement*\n\n` +
    `${phaseLabel}\n` +
    `${advice}\n\n` +
    `*Cycle ${info.cycleNum} of 3*\n` +
    `ON:    ${onDots}\n` +
    `Break: ${breakDots}\n\n` +
    `*90-day course progress*\n` +
    `${progressBar} ${info.overallProgress}%\n` +
    `_Day ${info.overallDay} of 90_`
  );
}

function buildProgressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "▓".repeat(filled) + "░".repeat(10 - filled);
}
