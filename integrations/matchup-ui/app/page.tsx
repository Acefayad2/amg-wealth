"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { appointmentDateKey, validateAnswer } from "@/lib/agent-flow";

type IconName =
  | "grid" | "calendar" | "users" | "clock" | "sparkles" | "chevron"
  | "search" | "bell" | "arrow" | "check" | "pin" | "briefcase"
  | "video" | "phone" | "plus" | "menu" | "close" | "shield" | "user" | "mail";

const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  calendar: <><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 15h.01M12 15h.01M16 15h.01"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  sparkles: <><path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3L12 3Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14ZM19 13l-.7 2.3L16 16l2.3.7L19 19l.7-2.3L22 16l-2.3-.7L19 13Z"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></>,
  video: <><path d="m16 13 5 3V8l-5 3"/><rect x="3" y="5" width="13" height="14" rx="2"/></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.1 19.3 19.3 0 0 1-6-6A19.7 19.7 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

type Trainer = {
  id: string;
  name: string;
  initials: string;
  location: string;
  years: number;
  specialties: string[];
  about: string;
  match: number;
  color: string;
  slots: string[];
};

const AMG_BACKEND_URL = "https://jkwhoisuhcbkokwntrfg.supabase.co/functions/v1/amg-matchup";

const clientBackgroundOptions = [
  "Young family / new parents",
  "Business owner / entrepreneur",
  "Retirement / legacy planning",
  "First-time life insurance buyer",
];

const appointmentFocusOptions = [
  "Mortgage protection review",
  "Income replacement planning",
  "Business succession planning",
  "Retirement and legacy review",
];

export function AgentPortal() {
  const [availableCftCount, setAvailableCftCount] = useState<number | null>(null);
  const [matching, setMatching] = useState(false);
  const [hasMatched, setHasMatched] = useState(false);
  const [background, setBackground] = useState("");
  const [appointmentType, setAppointmentType] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [agentPhone, setAgentPhone] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientDescription, setClientDescription] = useState("");
  const [agentSmsConsent, setAgentSmsConsent] = useState(false);
  const [clientSmsConsent, setClientSmsConsent] = useState(false);
  const [date, setDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [trainerOptions, setTrainerOptions] = useState<Trainer[]>([]);
  const [trainerOptionIndex, setTrainerOptionIndex] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [booked, setBooked] = useState(false);
  const [sendingBooking, setSendingBooking] = useState(false);
  const [bookingUncertain, setBookingUncertain] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [matchError, setMatchError] = useState("");
  const [smsStatus, setSmsStatus] = useState<"not_requested" | "consent_saved" | "unavailable" | "unchanged">("not_requested");
  const [emailStatus, setEmailStatus] = useState<"pending" | "sent" | "failed">("pending");
  const [step, setStep] = useState(0);
  const [editingReview, setEditingReview] = useState(false);
  const [stepError, setStepError] = useState("");
  const questionRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const previousViewRef = useRef({ step: 0, hasMatched: false });
  const matchBusyRef = useRef(false);
  const bookingBusyRef = useRef(false);
  const bookingIdRef = useRef("");

  useEffect(() => {
    setDate(appointmentDateKey(1));
    fetch(AMG_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stats" }),
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((result) => setAvailableCftCount(Number(result.availableToday) || 0))
      .catch(() => setAvailableCftCount(null));
  }, []);

  const displayDate = useMemo(() => {
    if (!date) return "";
    const parsed = new Date(`${date}T12:00:00`);
    return parsed.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }, [date]);

  const preferredTimeLabel = useMemo(() => {
    if (!preferredTime) return "";
    const [hourValue, minute] = preferredTime.split(":");
    const hour = Number(hourValue);
    return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
  }, [preferredTime]);

  const questions = [
    { key: "agentName", label: "Agent name", title: "First, what’s your name?", hint: "Let’s start with your contact details.", group: "Your details", value: agentName, setValue: setAgentName, type: "text", autoComplete: "section-agent name" },
    { key: "agentEmail", label: "Agent email", title: "Where should we email you?", hint: "Use the email address you check for appointment updates.", group: "Your details", value: agentEmail, setValue: setAgentEmail, type: "email", autoComplete: "section-agent email" },
    { key: "agentPhone", label: "Agent phone", title: "What’s your phone number?", hint: "Use a number where you can be reached about this appointment.", group: "Your details", value: agentPhone, setValue: setAgentPhone, type: "tel", autoComplete: "section-agent tel" },
    { key: "clientName", label: "Client name", title: "Who is the appointment for?", hint: "Enter your client’s full name.", group: "Your client", value: clientName, setValue: setClientName, type: "text", autoComplete: "off" },
    { key: "clientEmail", label: "Client email", title: "What’s your client’s email?", hint: "Double-check the address so appointment updates reach the right person.", group: "Your client", value: clientEmail, setValue: setClientEmail, type: "email", autoComplete: "off" },
    { key: "clientPhone", label: "Client phone", title: "What’s your client’s phone number?", hint: "Use the best number for appointment-related contact.", group: "Your client", value: clientPhone, setValue: setClientPhone, type: "tel", autoComplete: "off" },
    { key: "background", label: "Client background", title: "What best describes your client?", hint: "Choose the closest fit. You can add more context in a moment.", group: "Appointment needs", value: background, setValue: setBackground, options: clientBackgroundOptions },
    { key: "appointmentType", label: "Appointment focus", title: "What would they like help with?", hint: "Choose the main reason for the appointment.", group: "Appointment needs", value: appointmentType, setValue: setAppointmentType, options: appointmentFocusOptions },
    { key: "clientDescription", label: "Client details", title: "What should the trainer know?", hint: "Briefly describe their needs or questions. Do not include account numbers, medical details, or other sensitive information.", group: "Appointment needs", value: clientDescription, setValue: setClientDescription, type: "textarea" },
    { key: "date", label: "Preferred date", title: "What day works best?", hint: "We’ll check the trainers’ actual availability for this date.", group: "Date & time", value: date, setValue: setDate, type: "date" },
    { key: "preferredTime", label: "Preferred time", title: "What time do you prefer?", hint: "All appointment times are Eastern Time. We’ll show the closest available times next.", group: "Date & time", value: preferredTime, setValue: setPreferredTime, type: "time" },
  ];
  const reviewing = step === questions.length;
  const question = questions[step];
  const questionIcon: IconName = reviewing ? "check" : question.key.includes("Email") ? "mail" : question.key.includes("Phone") ? "phone" : question.key === "date" ? "calendar" : question.key === "preferredTime" ? "clock" : question.key.includes("Name") ? "user" : "users";

  useEffect(() => {
    const changed = previousViewRef.current.step !== step || previousViewRef.current.hasMatched !== hasMatched;
    const heading = hasMatched ? resultRef.current : questionRef.current;
    heading?.focus({ preventScroll: true });
    if (changed) document.getElementById(hasMatched ? "match-result" : "schedule")?.scrollIntoView({ block: "start", behavior: "instant" });
    previousViewRef.current = { step, hasMatched };
  }, [step, hasMatched]);

  useEffect(() => {
    if (booked) successRef.current?.focus();
  }, [booked]);

  function goToStep(next: number, editing = false) {
    setStep(next);
    setEditingReview(editing);
    setStepError("");
    setMatchError("");
  }

  function validateAll() {
    const invalidIndex = questions.findIndex((item) => validateAnswer(item.key, item.value, { date }));
    if (invalidIndex < 0) return true;
    setStep(invalidIndex);
    setEditingReview(true);
    setStepError(validateAnswer(questions[invalidIndex].key, questions[invalidIndex].value, { date }));
    return false;
  }

  async function handleStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matchBusyRef.current) return;
    if (reviewing) {
      if (validateAll()) await runMatch();
      return;
    }
    const error = validateAnswer(question.key, question.value, { date });
    if (error) { setStepError(error); return; }
    goToStep(editingReview ? questions.length : step + 1);
  }

  async function runMatch() {
    if (matchBusyRef.current) return;
    matchBusyRef.current = true;
    setMatching(true);
    setHasMatched(false);
    setMatchError("");
    setSelectedSlot("");
    bookingIdRef.current = "";

    try {
      const [response] = await Promise.all([
        fetch(AMG_BACKEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({ action: "match", date, preferredTime, background, focus: appointmentType, description: clientDescription }),
        }),
        new Promise((resolve) => window.setTimeout(resolve, 1800)),
      ]);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn’t search the AMG trainer network.");
      const candidates = Array.isArray(result.trainers) && result.trainers.length ? result.trainers : [result.trainer];
      const options = candidates.filter((trainer: Trainer | undefined): trainer is Trainer => Boolean(trainer?.id && Array.isArray(trainer.slots) && trainer.slots.length));
      if (!options.length) throw new Error("No CFT has an open time on that date. Please choose another date.");
      setTrainerOptions(options);
      setTrainerOptionIndex(0);
      setSelectedTrainer(options[0]);
      setMatching(false);
      setHasMatched(true);
      window.setTimeout(() => document.getElementById("match-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (error) {
      setMatching(false);
      setMatchError(error instanceof Error ? error.message : "We couldn’t search the AMG trainer network.");
    } finally {
      matchBusyRef.current = false;
    }
  }

  function chooseAnotherTrainer() {
    if (bookingBusyRef.current || bookingUncertain || trainerOptions.length < 2) return;
    const nextIndex = (trainerOptionIndex + 1) % trainerOptions.length;
    setTrainerOptionIndex(nextIndex);
    setSelectedTrainer(trainerOptions[nextIndex]);
    setSelectedSlot("");
    setBookingError("");
    bookingIdRef.current = "";
  }

  async function confirmBooking() {
    if (!selectedTrainer || !selectedSlot || bookingBusyRef.current) return;
    bookingBusyRef.current = true;
    setSendingBooking(true);
    setBookingError("");
    let definitiveRejection = false;

    try {
      if (!bookingIdRef.current) bookingIdRef.current = crypto.randomUUID();
      const response = await fetch(AMG_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          action: "book",
          bookingId: bookingIdRef.current,
          notificationConsent: { agent: agentSmsConsent, client: clientSmsConsent, version: "appointment-sms-v1" },
          agent: { name: agentName, email: agentEmail, phone: agentPhone },
          client: { name: clientName, email: clientEmail, phone: clientPhone },
          trainer: { id: selectedTrainer.id, name: selectedTrainer.name },
          appointment: { date, displayDate, time: selectedSlot, focus: appointmentType, background, description: clientDescription, format: "Video call" },
        }),
      });
      definitiveRejection = response.status >= 400 && response.status < 500;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn’t save the appointment.");
      if (result.ok !== true || !result.appointmentId) throw new Error("The appointment response was incomplete.");
      setEmailStatus(result.emailStatus === "sent" ? "sent" : result.emailStatus === "failed" ? "failed" : "pending");
      setSmsStatus(result.smsStatus === "consent_saved" || result.smsStatus === "unchanged" || result.smsStatus === "unavailable" ? result.smsStatus : agentSmsConsent || clientSmsConsent ? "unavailable" : "not_requested");
      setBookingUncertain(false);
      setBooked(true);
    } catch (error) {
      setBookingUncertain(!definitiveRejection);
      setBookingError(!definitiveRejection ? "We couldn’t confirm whether this request was saved. Check this same request again before changing its details. Retrying will not create a duplicate." : error instanceof Error ? error.message : "We couldn’t save the appointment request. Please try again.");
    } finally {
      bookingBusyRef.current = false;
      setSendingBooking(false);
    }
  }

  function closeBookingConfirmation() {
    setBooked(false);
    setBookingUncertain(false);
    // Keep the agent’s details for the next appointment, but clear client data.
    setClientName(""); setClientEmail(""); setClientPhone("");
    setClientDescription(""); setBackground(""); setAppointmentType(""); setClientSmsConsent(false);
    setDate(appointmentDateKey(1)); setPreferredTime("");
    goToStep(3);
    setHasMatched(false);
    setSelectedTrainer(null);
    setTrainerOptions([]);
    setSelectedSlot("");
    setBookingError("");
    bookingIdRef.current = "";
    window.setTimeout(() => document.getElementById("schedule")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="agent-match-page">
      <header className="agent-match-header" inert={booked || matching}>
        <div className="agent-match-brand"><span className="logo-wrap"><Image src="/matchups/amg-logo.webp" alt="AMG Wealth logo" width={44} height={44} priority unoptimized /></span><div><strong>AMG</strong><span>Matchup Portal</span></div></div>
        <div className="agent-header-actions">
          <span className="agent-header-note"><span className="live-dot" />{availableCftCount ?? "—"} CFTs available today</span>
          <a className="cft-login-button" href="/matchups/broker/">Broker dashboard</a>
          <a className="cft-login-button" href="/matchups/cft/">CFT login <Icon name="arrow" size={15} /></a>
        </div>
      </header>

      <main className="agent-match-main" inert={booked || matching}>
        <section className="agent-intro">
          <span className="eyebrow"><span />Agent matchup</span>
          <h1>Find the right trainer.</h1>
          <p>One question at a time. Tell us what your client needs, then choose an available Certified Field Trainer.</p>
          <span className="mobile-cft-count"><span className="live-dot" />{availableCftCount ?? "—"} CFTs available today</span>
        </section>

        {!hasMatched && <article className="match-card agent-form-card liquid-glass-card guided-card" id="schedule">
          <div className="match-glow" />
          <div className="guided-progress-copy"><span>{reviewing ? "Ready to review" : question.group}</span><span>{reviewing ? "All questions answered" : `Question ${step + 1} of ${questions.length}`}</span></div>
          <div className="guided-progress" role="progressbar" aria-label="Appointment questions completed" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={step}><span style={{ width: `${step / questions.length * 100}%` }} /></div>
          <div className="guided-heading"><span className="portal-stage-icon"><Icon name={questionIcon} size={23}/></span>
            <h2 ref={questionRef} tabIndex={-1}>{reviewing ? "Does everything look right?" : question.title}</h2>
            <p id="question-hint">{reviewing ? "Review your answers before searching. You’ll choose a trainer and time before sending an appointment request." : question.hint}</p>
          </div>
          <form className="match-form guided-form" onSubmit={handleStep} noValidate>
            {reviewing ? <div className="guided-review">
              {questions.map((item, index) => <div className="guided-review-row" key={item.key}><div><span>{item.label}</span><strong>{item.key === "date" ? displayDate : item.key === "preferredTime" ? `${preferredTimeLabel} Eastern Time` : item.value}</strong></div><button type="button" aria-label={`Edit ${item.label.toLowerCase()}`} onClick={() => goToStep(index, true)}>Edit</button></div>)}
            </div> : <div className="guided-answer" key={question.key}>
              {question.options ? <fieldset className="guided-options" aria-describedby="question-hint"><legend>{question.label}</legend>{question.options.map((option, optionIndex) => <label className={`guided-option ${question.value === option ? "selected" : ""}`} key={option}><input type="radio" name={question.key} value={option} checked={question.value === option} onChange={() => { question.setValue(option); setStepError(""); }} required /><span className="guided-option-icon"><Icon name={(["users","briefcase","clock","shield"] as IconName[])[optionIndex]} size={19}/></span><span className="guided-option-copy">{option}</span></label>)}</fieldset>
                : <label className="guided-input"><span id="question-label">{question.label}</span>{question.type === "textarea"
                  ? <><textarea name={question.key} value={question.value} onChange={(e) => { question.setValue(e.target.value); setStepError(""); }} rows={4} minLength={10} maxLength={1000} required aria-labelledby="question-label" aria-invalid={Boolean(stepError)} aria-describedby={`question-hint${stepError ? " step-error" : ""}`} /><small>{clientDescription.length}/1000 characters · At least 10 characters</small></>
                  : <input name={question.key} type={question.type} value={question.value} onChange={(e) => { question.setValue(e.target.value); setStepError(""); if (question.key === "agentPhone") setAgentSmsConsent(false); if (question.key === "clientPhone") setClientSmsConsent(false); }} autoComplete={question.autoComplete} min={question.type === "date" ? appointmentDateKey() : undefined} required aria-labelledby="question-label" aria-invalid={Boolean(stepError)} aria-describedby={`question-hint${stepError ? " step-error" : ""}`} />}</label>}
            </div>}
            {!reviewing && (question.key === "agentPhone" || question.key === "clientPhone") && <label className="guided-sms-consent"><input type="checkbox" checked={question.key === "agentPhone" ? agentSmsConsent : clientSmsConsent} onChange={(e) => question.key === "agentPhone" ? setAgentSmsConsent(e.target.checked) : setClientSmsConsent(e.target.checked)} /><span>{question.key === "agentPhone" ? "I agree to receive appointment confirmation and reminder texts from AMG at this number, when available." : "My client has agreed to receive appointment confirmation and reminder texts from AMG at this number, when available."}<small>Optional. Message & data rates may apply. Reply STOP to opt out. <a href="/matchups/privacy/" target="_blank" rel="noopener noreferrer">Privacy policy</a></small></span></label>}
            {reviewing && <p className="guided-consent-summary">Appointment texts, when available: you {agentSmsConsent ? "opted in" : "did not opt in"}; your client {clientSmsConsent ? "opted in with your confirmation" : "did not opt in"}. You can change this by editing either phone number.</p>}
            {stepError && <div className="booking-error match-form-error" id="step-error" role="alert">{stepError}</div>}
            {matchError && <div className="booking-error match-form-error" role="alert">{matchError}<button className="guided-error-action" type="button" onClick={() => goToStep(9, true)}>Choose another date</button></div>}
            <div className="guided-actions">
              {(step > 0 || editingReview) && <button className="guided-back" type="button" disabled={matching} onClick={() => goToStep(editingReview ? questions.length : step - 1)}>{editingReview ? "Back to review" : "Back"}</button>}
              <button className="match-button" type="submit" disabled={matching}>{matching ? <><span className="spinner" />Checking trainers…</> : <>{reviewing ? "Find my trainer" : editingReview ? "Save & review" : step === questions.length - 1 ? "Review answers" : "Continue"}<Icon name="arrow" size={17} /></>}</button>
            </div>
            {!reviewing && <p className="guided-reassurance">You can go back and change any answer.</p>}
          </form>
        </article>}

        {hasMatched && selectedTrainer && (
          <article className="result-card glass-light agent-result liquid-glass-result" id="match-result">
            <div className="result-top"><div><span className="eyebrow"><span />Recommended trainer{trainerOptions.length > 1 ? ` · ${trainerOptionIndex + 1} of ${trainerOptions.length}` : ""}</span><h2 ref={resultRef} tabIndex={-1}>Your best match</h2></div><span className="match-score"><Icon name="sparkles" size={15} />{selectedTrainer.match}% fit</span></div>
            <div className="trainer-detail">
              <div className={`avatar large ${selectedTrainer.color}`}>{selectedTrainer.initials}<span className="status-dot" /></div>
              <div className="trainer-copy"><div className="name-line"><h3>{selectedTrainer.name}</h3><span>CFT</span></div>{(selectedTrainer.location || selectedTrainer.years > 0) && <p className="meta">{selectedTrainer.location && <><Icon name="pin" size={14} />{selectedTrainer.location}</>}{selectedTrainer.location && selectedTrainer.years > 0 && <i />}{selectedTrainer.years > 0 && `${selectedTrainer.years} years in field`}</p>}<p className="bio">{selectedTrainer.about}</p>{selectedTrainer.specialties.length > 0 && <div className="tags">{selectedTrainer.specialties.map((item) => <span key={item}>{item}</span>)}</div>}</div>
            </div>
            <div className="availability-panel">
              <div><span className="available-label"><i />Available {displayDate}</span><p>Closest to {preferredTimeLabel} · Eastern Time</p></div>
              <div className="slot-grid">{selectedTrainer.slots.map((slot) => <button type="button" key={slot} className={selectedSlot === slot ? "selected" : ""} disabled={sendingBooking || bookingUncertain} onClick={() => { if (slot !== selectedSlot) bookingIdRef.current = ""; setSelectedSlot(slot); setBookingError(""); }}><span>{slot}</span>{selectedSlot === slot && <Icon name="check" size={14} />}</button>)}</div>
            </div>
            {bookingError && <div className="booking-error" role="alert">{bookingError}</div>}
            <div className="result-footer"><div className="result-secondary-actions"><button className="text-button" disabled={sendingBooking || bookingUncertain} onClick={() => { setHasMatched(false); setBookingError(""); goToStep(questions.length); }}>Change details</button>{trainerOptions.length > 1 && <button className="alternate-trainer-button" type="button" disabled={sendingBooking || bookingUncertain} onClick={chooseAnotherTrainer}><Icon name="users" size={16} />Choose another trainer</button>}</div><button className="confirm-button" disabled={!selectedSlot || sendingBooking} onClick={confirmBooking}>{sendingBooking ? <><span className="spinner light" />Sending request…</> : <>{bookingUncertain ? "Check request again" : "Request appointment"}<Icon name="arrow" size={16} /></>}</button></div>
          </article>
        )}

        <p className="agent-privacy"><Icon name="shield" size={16} />Client information is used only to arrange this trainer appointment.</p>
        <PortalFooter showNote={false}/>
      </main>

      {matching && <div className="trainer-search-overlay" role="status" aria-live="polite" aria-label="Searching for the right trainer"><div className="search-liquid-orb orb-one" /><div className="search-liquid-orb orb-two" /><div className="trainer-search-panel"><div className="search-mark"><Icon name="sparkles" size={26} /></div><span className="eyebrow"><span />Live trainer search</span><h2>Searching for the right trainer</h2><p>We’re comparing your client’s needs with trainer experience and open appointment times.</p><div className="searching-cards" aria-hidden="true"><div className="searching-card card-one"><Icon name="users" size={19} /><span><strong>Client fit</strong><small>Understanding their needs</small></span><Icon name="check" size={17} /></div><div className="searching-card card-two"><Icon name="sparkles" size={19} /><span><strong>Specialty match</strong><small>Comparing CFT experience</small></span><span className="searching-dot" /></div><div className="searching-card card-three"><Icon name="calendar" size={19} /><span><strong>Availability</strong><small>Checking open time slots</small></span><span className="searching-dot delayed" /></div></div><div className="search-progress"><span /></div><small className="search-wait">This usually takes just a few seconds.</small></div></div>}

      {booked && selectedTrainer && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="success-title"><div className="success-modal glass-light" ref={successRef} tabIndex={-1} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); closeBookingConfirmation(); }
        if (event.key === "Tab") {
          const buttons = successRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!buttons?.length) return;
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === successRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}><button className="modal-close" onClick={closeBookingConfirmation} aria-label="Close"><Icon name="close" /></button><div className="success-icon"><Icon name="check" size={28} /></div><span className="eyebrow"><span />Request sent</span><h2 id="success-title">Your appointment request is saved.</h2><p>{selectedTrainer.name} received the request for <strong>{displayDate} at {selectedSlot}</strong> and can respond in the CFT workspace. The appointment is pending until the trainer confirms.</p><div className={`email-delivery-note ${emailStatus}`}><Icon name={emailStatus === "sent" ? "check" : "clock"} size={16} />{emailStatus === "sent" ? "Appointment request emails were sent." : emailStatus === "failed" ? "The request was saved, but one or more notification emails could not be delivered." : "Email delivery is pending. The request is safely stored in the CFT workspace."}</div>{smsStatus !== "not_requested" && <div className={`email-delivery-note ${smsStatus === "unavailable" ? "failed" : "pending"}`}><Icon name="clock" size={16} />{smsStatus === "consent_saved" ? "Text preferences saved. Confirmation and reminder delivery depends on AMG’s messaging setup." : smsStatus === "unchanged" ? "Existing text preferences were kept for this request. Text delivery has not been confirmed." : "Text preferences could not be confirmed. Your appointment request is saved, but text delivery is not available for this request."}</div>}<div className="modal-summary"><span className={`avatar ${selectedTrainer.color}`}>{selectedTrainer.initials}</span><div><strong>{selectedTrainer.name}</strong><small>Certified Field Trainer · Video call</small></div></div><button className="confirm-button full" onClick={closeBookingConfirmation}>Start another appointment <Icon name="check" size={16} /></button></div></div>}
    </div>
  );
}

function PortalFooter({showNote=true}: {showNote?:boolean}) {
  return <footer className="portal-flow-footer">{showNote && <p>Client information is used only to arrange this trainer appointment.</p>}<nav aria-label="Portal links"><a href="/matchups/cft/">CFT / MD workspace</a><a href="/matchups/broker/">Broker dashboard</a></nav><nav aria-label="Legal"><a href="/matchups/privacy/">Privacy</a><a href="/matchups/terms/">Terms</a></nav></footer>;
}

export default function HomePage() {
  const [role,setRole] = useState<"agent"|"cft">("agent");
  const [count,setCount] = useState<number|null>(null);
  useEffect(() => { let active=true; fetch(AMG_BACKEND_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"stats"})}).then(r=>r.ok?r.json():null).then(r=>{if(active && typeof r?.availableToday === "number") setCount(r.availableToday);}).catch(()=>{}); return ()=>{active=false;}; },[]);
  return <div className="agent-match-page"><header className="agent-match-header"><a className="agent-match-brand" href="/matchups/" style={{textDecoration:"none"}}><span className="logo-wrap"><Image src="/matchups/amg-logo.webp" alt="" width={44} height={44} priority unoptimized/></span><div><strong>AMG</strong><span>Matchup</span></div></a><span className="agent-header-note"><span className="live-dot"/>{count ?? "—"} CFTs available today</span></header><main className="agent-match-main"><section className="portal-welcome-card"><Image className="portal-welcome-mark" src="/matchups/amg-logo.webp" alt="AMG" width={74} height={74} priority unoptimized/><p className="eyebrow">AMG MATCHUP PORTAL</p><h1>Are you an Agent<br/>or a CFT / MD?</h1><p>Choose one to get started. We’ll walk you through it one question at a time.</p><div className="portal-role-choices"><button type="button" aria-pressed={role==="agent"} onClick={()=>setRole("agent")}><span className="portal-role-icon"><Icon name="briefcase" size={21}/></span><strong>Agent</strong><small>Book a field trainer for a client appointment</small></button><button type="button" aria-pressed={role==="cft"} onClick={()=>setRole("cft")}><span className="portal-role-icon"><Icon name="shield" size={21}/></span><strong>CFT / MD</strong><small>Manage your availability and appointment requests</small></button></div><a className="portal-continue" href={role==="agent"?"/matchups/agent/":"/matchups/cft/"}>Continue <Icon name="arrow" size={17}/></a></section><p className="portal-google-summary">AMG Matchup connects agents with Certified Field Trainers for client appointments. Trainers can optionally connect Google Calendar to check busy times and sync AMG appointments.</p><PortalFooter/></main></div>;
}
