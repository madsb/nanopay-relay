import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkSeed, deriveAddress, derivePublicKey, deriveSecretKey } from 'nanocurrency';

type WalletInvoice = {
  address: string;
  index: number;
  created_at: string;
};

type WalletUsedPayment = {
  job_id: string;
  used_at: string;
};

type WalletState = {
  version: 1;
  next_account_index: number;
  job_invoices: Record<string, WalletInvoice>;
  address_jobs: Record<string, string>;
  used_payment_hashes: Record<string, WalletUsedPayment>;
};

const normalizeHash = (hash: string) => hash.trim().toLowerCase();

const createDefaultState = (indexStart: number): WalletState => ({
  version: 1,
  next_account_index: indexStart,
  job_invoices: {},
  address_jobs: {},
  used_payment_hashes: {}
});

const parseState = (raw: unknown, indexStart: number): WalletState => {
  const state = createDefaultState(indexStart);
  if (!raw || typeof raw !== 'object') {
    return state;
  }

  const candidate = raw as Partial<WalletState>;
  if (Number.isInteger(candidate.next_account_index)) {
    state.next_account_index = candidate.next_account_index as number;
  }
  if (candidate.job_invoices && typeof candidate.job_invoices === 'object') {
    state.job_invoices = candidate.job_invoices as Record<string, WalletInvoice>;
  }
  if (candidate.address_jobs && typeof candidate.address_jobs === 'object') {
    state.address_jobs = candidate.address_jobs as Record<string, string>;
  }
  if (candidate.used_payment_hashes && typeof candidate.used_payment_hashes === 'object') {
    state.used_payment_hashes = candidate.used_payment_hashes as Record<
      string,
      WalletUsedPayment
    >;
  }

  return state;
};

const loadState = async (path: string, indexStart: number): Promise<WalletState> => {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseState(parsed, indexStart);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return createDefaultState(indexStart);
    }
    throw error;
  }
};

const persistState = async (path: string, state: WalletState): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
};

export class NanoWallet {
  private seed: string;
  private statePath: string;
  private state: WalletState;

  private constructor(seed: string, statePath: string, state: WalletState) {
    this.seed = seed;
    this.statePath = statePath;
    this.state = state;
  }

  static async init(options: {
    seed: string;
    statePath: string;
    indexStart: number;
  }): Promise<NanoWallet> {
    if (!checkSeed(options.seed)) {
      throw new Error('NANO_SEED is not a valid Nano seed');
    }
    const state = await loadState(options.statePath, options.indexStart);
    return new NanoWallet(options.seed, options.statePath, state);
  }

  private deriveAddress(index: number): string {
    const secretKey = deriveSecretKey(this.seed, index);
    const publicKey = derivePublicKey(secretKey);
    return deriveAddress(publicKey, { useNanoPrefix: true });
  }

  getInvoice(jobId: string): WalletInvoice | null {
    return this.state.job_invoices[jobId] ?? null;
  }

  async getOrCreateInvoice(jobId: string): Promise<WalletInvoice> {
    const existing = this.getInvoice(jobId);
    if (existing) {
      return existing;
    }

    const index = this.state.next_account_index;
    this.state.next_account_index += 1;
    const address = this.deriveAddress(index);

    const invoice: WalletInvoice = {
      address,
      index,
      created_at: new Date().toISOString()
    };

    this.state.job_invoices[jobId] = invoice;
    this.state.address_jobs[address] = jobId;
    await persistState(this.statePath, this.state);

    return invoice;
  }

  isPaymentHashUsed(hash: string, jobId: string): boolean {
    const normalized = normalizeHash(hash);
    const entry = this.state.used_payment_hashes[normalized];
    if (!entry) return false;
    return entry.job_id !== jobId;
  }

  async markPaymentHashUsed(hash: string, jobId: string): Promise<void> {
    const normalized = normalizeHash(hash);
    this.state.used_payment_hashes[normalized] = {
      job_id: jobId,
      used_at: new Date().toISOString()
    };
    await persistState(this.statePath, this.state);
  }
}
