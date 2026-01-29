import { z } from 'zod';
import { LIMITS } from './limits';

export const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const rawAmountSchema = z.string().min(1).max(LIMITS.priceMax).regex(/^[0-9]+$/);

export const offerCreateSchema = z
  .object({
    title: z.string().min(1).max(LIMITS.titleMax),
    description: z.string().min(1).max(LIMITS.descriptionMax),
    tags: z.array(z.string().min(1).max(LIMITS.tagMax)).max(LIMITS.tagsMax).optional().default([]),
    pricing_mode: z.enum(['fixed', 'quote']),
    fixed_price_raw: rawAmountSchema.nullable().optional(),
    active: z.boolean().optional().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.pricing_mode === 'fixed') {
      if (!value.fixed_price_raw) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fixed_price_raw is required for fixed pricing' });
      }
    } else if (value.fixed_price_raw != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fixed_price_raw must be null for quote pricing' });
    }
  });

export const jobCreateSchema = z.object({
  offer_id: z.string().uuid(),
  request_payload: z.record(z.any())
});

export const quoteSchema = z.object({
  quote_amount_raw: rawAmountSchema,
  quote_invoice_address: z.string().min(1).max(LIMITS.invoiceMax),
  quote_expires_at: z.string().datetime().optional().nullable()
});

export const paymentSchema = z.object({
  payment_tx_hash: z.string().min(1).max(LIMITS.paymentHashMax)
});

export const deliverSchema = z
  .object({
    result_payload: z.record(z.any()).nullable(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        details: z.record(z.any()).nullable().optional()
      })
      .nullable()
  })
  .refine(
    (value) => (value.result_payload === null) !== (value.error === null),
    'Exactly one of result_payload or error must be non-null'
  );

export const cancelSchema = z.object({
  reason: z.string().optional().nullable()
});
