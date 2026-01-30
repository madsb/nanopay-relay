import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import {
  BerryPayWallet,
  createProcessor,
  getConfigPath,
  getRpcUrl,
  getSeed,
  getWsUrl,
  saveSeed,
} from 'berrypay';

const CHARGE_MAP_PATH = path.join(os.homedir(), '.nanobazaar-relay', 'charge-map.json');
const listenerRegistry = new WeakMap();

const ensureDir = async (filePath) => {
  await mkdir(path.dirname(filePath), { recursive: true });
};

const readJsonFile = async (filePath) => {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
};

const writeJsonFile = async (filePath, data) => {
  await ensureDir(filePath);
  const payload = JSON.stringify(data ?? {}, null, 2);
  await writeFile(filePath, payload, 'utf8');
  return filePath;
};

export const getChargeMapPath = () => CHARGE_MAP_PATH;

export const readChargeMap = async (filePath = CHARGE_MAP_PATH) => {
  return readJsonFile(filePath);
};

export const writeChargeMap = async (map, filePath = CHARGE_MAP_PATH) => {
  return writeJsonFile(filePath, map);
};

export const setChargeMapping = async (jobId, chargeId, filePath = CHARGE_MAP_PATH) => {
  const map = await readChargeMap(filePath);
  map[jobId] = chargeId;
  await writeChargeMap(map, filePath);
  return map;
};

export const getChargeMapping = async (jobId, filePath = CHARGE_MAP_PATH) => {
  const map = await readChargeMap(filePath);
  return map[jobId];
};

export const removeChargeMapping = async (jobId, filePath = CHARGE_MAP_PATH) => {
  const map = await readChargeMap(filePath);
  if (jobId in map) {
    delete map[jobId];
    await writeChargeMap(map, filePath);
  }
  return map;
};

export const ensureWallet = () => {
  const seed = getSeed();
  let wallet;
  let created = false;

  if (seed) {
    wallet = new BerryPayWallet({ seed, rpcUrl: getRpcUrl() });
  } else {
    wallet = new BerryPayWallet({ rpcUrl: getRpcUrl() });
    saveSeed(wallet.getSeed());
    created = true;
  }

  return {
    wallet,
    created,
    address: wallet.getAddress(0),
    configPath: getConfigPath(),
  };
};

export const createPaymentProcessor = ({
  wallet,
  wsUrl,
  persistPath,
  autoSweep,
  mainAccountIndex,
  startingIndex,
} = {}) => {
  const resolvedWallet = wallet ?? ensureWallet().wallet;
  return createProcessor({
    wallet: resolvedWallet,
    wsUrl: wsUrl ?? getWsUrl(),
    persistPath,
    autoSweep,
    mainAccountIndex,
    startingIndex,
  });
};

export const rawToNano = (raw) => BerryPayWallet.rawToNano(String(raw));
export const nanoToRaw = (nano) => BerryPayWallet.nanoToRaw(String(nano));

export const getBalanceSummary = async (wallet, index = 0) => {
  const { balance, pending } = await wallet.getBalance(index);
  const address = wallet.getAddress(index);
  return {
    address,
    balance_raw: balance,
    balance_nano: rawToNano(balance),
    pending_raw: pending,
    pending_nano: rawToNano(pending),
  };
};

export const receivePending = async (wallet, index = 0) => {
  const results = await wallet.receivePending(index);
  const received = results.map((result) => ({
    hash: result.hash,
    amount_raw: result.amount,
    amount_nano: rawToNano(result.amount),
  }));
  return { received, count: received.length };
};

export const sendRaw = async (wallet, address, amountRaw, index = 0) => {
  const result = await wallet.send(address, String(amountRaw), index);
  return { txHash: result.hash };
};

export const createCharge = async (
  processor,
  { amountNano, metadata, webhookUrl, qrOutput, timeoutMs } = {},
) => {
  if (!amountNano) {
    throw new Error('amountNano is required');
  }
  const charge = await processor.createCharge({
    amountNano: String(amountNano),
    metadata,
    webhookUrl,
    timeoutMs,
  });
  let qrPath;
  if (qrOutput) {
    qrPath = String(qrOutput);
    await ensureDir(qrPath);
    await QRCode.toFile(qrPath, charge.address);
  }
  return {
    chargeId: charge.id,
    address: charge.address,
    amount_nano: charge.amountNano,
    amount_raw: charge.amountRaw,
    qr_path: qrPath,
  };
};

export const getChargeStatus = async (processor, chargeId) => {
  const status = await processor.checkChargeStatus(chargeId);
  const charge = status.charge;
  return {
    status: charge.status,
    address: charge.address,
    amount_nano: charge.amountNano,
    amount_raw: charge.amountRaw,
    sweep_tx_hash: charge.sweepTxHash,
    paid_at: charge.completedAt ? charge.completedAt.toISOString() : undefined,
    is_paid: status.isPaid,
    remaining_raw: status.remainingRaw,
    remaining_nano: status.remainingNano,
  };
};

const registerListener = (processor, event, handler, entries) => {
  if (typeof handler !== 'function') return;
  processor.on(event, handler);
  entries.push({ event, handler });
};

export const startChargeListener = async (processor, handlers = {}) => {
  const entries = [];
  const eventMap = {
    created: 'charge:created',
    payment: 'charge:payment',
    partial: 'charge:partial',
    completed: 'charge:completed',
    expired: 'charge:expired',
    swept: 'charge:swept',
    started: 'started',
    stopped: 'stopped',
    connected: 'connected',
    disconnected: 'disconnected',
    recoveryFound: 'recovery:found',
    webhookSent: 'webhook:sent',
    webhookFailed: 'webhook:failed',
    webhookError: 'webhook:error',
    error: 'error',
  };

  for (const [key, handler] of Object.entries(handlers)) {
    const event = eventMap[key] ?? key;
    registerListener(processor, event, handler, entries);
  }

  if (entries.length > 0) {
    listenerRegistry.set(processor, entries);
  }

  await processor.start();
  return processor;
};

export const stopChargeListener = (processor) => {
  const entries = listenerRegistry.get(processor) ?? [];
  for (const { event, handler } of entries) {
    if (typeof processor.off === 'function') {
      processor.off(event, handler);
    } else {
      processor.removeListener(event, handler);
    }
  }
  listenerRegistry.delete(processor);
  processor.stop();
};
