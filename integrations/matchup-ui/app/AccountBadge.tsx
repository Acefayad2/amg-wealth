"use client";

export default function AccountBadge({ profile, onSignOut }: {
  profile: { name: string; email: string; initials: string } | null;
  onSignOut: () => void;
}) {
  if (!profile) return null;
  return <section className="account-badge" aria-label="Signed-in account">
    <div className="account-badge-identity"><span className="account-badge-avatar" aria-hidden="true">{profile.initials}</span><div><strong>{profile.name}</strong><span>{profile.email}</span></div></div>
    <button type="button" onClick={onSignOut}>Sign out</button>
  </section>;
}
