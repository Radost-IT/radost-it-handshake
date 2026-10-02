export interface ConfigKey {
  env: string;
  ssm: string;
  /** Required so every new key makes a choice; secrets are stored as SecureString. */
  secret: boolean;
}

export const configKeys = {
  paypalClientId: { env: 'PAYPAL_CLIENT_ID', ssm: 'paypal/client-id', secret: false },
  paypalClientSecret: { env: 'PAYPAL_CLIENT_SECRET', ssm: 'paypal/client-secret', secret: true },
  paypalBaseUrl: { env: 'PAYPAL_BASE_URL', ssm: 'paypal/base-url', secret: false },
  paypalWebhookId: { env: 'PAYPAL_WEBHOOK_ID', ssm: 'paypal/webhook-id', secret: false },
  paypalHonorPeriodHours: {
    env: 'PAYPAL_HONOR_PERIOD_HOURS',
    ssm: 'paypal/honor-period-hours',
    secret: false,
  },
  channel3ApiKey: { env: 'CHANNEL3_API_KEY', ssm: 'channel3/api-key', secret: true },
  bedrockRegion: { env: 'BEDROCK_REGION', ssm: 'bedrock/region', secret: false },
  bedrockModelFast: { env: 'BEDROCK_MODEL_FAST', ssm: 'bedrock/model-fast', secret: false },
  bedrockModelSmart: { env: 'BEDROCK_MODEL_SMART', ssm: 'bedrock/model-smart', secret: false },
  dailyTokenBudget: { env: 'DAILY_TOKEN_BUDGET', ssm: 'limits/daily-token-budget', secret: false },
  negotiationMaxTurns: {
    env: 'NEGOTIATION_MAX_TURNS',
    ssm: 'limits/negotiation-max-turns',
    secret: false,
  },
} as const satisfies Record<string, ConfigKey>;

export type ConfigKeyName = keyof typeof configKeys;

export type RawConfig = Partial<Record<ConfigKeyName, string>>;

export const configKeyNames = Object.keys(configKeys) as ConfigKeyName[];
