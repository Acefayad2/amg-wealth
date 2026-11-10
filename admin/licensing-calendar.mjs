export const easternDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function addDays(day, offset) {
  const value = new Date(day + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function mondayOf(day = easternDay()) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}
export function examTimeLabel(time) {
  if (!time) return 'Time not set';
  const [hour, minute] = time.split(':');
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? 'PM' : 'AM'}`;
}
