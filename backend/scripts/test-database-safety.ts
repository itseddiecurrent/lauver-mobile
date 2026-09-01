export function validateTestDatabaseURL(
  value: string | undefined,
  allowRemoteReset: boolean,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error('TEST_DATABASE_URL is required');
  }

  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol');
  }

  const databaseName = url.pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('Refusing to reset a database whose name does not end in `_test`');
  }

  const localHosts = new Set(['127.0.0.1', '::1', 'localhost', 'postgres']);
  if (!localHosts.has(url.hostname) && !allowRemoteReset) {
    throw new Error('Refusing to reset a remote database without ALLOW_REMOTE_TEST_DATABASE_RESET=true');
  }

  return value;
}
