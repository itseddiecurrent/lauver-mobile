import 'dotenv/config';

import { createDatabase } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { StreamService } from '../src/stream.js';

const config = loadConfig();
if (!config.stream) {
  console.error('STREAM_ENABLED must be true to reconcile event memberships.');
  process.exitCode = 1;
} else {
  const database = createDatabase(config.databaseURL);
  const apply = process.argv.includes('--apply');
  const service = new StreamService(database.client, config.stream.apiKey, config.stream.apiSecret, config.stream.tokenTTLSeconds);
  try {
    const differences = await service.reconcileEventMemberships(apply);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', differences }, null, 2));
    if (!apply && differences.length) process.exitCode = 2;
  } finally {
    await database.disconnect();
  }
}
