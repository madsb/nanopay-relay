import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { NanoRpcClient } from '../src/nano-rpc.js';

const startServer = async (
  handler: (payload: Record<string, unknown>) => { status: number; body: Record<string, unknown> }
) => {
  const server = createServer(async (req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const response = handler(payload);
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }

  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
};

describe('NanoRpcClient', () => {
  it('parses block_info responses', async () => {
    const { url, close } = await startServer((payload) => {
      if (payload.action === 'block_info') {
        return {
          status: 200,
          body: {
            amount: '1000',
            confirmed: 'true',
            subtype: 'send',
            contents: {
              link_as_account: 'nano_dest',
              type: 'state'
            }
          }
        };
      }
      return { status: 500, body: { error: 'unexpected' } };
    });

    try {
      const client = new NanoRpcClient(url);
      const result = await client.getBlockInfo('block-hash');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({
          hash: 'block-hash',
          amountRaw: '1000',
          destination: 'nano_dest',
          confirmed: true,
          subtype: 'send',
          blockType: 'state'
        });
      }
    } finally {
      await close();
    }
  });

  it('falls back to accounts_pending when accounts_receivable is unknown', async () => {
    const seen: string[] = [];
    const address = 'nano_address';
    const { url, close } = await startServer((payload) => {
      const action = String(payload.action ?? '');
      seen.push(action);
      if (action === 'accounts_receivable') {
        return { status: 200, body: { error: 'Unknown action' } };
      }
      if (action === 'accounts_pending') {
        return {
          status: 200,
          body: {
            blocks: {
              [address]: {
                hash1: {
                  amount: '42',
                  source: 'nano_source'
                }
              }
            }
          }
        };
      }
      return { status: 500, body: { error: 'unexpected' } };
    });

    try {
      const client = new NanoRpcClient(url);
      const result = await client.getReceivable(address, 5);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual([
          {
            hash: 'hash1',
            amountRaw: '42',
            source: 'nano_source'
          }
        ]);
      }
      expect(seen).toEqual(['accounts_receivable', 'accounts_pending']);
    } finally {
      await close();
    }
  });
});
