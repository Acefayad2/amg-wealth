import { scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export const hashUnlock = value => createHash('sha256').update(value).digest('hex');
export function checkCalendarPin(pin, stored) {
  if (typeof pin !== 'string' || pin.length > 80 || typeof stored !== 'string') return false;
  const [salt, expected] = stored.split(':');
  if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
  return timingSafeEqual(scryptSync(pin, salt, 64), Buffer.from(expected, 'hex'));
}
const escape = text => String(text ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r/g, '');
const stamp = date => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
function fold(line) {
  const lines = []; let part = '', bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) { lines.push(part); part = ' '; bytes = 1; }
    part += char; bytes += size;
  }
  lines.push(part); return lines.join('\r\n');
}
export function examCalendarIcs(people, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AMG//Licensing Exams//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:AMG Licensing Exams', 'X-WR-TIMEZONE:America/New_York',
    'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'DTSTART:20070311T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'DTSTART:20071104T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const person of people) {
    const date = String(person.exam_date || '').slice(0, 10).replace(/-/g, '');
    if (!/^\d{8}$/.test(date)) continue;
    const time = person.exam_time ? String(person.exam_time).slice(0,8).replace(/:/g, '').padEnd(6, '0') : null;
    const track = {life:'Life',health:'Health',both:'Life and Health'}[person.track] || 'Licensing';
    lines.push('BEGIN:VEVENT', `UID:amg-license-${escape(person.id)}@anointedmoneygroup.com`, `DTSTAMP:${stamp(person.updated_at || now)}`, `SEQUENCE:${Number(person.version) || 0}`,
      time ? `DTSTART;TZID=America/New_York:${date}T${time}` : `DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${escape(person.name)} - ${track} exam`, `DESCRIPTION:${escape(`${track} licensing exam.${time ? ' Time is recorded in Eastern Time.' : ' Exam time has not been set.'}`)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
