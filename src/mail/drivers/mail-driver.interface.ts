export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailDriver {
  send(message: MailMessage): Promise<void>;
}
