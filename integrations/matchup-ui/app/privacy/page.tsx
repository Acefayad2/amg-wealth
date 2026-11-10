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
        <p className="legal-updated">Effective September 2, 2026</p>

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
          <p>The portal requests limited Google Calendar access to read free/busy availability and create or manage events created by the portal. It does not read the content of unrelated calendar events. Access may be revoked at any time from the trainer dashboard or Google Account permissions.</p>
        </section>
        <section>
          <h2>Storage and security</h2>
          <p>Calendar credentials are encrypted and restricted to server-side services. We use reasonable administrative and technical safeguards, but no online service can guarantee absolute security.</p>
        </section>
        <section>
          <h2>Retention and choices</h2>
          <p>We retain appointment and profile data only as needed to provide the service and meet organizational or legal obligations. Trainers may disconnect Google Calendar at any time. Requests to access, correct, or delete information may be sent to the contact below.</p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>Questions about this policy or AMG Matchup Portal data practices may be sent to <a href="mailto:acefayad@gmail.com">acefayad@gmail.com</a>.</p>
        </section>
      </article>
    </main>
  );
}
