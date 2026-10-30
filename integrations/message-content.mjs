const GREETING = /^(Good (?:morning|afternoon|evening)|Hello|Hi),?\s*([^!\n]{1,80})!/iu;
const OPT_OUT_NOTICE = "Reply STOP to opt out.";

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
  if (!noticeRequired || /reply\s+stop\s+to\s+opt\s*out\.?/iu.test(content)) return content;
  return `${content}\n\n${OPT_OUT_NOTICE}`;
}

export function outboundContent(body, fullName, noticeRequired, maxCharacters = 1600) {
  const content = withFirstContactOptOut(personalizeOutbound(body, fullName), noticeRequired);
  if ([...content].length > maxCharacters) {
    throw new Error(`Personalized message exceeds ${maxCharacters} characters.`);
  }
  return content;
}
