import Image from "next/image";
import Link from "next/link";

export default function PrivacyPolicy() {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="legal-brand" href="/" aria-label="AMG Matchup Portal home">
          <Image src="/matchups/amg-logo.webp" alt="AMG" width={48} height={48} priority />
          <span><strong>AMG</strong> Matchup Portal</span>
        </Link>
        <Link className="legal-home-link" href="/">Back to portal</Link>
      </header>

      <article className="legal-card">
        <p className="legal-kicker">AMG MATCHUP PORTAL</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Updated November 10, 2026</p>

        <section>
          <h2>Information we collect</h2>
          <p>AMG Matchup Portal collects the agent and client contact information entered for an appointment, appointment preferences, and Certified Field Trainer profile and availability information. When a trainer connects Google Calendar, Google provides authorization tokens and calendar availability needed to operate the scheduling service.</p>
        </section>
        <section>
          <h2>How we use information</h2>
          <p>We use this information to match agents with trainers, check trainer availability, schedule appointments, create calendar events, and send appointment confirmations to the agent, client, and trainer. We do not sell personal information.</p>
        </section>
        <section>
          <h2>Google Calendar data</h2>
          <p>Connecting Google Calendar is optional. We use your Google account email to identify the connected calendar, check free/busy time ranges to avoid scheduling conflicts, and create or update AMG appointment events on your calendar. Google grants permission to manage events on calendars you own; AMG uses that permission for its appointment events. Our availability checks do not retrieve the titles, descriptions, or attendees of your unrelated events.</p>
          <p>AMG Matchup Portal’s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including its Limited Use requirements. We do not use Google user data for advertising, sell it, or use it to train generalized artificial intelligence models. Human access to Google user data is limited to the exceptions permitted by that policy, such as support with your affirmative consent or security and legal obligations.</p>
        </section>
        <section>
          <h2>When information is shared</h2>
          <p>AMG appointment details are shared with the agent, client, and trainer involved in that appointment. When calendar syncing is enabled, Google processes the appointment details needed to create the calendar event and invitations. Our hosting, authentication, database, and notification providers process information as needed to operate the portal. We do not share the contents of your unrelated calendar events with other agents or trainers.</p>
        </section>
        <section>
          <h2>Storage and security</h2>
          <p>Calendar credentials are encrypted and restricted to server-side services. We use reasonable administrative and technical safeguards, but no online service can guarantee absolute security.</p>
        </section>
        <section>
          <h2>Retention and choices</h2>
          <p>We retain appointment and profile data as needed to provide the service and meet organizational or legal obligations. Calendar authorization credentials are retained to support the connection until replaced or deleted at your request. You can revoke future Google access at any time from <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">your Google Account’s third-party connections</a>. Revoking access stops future Google API access; it does not automatically delete existing AMG appointment records or previously created Google Calendar events.</p>
          <p>To request access, correction, or deletion of your stored account information, calendar connection credentials, or appointment information, email <a href="mailto:acefayad@gmail.com">acefayad@gmail.com</a> from the address associated with your AMG account. We may verify your identity before processing the request. Tell us if your request specifically concerns Google Calendar data or authorization credentials. Records that must be retained for legal obligations may be kept for that purpose.</p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>Questions about this policy or AMG Matchup Portal data practices may be sent to <a href="mailto:acefayad@gmail.com">acefayad@gmail.com</a>.</p>
        </section>
      </article>
    </main>
  );
}
