import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { mockClient } from 'aws-sdk-client-mock';
import { expect, it } from 'vitest';
import { sendEmail } from './send';

const ses = mockClient(SESv2Client);

it('sends a plain text email to one recipient', async () => {
  ses.on(SendEmailCommand).resolves({ MessageId: 'message-1' });

  await sendEmail(new SESv2Client({}), {
    from: 'arena@example.com',
    to: 'ada@example.com',
    subject: 'Hello',
    text: 'Body',
  });

  expect(ses.commandCalls(SendEmailCommand)[0]?.args[0].input).toEqual({
    FromEmailAddress: 'arena@example.com',
    Destination: { ToAddresses: ['ada@example.com'] },
    Content: {
      Simple: {
        Subject: { Data: 'Hello', Charset: 'UTF-8' },
        Body: { Text: { Data: 'Body', Charset: 'UTF-8' } },
      },
    },
  });
});
