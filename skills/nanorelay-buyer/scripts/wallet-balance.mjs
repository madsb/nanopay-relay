#!/usr/bin/env node
import { ensureWallet, getBalanceSummary } from '../../nanorelay-common/berrypay.mjs';

const { wallet, configPath } = ensureWallet();
const summary = await getBalanceSummary(wallet);

const result = {
  ...summary,
  config_path: configPath
};

console.log(JSON.stringify(result, null, 2));
