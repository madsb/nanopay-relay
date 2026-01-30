import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NanoWallet } from '../src/wallet.js';
import { PaymentVerifier } from '../src/payment-verifier.js';
import type { Job } from '../src/types.js';
import type { NanoBlockInfo } from '../src/nano-rpc.js';

const SEED = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const createTempWallet = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nano-verifier-'));
  const statePath = join(dir, 'wallet-state.json');
  const wallet = await NanoWallet.init({
    seed: SEED,
    statePath,
    indexStart: 1
  });
  return {
    dir,
    wallet
  };
};

const createJob = (overrides: Partial<Job> = {}): Job => ({
  job_id: 'job-1',
  status: 'accepted',
  request_payload: {},
  quote_amount_raw: '1000',
  quote_invoice_address: 'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
  quote_expires_at: null,
  payment_tx_hash: null,
  lock_owner: null,
  lock_expires_at: null,
  updated_at: new Date().toISOString(),
  ...overrides
});

const createBlockInfo = (overrides: Partial<NanoBlockInfo> = {}): NanoBlockInfo => ({
  hash: 'abc123',
  amountRaw: '1000',
  destination: 'nano_1111111111111111111111111111111111111111111111111111hifc8npp',
  confirmed: true,
  subtype: 'send',
  blockType: 'send',
  ...overrides
});

describe('PaymentVerifier', () => {
  it('verifies direct payment hashes and records usage', async () => {
    const { dir, wallet } = await createTempWallet();
    try {
      const job = createJob({ payment_tx_hash: 'ABC123' });
      const rpc = {
        getBlockInfo: vi.fn(async () => ({ ok: true, data: createBlockInfo() })),
        getReceivable: vi.fn(async () => ({ ok: true, data: [] }))
      };

      const verifier = new PaymentVerifier({
        wallet,
        rpc: rpc as any,
        minConfirmations: 1
      });

      const result = await verifier.verify(job);

      expect(result.verified).toBe(true);
      expect(rpc.getBlockInfo).toHaveBeenCalledWith('abc123');
      expect(wallet.isPaymentHashUsed('abc123', 'other-job')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns unconfirmed when block lacks confirmations', async () => {
    const { dir, wallet } = await createTempWallet();
    try {
      const job = createJob({ payment_tx_hash: 'hash-unconfirmed' });
      const rpc = {
        getBlockInfo: vi.fn(async () => ({
          ok: true,
          data: createBlockInfo({
            hash: 'hash-unconfirmed',
            confirmed: false
          })
        })),
        getReceivable: vi.fn(async () => ({ ok: true, data: [] }))
      };

      const verifier = new PaymentVerifier({
        wallet,
        rpc: rpc as any,
        minConfirmations: 1
      });

      const result = await verifier.verify(job);
      expect(result).toEqual({
        verified: false,
        reason: 'payment.unconfirmed',
        details: {
          tx_hash: 'hash-unconfirmed',
          destination: job.quote_invoice_address,
          amount_raw: '1000',
          confirmed: false
        }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to receivable blocks when direct hash is missing', async () => {
    const { dir, wallet } = await createTempWallet();
    try {
      const job = createJob({ payment_tx_hash: 'missing-hash' });
      const rpc = {
        getBlockInfo: vi.fn(async (hash: string) => {
          if (hash === 'missing-hash') {
            return { ok: false, error: 'Block not found' };
          }
          return { ok: true, data: createBlockInfo({ hash }) };
        }),
        getReceivable: vi.fn(async () => ({
          ok: true,
          data: [
            {
              hash: 'candidate-hash',
              amountRaw: '1500'
            }
          ]
        }))
      };

      const verifier = new PaymentVerifier({
        wallet,
        rpc: rpc as any,
        minConfirmations: 1
      });

      const result = await verifier.verify(job);

      expect(result.verified).toBe(true);
      expect(rpc.getReceivable).toHaveBeenCalledWith(job.quote_invoice_address);
      expect(rpc.getBlockInfo).toHaveBeenCalledWith('candidate-hash');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects reused hashes before calling the RPC', async () => {
    const { dir, wallet } = await createTempWallet();
    try {
      await wallet.markPaymentHashUsed('reuse-hash', 'other-job');
      const job = createJob({ payment_tx_hash: 'reuse-hash' });
      const rpc = {
        getBlockInfo: vi.fn(async () => ({ ok: true, data: createBlockInfo() })),
        getReceivable: vi.fn(async () => ({ ok: true, data: [] }))
      };

      const verifier = new PaymentVerifier({
        wallet,
        rpc: rpc as any,
        minConfirmations: 0
      });

      const result = await verifier.verify(job);
      expect(result).toEqual({ verified: false, reason: 'payment.hash_reused' });
      expect(rpc.getBlockInfo).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
