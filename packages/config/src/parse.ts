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
  if (!result.success) throw configErrorFromIssues(result.error, raw, source);

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

/**
 * Checks the values that are present and ignores missing keys, so a partial
 * config (for example while a third-party account is pending) can still be
 * stored. Throws `ConfigError` naming each invalid key, never its value.
 */
export function validatePresentConfigValues(
  raw: RawConfig,
  source: (key: ConfigKeyName) => string,
): void {
  const result = rawConfigSchema.partial().safeParse(raw);
  if (!result.success) throw configErrorFromIssues(result.error, raw, source);
}

function configErrorFromIssues(
  error: z.ZodError,
  raw: RawConfig,
  source: (key: ConfigKeyName) => string,
): ConfigError {
  const problems = error.issues.map((issue) => {
    const key = issue.path[0] as ConfigKeyName;
    const reason = raw[key] === undefined ? 'missing' : 'invalid';
    return `${source(key)} is ${reason}`;
  });
  return new ConfigError(`Invalid configuration: ${[...new Set(problems)].join('; ')}`);
}
