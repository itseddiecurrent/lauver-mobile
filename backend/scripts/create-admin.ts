import 'dotenv/config';

import { AdminService } from '../src/admin.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const role = process.env.ADMIN_ROLE === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
const config = loadConfig();
const database = createDatabase(config.databaseURL);
try {
  await new AdminService(database.client).createAdmin(email, password, role);
  console.log('Admin account provisioned.');
} finally {
  await database.disconnect();
}
