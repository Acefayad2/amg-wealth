export type ConversationMessage = {
  id: string;
  text: string;
  direction: "incoming" | "outgoing";
  status: string;
  created_at: string;
  has_media: boolean;
};
export function listContactMessages(options: {
  apiKey?: string;
  fromNumber?: string;
  phoneNumberId?: string;
  participant: string;
  pageToken?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ messages: ConversationMessage[]; next_page_token: string | null; loaded_at: string }>;
