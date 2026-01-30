import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const berryMocks = vi.hoisted(() => {
  class MockWallet {
    static lastArgs: Array<{ seed?: string; rpcUrl?: string }> = [];

    static rawToNano(raw: string) {
      return `nano:${raw}`;
    }

    static nanoToRaw(nano: string) {
      return `raw:${nano}`;
    }

    seed: string;
    rpcUrl?: string;

    constructor({ seed, rpcUrl }: { seed?: string; rpcUrl?: string } = {}) {
      this.seed = seed ?? 'generated-seed';
      this.rpcUrl = rpcUrl;
      MockWallet.lastArgs.push({ seed, rpcUrl });
    }

    getSeed() {
      return this.seed;
    }

    getAddress(index = 0) {
      return `nano_addr_${index}`;
    }

    async getBalance(_index = 0) {
      return { balance: '100', pending: '25' };
    }

    async receivePending(_index = 0) {
      return [
        { hash: 'hash-1', amount: '10' },
        { hash: 'hash-2', amount: '15' }
      ];
    }

    async send(address: string, amount: string, index = 0) {
      return { hash: `tx_${address}_${amount}_${index}` };
    }
  }

  return {
    MockWallet,
    mockCreateProcessor: vi.fn((opts: unknown) => ({
      ...((opts as Record<string, unknown>) ?? {}),
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      createCharge: vi.fn(),
      checkChargeStatus: vi.fn(),
      getCharge: vi.fn()
    })),
    mockGetSeed: vi.fn(),
    mockSaveSeed: vi.fn(),
    mockGetRpcUrl: vi.fn(() => 'http://mock-rpc'),
    mockGetWsUrl: vi.fn(() => 'ws://mock-ws'),
    mockGetConfigPath: vi.fn(() => '/tmp/mock-berrypay/config.json')
  };
});

const qrMocks = vi.hoisted(() => ({
  toFile: vi.fn(async () => undefined)
}));

vi.mock('berrypay', () => ({
  BerryPayWallet: berryMocks.MockWallet,
  createProcessor: berryMocks.mockCreateProcessor,
  getConfigPath: berryMocks.mockGetConfigPath,
  getRpcUrl: berryMocks.mockGetRpcUrl,
  getSeed: berryMocks.mockGetSeed,
  getWsUrl: berryMocks.mockGetWsUrl,
  saveSeed: berryMocks.mockSaveSeed
}));

vi.mock('qrcode', () => ({
  default: {
    toFile: qrMocks.toFile
  }
}));

const berrypay = await import('../../../skills/nanobazaar-relay-seller/scripts/berrypay.mjs');

const {
  createCharge,
  createPaymentProcessor,
  ensureWallet,
  getBalanceSummary,
  getChargeStatus,
  getChargeMapping,
  readChargeMap,
  receivePending,
  removeChargeMapping,
  sendRaw,
  setChargeMapping,
  startChargeListener,
  stopChargeListener,
  writeChargeMap,
  rawToNano,
  nanoToRaw
} = berrypay;

const createTempMapPath = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'berrypay-map-'));
  const mapPath = join(dir, 'charge-map.json');
  return { dir, mapPath };
};

beforeEach(() => {
  berryMocks.mockGetSeed.mockReset();
  berryMocks.mockSaveSeed.mockReset();
  berryMocks.mockCreateProcessor.mockClear();
  berryMocks.mockGetRpcUrl.mockClear();
  berryMocks.mockGetWsUrl.mockClear();
  berryMocks.mockGetConfigPath.mockClear();
  berryMocks.MockWallet.lastArgs = [];
  qrMocks.toFile.mockClear();
});

describe('BerryPay helper module', () => {
  it('reads and writes charge maps', async () => {
    const { dir, mapPath } = await createTempMapPath();
    try {
      const empty = await readChargeMap(mapPath);
      expect(empty).toEqual({});

      await writeChargeMap({ job1: 'charge1' }, mapPath);
      const updated = await readChargeMap(mapPath);
      expect(updated).toEqual({ job1: 'charge1' });

      await setChargeMapping('job2', 'charge2', mapPath);
      expect(await getChargeMapping('job2', mapPath)).toBe('charge2');

      await removeChargeMapping('job1', mapPath);
      const finalMap = await readChargeMap(mapPath);
      expect(finalMap).toEqual({ job2: 'charge2' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('initializes wallets and persists seeds when missing', () => {
    berryMocks.mockGetSeed.mockReturnValue(undefined);
    const result = ensureWallet();

    expect(result.created).toBe(true);
    expect(result.address).toBe('nano_addr_0');
    expect(result.configPath).toBe('/tmp/mock-berrypay/config.json');
    expect(berryMocks.mockSaveSeed).toHaveBeenCalledWith('generated-seed');
    expect(berryMocks.MockWallet.lastArgs).toEqual([
      { seed: undefined, rpcUrl: 'http://mock-rpc' }
    ]);
  });

  it('uses existing seeds when available', () => {
    berryMocks.mockGetSeed.mockReturnValue('existing-seed');
    const result = ensureWallet();

    expect(result.created).toBe(false);
    expect(result.address).toBe('nano_addr_0');
    expect(berryMocks.mockSaveSeed).not.toHaveBeenCalled();
    expect(berryMocks.MockWallet.lastArgs).toEqual([
      { seed: 'existing-seed', rpcUrl: 'http://mock-rpc' }
    ]);
  });

  it('creates payment processors with defaults and overrides', () => {
    berryMocks.mockGetSeed.mockReturnValue('existing-seed');
    const processor = createPaymentProcessor();
    expect(berryMocks.mockCreateProcessor).toHaveBeenCalledWith({
      wallet: processor.wallet,
      wsUrl: 'ws://mock-ws',
      persistPath: undefined,
      autoSweep: undefined,
      mainAccountIndex: undefined,
      startingIndex: undefined
    });

    const customWallet = { custom: true };
    createPaymentProcessor({
      wallet: customWallet,
      wsUrl: 'ws://custom',
      persistPath: '/tmp/persist.json',
      autoSweep: false,
      mainAccountIndex: 2,
      startingIndex: 5
    });

    expect(berryMocks.mockCreateProcessor).toHaveBeenCalledWith({
      wallet: customWallet,
      wsUrl: 'ws://custom',
      persistPath: '/tmp/persist.json',
      autoSweep: false,
      mainAccountIndex: 2,
      startingIndex: 5
    });
  });

  it('converts and summarizes balances', async () => {
    const wallet = new berryMocks.MockWallet();
    expect(rawToNano('10')).toBe('nano:10');
    expect(nanoToRaw('1')).toBe('raw:1');

    const summary = await getBalanceSummary(wallet, 1);
    expect(summary).toEqual({
      address: 'nano_addr_1',
      balance_raw: '100',
      balance_nano: 'nano:100',
      pending_raw: '25',
      pending_nano: 'nano:25'
    });
  });

  it('receives pending funds and sends payments', async () => {
    const wallet = new berryMocks.MockWallet();
    const received = await receivePending(wallet, 0);
    expect(received).toEqual({
      received: [
        { hash: 'hash-1', amount_raw: '10', amount_nano: 'nano:10' },
        { hash: 'hash-2', amount_raw: '15', amount_nano: 'nano:15' }
      ],
      count: 2
    });

    const sent = await sendRaw(wallet, 'nano_dest', '250', 2);
    expect(sent).toEqual({ txHash: 'tx_nano_dest_250_2' });
  });

  it('creates charges and renders QR output', async () => {
    const processor = {
      createCharge: vi.fn(async (payload) => ({
        id: 'charge-1',
        address: 'nano_charge',
        amountNano: payload.amountNano,
        amountRaw: '12345'
      }))
    };

    await expect(createCharge(processor as any)).rejects.toThrow(
      'amountNano is required'
    );

    const { dir } = await createTempMapPath();
    try {
      const qrPath = join(dir, 'qr.png');
      const result = await createCharge(processor as any, {
        amountNano: 1.5,
        metadata: { job_id: 'job-1' },
        qrOutput: qrPath,
        timeoutMs: 3000
      });

      expect(result).toEqual({
        chargeId: 'charge-1',
        address: 'nano_charge',
        amount_nano: '1.5',
        amount_raw: '12345',
        qr_path: qrPath
      });

      expect(processor.createCharge).toHaveBeenCalledWith({
        amountNano: '1.5',
        metadata: { job_id: 'job-1' },
        webhookUrl: undefined,
        timeoutMs: 3000
      });
      expect(qrMocks.toFile).toHaveBeenCalledWith(qrPath, 'nano_charge');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads charge status details', async () => {
    const completedAt = new Date('2025-01-01T12:00:00Z');
    const processor = {
      checkChargeStatus: vi.fn(async () => ({
        charge: {
          status: 'completed',
          address: 'nano_charge',
          amountNano: '2',
          amountRaw: '2000',
          sweepTxHash: 'sweep-123',
          completedAt
        },
        isPaid: true,
        remainingRaw: '0',
        remainingNano: '0'
      }))
    };

    const status = await getChargeStatus(processor as any, 'charge-1');

    expect(status).toEqual({
      status: 'completed',
      address: 'nano_charge',
      amount_nano: '2',
      amount_raw: '2000',
      sweep_tx_hash: 'sweep-123',
      paid_at: completedAt.toISOString(),
      is_paid: true,
      remaining_raw: '0',
      remaining_nano: '0'
    });
  });

  it('registers and unregisters charge listeners', async () => {
    const processor = {
      on: vi.fn(),
      off: vi.fn(),
      start: vi.fn(async () => undefined),
      stop: vi.fn()
    };
    const handler = vi.fn();

    await startChargeListener(processor as any, {
      completed: handler,
      error: handler
    });

    expect(processor.on).toHaveBeenCalledWith('charge:completed', handler);
    expect(processor.on).toHaveBeenCalledWith('error', handler);
    expect(processor.start).toHaveBeenCalled();

    stopChargeListener(processor as any);
    expect(processor.off).toHaveBeenCalledWith('charge:completed', handler);
    expect(processor.off).toHaveBeenCalledWith('error', handler);
    expect(processor.stop).toHaveBeenCalled();
  });
});

describe('BerryPay charge flow (mocked)', () => {
  it('creates a charge and polls status', async () => {
    const processor = {
      createCharge: vi.fn(async () => ({
        id: 'charge-99',
        address: 'nano_charge',
        amountNano: '0.01',
        amountRaw: '10000'
      })),
      checkChargeStatus: vi.fn(async () => ({
        charge: {
          status: 'completed',
          address: 'nano_charge',
          amountNano: '0.01',
          amountRaw: '10000',
          sweepTxHash: 'sweep-999',
          completedAt: new Date('2025-02-02T00:00:00Z')
        },
        isPaid: true,
        remainingRaw: '0',
        remainingNano: '0'
      }))
    };

    const charge = await createCharge(processor as any, { amountNano: '0.01' });
    const status = await getChargeStatus(processor as any, charge.chargeId);

    expect(charge.chargeId).toBe('charge-99');
    expect(processor.createCharge).toHaveBeenCalledWith({
      amountNano: '0.01',
      metadata: undefined,
      webhookUrl: undefined,
      timeoutMs: undefined
    });
    expect(processor.checkChargeStatus).toHaveBeenCalledWith('charge-99');
    expect(status.is_paid).toBe(true);
    expect(status.status).toBe('completed');
  });
});
