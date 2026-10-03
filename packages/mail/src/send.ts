import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';

export interface Email {
  subject: string;
  text: string;
}

export async function sendEmail(
  client: SESv2Client,
  message: Email & { from: string; to: string },
): Promise<void> {
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: message.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}
