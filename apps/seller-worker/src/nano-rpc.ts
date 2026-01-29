import { fetch } from 'undici';

type RpcError = { ok: false; error: string };
type RpcSuccess<T> = { ok: true; data: T };
export type RpcResult<T> = RpcError | RpcSuccess<T>;

export type NanoBlockInfo = {
  hash: string;
  amountRaw: string;
  destination: string | null;
  confirmed: boolean | null;
  subtype: string | null;
  blockType: string | null;
};

export type NanoReceivableBlock = {
  hash: string;
  amountRaw: string;
  source?: string;
};

type BlockInfoResponse = {
  amount?: string;
  confirmed?: boolean | string;
  subtype?: string;
  contents?: Record<string, unknown> | string;
};

type ReceivableResponse = {
  blocks?: Record<string, Record<string, string | { amount?: string; source?: string }>>;
};

const parseConfirmed = (value: unknown): boolean | null => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
};

const parseDestination = (contents: Record<string, unknown> | null): string | null => {
  if (!contents) return null;
  if (typeof contents.link_as_account === 'string') return contents.link_as_account;
  if (typeof contents.destination === 'string') return contents.destination;
  if (typeof contents.link === 'string' && contents.link.startsWith('nano_')) {
    return contents.link;
  }
  return null;
};

const parseBlockInfo = (hash: string, info: BlockInfoResponse): NanoBlockInfo | null => {
  if (!info || typeof info !== 'object') return null;
  const amountRaw = typeof info.amount === 'string' ? info.amount : null;
  if (!amountRaw) return null;
  const contents =
    info.contents && typeof info.contents === 'object' ? (info.contents as Record<string, unknown>) : null;
  const subtype =
    typeof info.subtype === 'string'
      ? info.subtype
      : typeof contents?.subtype === 'string'
        ? (contents.subtype as string)
        : null;
  const blockType = typeof contents?.type === 'string' ? (contents.type as string) : null;
  const destination = parseDestination(contents);
  const confirmed = parseConfirmed(info.confirmed);

  return {
    hash,
    amountRaw,
    destination,
    confirmed,
    subtype,
    blockType
  };
};

const parseReceivableBlocks = (
  address: string,
  response: ReceivableResponse
): NanoReceivableBlock[] => {
  if (!response || typeof response !== 'object') return [];
  const accountBlocks = response.blocks?.[address];
  if (!accountBlocks || typeof accountBlocks !== 'object') return [];
  return Object.entries(accountBlocks)
    .map(([hash, value]) => {
      if (typeof value === 'string') {
        return { hash, amountRaw: value };
      }
      if (value && typeof value === 'object') {
        const amountRaw = typeof value.amount === 'string' ? value.amount : null;
        if (!amountRaw) return null;
        return {
          hash,
          amountRaw,
          source: typeof value.source === 'string' ? value.source : undefined
        };
      }
      return null;
    })
    .filter((entry): entry is NanoReceivableBlock => Boolean(entry));
};

const isUnknownAction = (message: string) =>
  message.toLowerCase().includes('unknown') || message.toLowerCase().includes('unrecognized');

export class NanoRpcClient {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  private async request<T>(payload: Record<string, unknown>): Promise<RpcResult<T>> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      const data = text ? (JSON.parse(text) as { error?: string }) : {};
      if (!response.ok) {
        return { ok: false, error: `rpc_http_${response.status}` };
      }
      if (data && typeof data.error === 'string') {
        return { ok: false, error: data.error };
      }
      return { ok: true, data: data as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'rpc_unavailable';
      return { ok: false, error: message };
    }
  }

  async getBlockInfo(hash: string): Promise<RpcResult<NanoBlockInfo>> {
    const result = await this.request<BlockInfoResponse>({
      action: 'block_info',
      hash,
      json_block: true
    });
    if (!result.ok) return result;
    const parsed = parseBlockInfo(hash, result.data);
    if (!parsed) {
      return { ok: false, error: 'invalid_block_info' };
    }
    return { ok: true, data: parsed };
  }

  async getReceivable(address: string, count = 25): Promise<RpcResult<NanoReceivableBlock[]>> {
    const basePayload = {
      accounts: [address],
      count,
      source: true
    };

    let result = await this.request<ReceivableResponse>({
      action: 'accounts_receivable',
      ...basePayload
    });

    if (!result.ok && isUnknownAction(result.error)) {
      result = await this.request<ReceivableResponse>({
        action: 'accounts_pending',
        ...basePayload
      });
    }

    if (!result.ok) return result;
    const parsed = parseReceivableBlocks(address, result.data);
    return { ok: true, data: parsed };
  }
}
