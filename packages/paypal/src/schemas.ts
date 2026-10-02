import { moneySchema, type Money } from '@handshake/core';
import type { Money as SdkMoney } from '@paypal/paypal-server-sdk';
import { z } from 'zod';

export function toPayPalMoney(amount: Money): SdkMoney {
  return { currencyCode: amount.currency, value: amount.value };
}

const paypalMoneySchema = z
  .object({ currencyCode: z.string(), value: z.string() })
  .transform(({ currencyCode, value }) => ({ currency: currencyCode, value }))
  .pipe(moneySchema);

export const orderStatusSchema = z.enum([
  'CREATED',
  'SAVED',
  'APPROVED',
  'VOIDED',
  'COMPLETED',
  'PAYER_ACTION_REQUIRED',
]);
export type PayPalOrderStatus = z.infer<typeof orderStatusSchema>;

export const authorizationStatusSchema = z.enum([
  'CREATED',
  'CAPTURED',
  'DENIED',
  'PARTIALLY_CAPTURED',
  'VOIDED',
  'PENDING',
]);
export type PayPalAuthorizationStatus = z.infer<typeof authorizationStatusSchema>;

export const captureStatusSchema = z.enum([
  'COMPLETED',
  'DECLINED',
  'PARTIALLY_REFUNDED',
  'PENDING',
  'REFUNDED',
  'FAILED',
]);
export type PayPalCaptureStatus = z.infer<typeof captureStatusSchema>;

export const authorizationSchema = z
  .object({
    id: z.string(),
    status: authorizationStatusSchema,
    amount: paypalMoneySchema,
    createTime: z.string(),
    expirationTime: z.string(),
  })
  .transform(({ id, status, amount, createTime, expirationTime }) => ({
    id,
    status,
    amount,
    createdAt: createTime,
    expiresAt: expirationTime,
  }));
export type PayPalAuthorization = z.infer<typeof authorizationSchema>;

export const captureSchema = z.object({
  id: z.string(),
  status: captureStatusSchema,
  amount: paypalMoneySchema,
});
export type PayPalCapture = z.infer<typeof captureSchema>;

export const linkSchema = z.object({ rel: z.string(), href: z.string() });
