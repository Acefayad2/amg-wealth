// Event end times include the event's local timezone. Midnight after the final
// San Diego day is 08:00 UTC, so the listing stays visible through January 17.
export function eventHasNotEnded(end, now = new Date()) {
  const deadline = Date.parse(end);
  return Number.isFinite(deadline) && now.getTime() < deadline;
}

export function refreshEvents(root, now = new Date()) {
  for (const event of root.querySelectorAll('[data-event-end]')) {
    if (!eventHasNotEnded(event.dataset.eventEnd, now)) event.remove();
  }
  const hasEvents = Boolean(root.querySelector('[data-event-end]'));
  root.querySelector('[data-events-list]').hidden = !hasEvents;
  root.querySelector('[data-events-empty]').hidden = hasEvents;
}

if (typeof document !== 'undefined') {
  refreshEvents(document);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshEvents(document);
  });
  window.setInterval(() => refreshEvents(document), 60_000);
}
