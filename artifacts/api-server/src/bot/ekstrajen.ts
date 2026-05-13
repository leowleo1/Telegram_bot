const CYCLE_LENGTH = 28;

const PHASES: { name: string; days: [number, number]; emoji: string; description: string }[] = [
  { name: "Menstrual", days: [1, 5], emoji: "🔴", description: "Rest & restore. Low energy is normal — be gentle with yourself." },
  { name: "Follicular", days: [6, 13], emoji: "🌱", description: "Energy rising! Great time to start new habits and take on challenges." },
  { name: "Ovulation", days: [14, 17], emoji: "✨", description: "Peak energy & confidence. Best time for social and high-intensity goals." },
  { name: "Luteal", days: [18, 28], emoji: "🌙", description: "Wind down. Focus on completing tasks and self-care routines." },
];

export function getEkstrajenStatus(startDateStr: string): string {
  const start = new Date(startDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dayInCycle = (diffDays % CYCLE_LENGTH) + 1;

  const phase = PHASES.find((p) => dayInCycle >= p.days[0] && dayInCycle <= p.days[1]);

  if (!phase) return `Day ${dayInCycle} of your cycle.`;

  const daysLeft = phase.days[1] - dayInCycle;

  return (
    `${phase.emoji} *${phase.name} Phase* — Day ${dayInCycle} of cycle\n` +
    `${phase.description}\n` +
    `_${daysLeft === 0 ? "Last day of this phase!" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in this phase`}_`
  );
}
