import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createDealApiClient } from './deal-api-client';
import { createHandshakeMcpServer } from './server';

// The MCP client (Claude Desktop, Claude Code) passes these to the process.
const environment = z
  .object({
    HANDSHAKE_API_KEY: z
      .string({ error: 'Set HANDSHAKE_API_KEY to a Deal API key' })
      .startsWith('hs_sandbox_', { error: 'HANDSHAKE_API_KEY must be a hs_sandbox_ key' }),
    HANDSHAKE_API_URL: z.url().default('https://api-handshake.radostit.com'),
  })
  .safeParse(process.env);

if (!environment.success) {
  // stdout carries the MCP protocol, so errors go to stderr.
  console.error(z.prettifyError(environment.error));
  process.exit(1);
}

const client = createDealApiClient({
  apiUrl: environment.data.HANDSHAKE_API_URL,
  apiKey: environment.data.HANDSHAKE_API_KEY,
});
await createHandshakeMcpServer(client).connect(new StdioServerTransport());
