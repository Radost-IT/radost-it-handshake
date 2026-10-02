import { z } from 'zod';
import type { ConfigKeyName, RawConfig } from './keys';

export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

const nonEmpty = z.string().trim().min(1);
const positiveInteger = z.coerce.number().int().positive();

const rawConfigSchema = z.object({
  paypalClientId: nonEmpty,
  paypalClientSecret: nonEmpty,
  // Live PayPal is out of scope for this project, so anything but the sandbox is a config error.
  paypalBaseUrl: z.literal(PAYPAL_SANDBOX_BASE_URL),
  // Optional because the webhook can only be registered after the first deploy.
  paypalWebhookId: nonEmpty.optional(),
  channel3ApiKey: nonEmpty,
  bedrockRegion: nonEmpty,
  bedrockModelFast: nonEmpty,
  bedrockModelSmart: nonEmpty,
  dailyTokenBudget: positiveInteger,
  negotiationMaxTurns: positiveInteger,
} satisfies Record<ConfigKeyName, z.ZodType>);

export interface Config {
  paypal: {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    webhookId: string | undefined;
  };
  channel3: { apiKey: string };
  bedrock: { region: string; modelFast: string; modelSmart: string };
  limits: { dailyTokenBudget: number; negotiationMaxTurns: number };
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseConfig(raw: RawConfig, source: (key: ConfigKeyName) => string): Config {
  const result = rawConfigSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = issue.path[0] as ConfigKeyName;
      const reason = raw[key] === undefined ? 'missing' : 'invalid';
      return `${source(key)} is ${reason}`;
    });
    throw new ConfigError(`Invalid configuration: ${[...new Set(problems)].join('; ')}`);
  }

  const values = result.data;
  return {
    paypal: {
      clientId: values.paypalClientId,
      clientSecret: values.paypalClientSecret,
      baseUrl: values.paypalBaseUrl,
      webhookId: values.paypalWebhookId,
    },
    channel3: { apiKey: values.channel3ApiKey },
    bedrock: {
      region: values.bedrockRegion,
      modelFast: values.bedrockModelFast,
      modelSmart: values.bedrockModelSmart,
    },
    limits: {
      dailyTokenBudget: values.dailyTokenBudget,
      negotiationMaxTurns: values.negotiationMaxTurns,
    },
  };
}
