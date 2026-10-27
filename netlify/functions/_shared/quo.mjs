export async function verifyQuoTransport({ apiKey, fromNumber, phoneNumberId, enabled = false, fetchImpl = fetch }) {
  const configured = Boolean(apiKey && fromNumber && phoneNumberId);
  if (!configured) return { provider: "Quo", configured: false, verified: false, enabled: false };

  try {
    const response = await fetchImpl("https://api.quo.com/v1/phone-numbers", {
      method: "GET",
      headers: { authorization: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { provider: "Quo", configured: true, verified: false, enabled: false };
    const payload = await response.json();
    const numbers = Array.isArray(payload?.data) ? payload.data : [];
    const verified = numbers.some((item) =>
      item?.id === phoneNumberId && (item?.number === fromNumber || item?.formattedNumber === fromNumber),
    );
    return { provider: "Quo", configured: true, verified, enabled: verified && enabled };
  } catch {
    return { provider: "Quo", configured: true, verified: false, enabled: false };
  }
}
