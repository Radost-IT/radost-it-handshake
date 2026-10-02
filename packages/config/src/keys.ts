export interface ConfigKey {
  env: string;
  ssm: string;
}

export const configKeys = {
  paypalClientId: { env: 'PAYPAL_CLIENT_ID', ssm: 'paypal/client-id' },
  paypalClientSecret: { env: 'PAYPAL_CLIENT_SECRET', ssm: 'paypal/client-secret' },
  paypalBaseUrl: { env: 'PAYPAL_BASE_URL', ssm: 'paypal/base-url' },
  paypalWebhookId: { env: 'PAYPAL_WEBHOOK_ID', ssm: 'paypal/webhook-id' },
  channel3ApiKey: { env: 'CHANNEL3_API_KEY', ssm: 'channel3/api-key' },
  bedrockRegion: { env: 'BEDROCK_REGION', ssm: 'bedrock/region' },
  bedrockModelFast: { env: 'BEDROCK_MODEL_FAST', ssm: 'bedrock/model-fast' },
  bedrockModelSmart: { env: 'BEDROCK_MODEL_SMART', ssm: 'bedrock/model-smart' },
  dailyTokenBudget: { env: 'DAILY_TOKEN_BUDGET', ssm: 'limits/daily-token-budget' },
  negotiationMaxTurns: { env: 'NEGOTIATION_MAX_TURNS', ssm: 'limits/negotiation-max-turns' },
} as const satisfies Record<string, ConfigKey>;

export type ConfigKeyName = keyof typeof configKeys;

export type RawConfig = Partial<Record<ConfigKeyName, string>>;

export const configKeyNames = Object.keys(configKeys) as ConfigKeyName[];
