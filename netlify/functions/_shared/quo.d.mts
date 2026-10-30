export interface QuoTransportOptions {
  apiKey?: string;
  fromNumber?: string;
  phoneNumberId?: string;
  enabled?: boolean;
  fetchImpl?: typeof fetch;
}

export interface QuoTransportStatus {
  provider: "Quo";
  configured: boolean;
  verified: boolean;
  enabled: boolean;
}

export function verifyQuoTransport(options: QuoTransportOptions): Promise<QuoTransportStatus>;
