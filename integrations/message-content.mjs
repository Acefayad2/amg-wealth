const GREETING = /^(Good (?:morning|afternoon|evening)|Hello|Hi),?\s*([^!\n]{1,80})!/iu;
const OPT_OUT_NOTICE = "Reply STOP to opt out.";
export const FIRST_CONTACT_IDENTITY = "This is Anointed Money Group's communications number. You can reply here to reach our team.";

export function isOptOutKeyword(value) {
  return /^(?:STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/iu.test(String(value ?? "").trim());
}

export function personalizeOutbound(body, fullName) {
  const content = String(body ?? "").trim();
  const name = String(fullName ?? "").trim();
  const firstName = name ? name.split(/\s+/u)[0] : "";
  const greeting = content.match(GREETING);

  if (greeting) {
    if (firstName && greeting[2].trim().toLocaleUpperCase("en-US") === "AMG") {
      return `${greeting[1]}, ${firstName}!${content.slice(greeting[0].length)}`;
    }
    return content;
  }
  return `${firstName ? `Hi ${firstName},` : "Hello,"}\n\n${content}`;
}

export function withFirstContactOptOut(body, noticeRequired) {
  const content = String(body ?? "").trim();
  if (!noticeRequired) return content;
  const parts = [content];
  if (!/this is anointed money group[’']s communications number\.?/iu.test(content)) {
    parts.push(FIRST_CONTACT_IDENTITY);
  } else if (!/you can reply here to reach our team\.?/iu.test(content)) {
    parts.push("You can reply here to reach our team.");
  }
  if (!/reply\s+stop\s+to\s+(?:opt\s*out|unsubscribe)\.?/iu.test(content)) parts.push(OPT_OUT_NOTICE);
  return parts.join("\n\n");
}

export function outboundContent(body, fullName, noticeRequired, personalizeName = false, maxCharacters = 1600) {
  const base = personalizeName ? personalizeOutbound(body, fullName) : String(body ?? "").trim();
  const content = withFirstContactOptOut(base, noticeRequired);
  if ([...content].length > maxCharacters) {
    throw new Error(`Message exceeds ${maxCharacters} characters.`);
  }
  return content;
}
