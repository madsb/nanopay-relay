import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveAddress, derivePublicKey, deriveSecretKey } from 'nanocurrency';
import { NanoWallet } from '../src/wallet.js';

const SEED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const createTempStatePath = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nano-wallet-'));
  const statePath = join(dir, 'wallet-state.json');
  return {
    dir,
    statePath
  };
};

describe('NanoWallet', () => {
  it('derives deterministic invoices and persists state', async () => {
    const { dir, statePath } = await createTempStatePath();
    try {
      const indexStart = 7;
      const wallet = await NanoWallet.init({
        seed: SEED,
        statePath,
        indexStart
      });

      const invoice = await wallet.getOrCreateInvoice('job-1');
      const expected = deriveAddress(
        derivePublicKey(deriveSecretKey(SEED, indexStart)),
        { useNanoPrefix: true }
      );

      expect(invoice.index).toBe(indexStart);
      expect(invoice.address).toBe(expected);

      const sameInvoice = await wallet.getOrCreateInvoice('job-1');
      expect(sameInvoice.address).toBe(invoice.address);
      expect(sameInvoice.index).toBe(invoice.index);

      const reloaded = await NanoWallet.init({
        seed: SEED,
        statePath,
        indexStart
      });
      const loadedInvoice = reloaded.getInvoice('job-1');
      expect(loadedInvoice?.address).toBe(invoice.address);

      const invoice2 = await reloaded.getOrCreateInvoice('job-2');
      expect(invoice2.index).toBe(indexStart + 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tracks used payment hashes across jobs', async () => {
    const { dir, statePath } = await createTempStatePath();
    try {
      const wallet = await NanoWallet.init({
        seed: SEED,
        statePath,
        indexStart: 0
      });

      const hash = '  ABC123  ';
      await wallet.markPaymentHashUsed(hash, 'job-1');

      expect(wallet.isPaymentHashUsed(hash, 'job-1')).toBe(false);
      expect(wallet.isPaymentHashUsed(hash, 'job-2')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
