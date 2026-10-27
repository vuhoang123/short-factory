export interface ScheduledSlot { at: Date; accountId?: string }
export interface SchedulePreviewInput {
  now: Date;
  timezone: string;
  postingTimes: readonly string[];
  count: number;
  existing: readonly ScheduledSlot[];
  cooldownMinutes: number;
  dailyLimit: number;
  accountId?: string;
  horizonDays?: number;
}

function clock(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}
function localParts(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function zonedDateKey(date: Date, timezone: string): string { return localParts(clock(timezone), date).day; }

/** Walk real UTC minutes so missing DST times are skipped and repeated wall times appear only once. */
export function schedulePreview(input: SchedulePreviewInput): Date[] {
  if (!Number.isFinite(input.now.getTime()) || !Number.isInteger(input.count) || input.count < 0 || input.count > 100 || !Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || !Number.isFinite(input.cooldownMinutes) || input.cooldownMinutes < 1 || input.existing.some((slot) => !Number.isFinite(slot.at.getTime()))) throw new Error('SCHEDULE_INPUT_INVALID');
  if (!input.postingTimes.length || input.postingTimes.some((time) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('SCHEDULE_TIME_INVALID');
  const formatter = clock(input.timezone);
  const times = new Set(input.postingTimes);
  const selected: Date[] = [];
  const relevant = input.existing.filter((slot) => !input.accountId || slot.accountId === input.accountId).map((slot) => slot.at);
  const usedWallSlots = new Set(relevant.map((at) => { const local = localParts(formatter, at); return `${local.day}:${local.time}`; }));
  const dayCounts = new Map<string, number>();
  for (const date of relevant) {
    const day = localParts(formatter, date).day;
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const startMs = Math.ceil(input.now.getTime() / 60_000) * 60_000;
  const horizonDays = input.horizonDays ?? 31;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 90) throw new Error('SCHEDULE_HORIZON_INVALID');
  for (let atMs = startMs; atMs < startMs + horizonDays * 86_400_000 && selected.length < input.count; atMs += 60_000) {
    const date = new Date(atMs);
    const local = localParts(formatter, date);
    const wallSlot = `${local.day}:${local.time}`;
    if (!times.has(local.time) || usedWallSlots.has(wallSlot) || (dayCounts.get(local.day) ?? 0) >= input.dailyLimit) continue;
    if ([...relevant, ...selected].some((existing) => Math.abs(existing.getTime() - atMs) < input.cooldownMinutes * 60_000)) continue;
    selected.push(date);
    usedWallSlots.add(wallSlot);
    dayCounts.set(local.day, (dayCounts.get(local.day) ?? 0) + 1);
  }
  return selected;
}
