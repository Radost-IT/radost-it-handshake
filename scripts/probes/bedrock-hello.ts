import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { loadConfig } from '@handshake/config';

const config = await loadConfig();
const client = new BedrockRuntimeClient({ region: config.bedrock.region });

async function sayHello(label: string, modelId: string): Promise<boolean> {
  try {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        messages: [{ role: 'user', content: [{ text: 'Reply with the single word: ready' }] }],
        inferenceConfig: { maxTokens: 10 },
      }),
    );
    const reply = response.output?.message?.content?.[0]?.text ?? '';
    const tokens = response.usage?.totalTokens ?? 0;
    console.log(`Bedrock ${label} (${modelId}) OK: "${reply.trim()}", ${tokens} tokens`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Bedrock ${label} (${modelId}) failed: ${message}`);
    return false;
  }
}

const results = await Promise.all([
  sayHello('fast', config.bedrock.modelFast),
  sayHello('smart', config.bedrock.modelSmart),
]);
if (results.includes(false)) process.exit(1);
