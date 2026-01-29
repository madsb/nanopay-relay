import type { Job } from './types.js';
import { NanoRpcClient, type NanoBlockInfo } from './nano-rpc.js';
import { NanoWallet } from './wallet.js';

type VerificationDetails = {
  tx_hash: string;
  amount_raw: string;
  destination: string | null;
  confirmed: boolean | null;
};

type VerificationResult =
  | {
      verified: true;
      details: VerificationDetails;
    }
  | {
      verified: false;
      reason: string;
      details?: Partial<VerificationDetails> & { error?: string };
    };

const normalizeHash = (hash: string) => hash.trim().toLowerCase();

const parseAmount = (value: string) => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};

const isSendBlock = (info: NanoBlockInfo) =>
  info.subtype === 'send' || info.blockType === 'send';

const isConfirmed = (info: NanoBlockInfo, minConfirmations: number) => {
  if (minConfirmations <= 0) return true;
  return info.confirmed === true;
};

const isNotFoundError = (message: string) =>
  message.toLowerCase().includes('not found') || message.toLowerCase().includes('missing');

const validateBlockForJob = (
  info: NanoBlockInfo,
  job: Job,
  minConfirmations: number
): VerificationResult => {
  if (!isSendBlock(info)) {
    return { verified: false, reason: 'payment.not_send' };
  }
  if (!job.quote_amount_raw || !job.quote_invoice_address) {
    return { verified: false, reason: 'payment.missing_quote' };
  }

  if (!info.destination || info.destination !== job.quote_invoice_address) {
    return {
      verified: false,
      reason: 'payment.address_mismatch',
      details: {
        tx_hash: info.hash,
        destination: info.destination
      }
    };
  }

  const quoted = parseAmount(job.quote_amount_raw);
  const paid = parseAmount(info.amountRaw);
  if (!quoted || !paid) {
    return { verified: false, reason: 'payment.amount_invalid' };
  }
  if (paid < quoted) {
    return {
      verified: false,
      reason: 'payment.amount_mismatch',
      details: {
        tx_hash: info.hash,
        amount_raw: info.amountRaw,
        destination: info.destination
      }
    };
  }

  if (!isConfirmed(info, minConfirmations)) {
    return {
      verified: false,
      reason: 'payment.unconfirmed',
      details: {
        tx_hash: info.hash,
        destination: info.destination,
        amount_raw: info.amountRaw,
        confirmed: info.confirmed
      }
    };
  }

  return {
    verified: true,
    details: {
      tx_hash: info.hash,
      amount_raw: info.amountRaw,
      destination: info.destination,
      confirmed: info.confirmed
    }
  };
};

export class PaymentVerifier {
  private wallet: NanoWallet;
  private rpc: NanoRpcClient;
  private minConfirmations: number;

  constructor(options: {
    wallet: NanoWallet;
    rpc: NanoRpcClient;
    minConfirmations: number;
  }) {
    this.wallet = options.wallet;
    this.rpc = options.rpc;
    this.minConfirmations = options.minConfirmations;
  }

  private async verifyHash(job: Job, hash: string): Promise<VerificationResult> {
    const normalized = normalizeHash(hash);
    if (this.wallet.isPaymentHashUsed(normalized, job.job_id)) {
      return { verified: false, reason: 'payment.hash_reused' };
    }

    const blockInfo = await this.rpc.getBlockInfo(normalized);
    if (!blockInfo.ok) {
      if (isNotFoundError(blockInfo.error)) {
        return { verified: false, reason: 'payment.not_found' };
      }
      return {
        verified: false,
        reason: 'wallet.rpc_unavailable',
        details: { error: blockInfo.error }
      };
    }

    const validation = validateBlockForJob(blockInfo.data, job, this.minConfirmations);
    if (validation.verified) {
      await this.wallet.markPaymentHashUsed(normalized, job.job_id);
    }
    return validation;
  }

  async verify(job: Job): Promise<VerificationResult> {
    if (!job.quote_invoice_address || !job.quote_amount_raw) {
      return { verified: false, reason: 'payment.missing_quote' };
    }

    if (job.payment_tx_hash) {
      const directResult = await this.verifyHash(job, job.payment_tx_hash);
      if (directResult.verified || directResult.reason !== 'payment.not_found') {
        return directResult;
      }
    }

    const receivable = await this.rpc.getReceivable(job.quote_invoice_address);
    if (!receivable.ok) {
      return {
        verified: false,
        reason: 'wallet.rpc_unavailable',
        details: { error: receivable.error }
      };
    }

    const quoteAmount = parseAmount(job.quote_amount_raw);
    if (!quoteAmount) {
      return { verified: false, reason: 'payment.amount_invalid' };
    }

    const candidates = receivable.data
      .filter((entry) => {
        const amount = parseAmount(entry.amountRaw);
        return amount !== null && amount >= quoteAmount;
      })
      .sort((a, b) => {
        const amountA = parseAmount(a.amountRaw) ?? 0n;
        const amountB = parseAmount(b.amountRaw) ?? 0n;
        if (amountA === amountB) return 0;
        return amountA > amountB ? -1 : 1;
      });

    let sawUnconfirmed = false;

    for (const candidate of candidates) {
      const result = await this.verifyHash(job, candidate.hash);
      if (result.verified) return result;
      if (result.reason === 'payment.unconfirmed') {
        sawUnconfirmed = true;
        continue;
      }
      if (result.reason === 'payment.hash_reused') {
        continue;
      }
      if (result.reason === 'wallet.rpc_unavailable') {
        return result;
      }
    }

    if (sawUnconfirmed) {
      return { verified: false, reason: 'payment.unconfirmed' };
    }

    return { verified: false, reason: 'payment.not_found' };
  }
}
