import Image from "next/image";
import Link from "next/link";

export default function TermsOfService() {
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
        <h1>Terms of Service</h1>
        <p className="legal-updated">Effective September 2, 2026</p>

        <section>
          <h2>Using the portal</h2>
          <p>AMG Matchup Portal helps authorized agents find Certified Field Trainers and coordinate client appointments. You agree to provide accurate information, use the portal only for legitimate AMG business, and protect client information from unauthorized access.</p>
        </section>
        <section>
          <h2>Accounts and calendar access</h2>
          <p>CFT accounts are for the individual trainer who created them. Trainers are responsible for activity under their account and may connect a Google Calendar to provide availability and receive appointment events. Calendar access may be disconnected at any time.</p>
        </section>
        <section>
          <h2>Appointments</h2>
          <p>Matches and availability are provided to assist scheduling. A displayed match or open time is not a guarantee that an appointment will occur. Participants remain responsible for confirming details and complying with applicable agency policies and laws.</p>
        </section>
        <section>
          <h2>Acceptable use</h2>
          <p>You may not misuse the portal, attempt unauthorized access, upload malicious content, interfere with the service, or use personal information for purposes unrelated to the scheduled appointment.</p>
        </section>
        <section>
          <h2>Service availability</h2>
          <p>The portal may be updated, suspended, or discontinued as operational needs change. The service is provided on an “as available” basis to the extent permitted by law.</p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>Questions about these terms may be sent to <a href="mailto:acefayad@gmail.com">acefayad@gmail.com</a>.</p>
        </section>
      </article>
    </main>
  );
}
