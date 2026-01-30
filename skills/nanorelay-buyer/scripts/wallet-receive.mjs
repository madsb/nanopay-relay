#!/usr/bin/env node
import { ensureWallet, receivePending } from '../../nanorelay-common/berrypay.mjs';

const { wallet, configPath } = ensureWallet();
const received = await receivePending(wallet);

const result = {
  ...received,
  config_path: configPath
};

console.log(JSON.stringify(result, null, 2));
