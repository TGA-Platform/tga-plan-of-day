import { format, startOfWeek, addDays, parseISO, isToday } from 'date-fns';

export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 1 }); // Monday
  return Array.from({ length: 5 }, (_, i) => addDays(start, i));
}

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatDisplay(date: Date): string {
  return format(date, 'EEE d MMM');
}

export function formatLong(date: Date): string {
  return format(date, 'EEEE, d MMMM yyyy');
}

export function todayStr(): string {
  return formatDate(new Date());
}

export { isToday, parseISO, addDays, startOfWeek };
