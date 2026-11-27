# AMG Events

The main-site listing is served at `https://anointedmoneygroup.com/events` from `events.html`. It uses the existing AMG resource-page styles and shared top bar, with page-specific layout in `assets/amg-events.css`.

The November 27, 2026 release includes the January 14–17, 2027 Kickoff / Big Event in San Diego. Source dates and outbound ticket/hotel links were verified against the existing Agent Portal and the organizers' rendered sites. The expired October 24, 2026 Fast Start School is not included. No DNS or GoHighLevel pages are changed; the separate Agent Portal remains at its existing address.

To maintain the listing, edit the event article in `events.html`, its date, description, ticket/hotel links and `data-event-end`. The end timestamp is exclusive and includes the event's timezone: the existing San Diego event ends after January 17, so expiry is January 18 at 08:00 UTC. Do not infer a replacement event date from an old flyer.

`assets/amg-events.mjs` removes expired or invalid-dated articles on page load, on return to the tab, and once per minute, and shows an empty state when none remain. This is browser enhancement; the static source should also be kept current for clients without JavaScript and for crawlers. There is no event-admin database, new subscription, automated email, or registration checkout on AMG: ticket purchases and rooms stay with the existing external event organizers.

Validation: `npm test`, `npm run check`, `npm run build`; real browser checks at 1440 and 390 widths, mobile-menu/Escape behavior, both registration destinations, and a simulated January 18 visit that shows the empty state. Existing booking and course functions remain unchanged.
