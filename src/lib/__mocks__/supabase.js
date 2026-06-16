/**
 * Auto-mock for src/lib/supabase.js
 * Tests import { __setTableData, __resetAll } from this mock to configure per-test data.
 */

const _tableData = {};

function _makeBuilder(table) {
  const getResult = () => {
    const entry = _tableData[table];
    if (entry === undefined) return { data: [], error: null };
    if (typeof entry === 'function') return entry();
    return { data: entry, error: null };
  };

  const b = {
    select:      jest.fn().mockReturnThis(),
    eq:          jest.fn().mockReturnThis(),
    neq:         jest.fn().mockReturnThis(),
    not:         jest.fn().mockReturnThis(),
    gte:         jest.fn().mockReturnThis(),
    lte:         jest.fn().mockReturnThis(),
    in:          jest.fn().mockReturnThis(),
    overlaps:    jest.fn().mockReturnThis(),
    order:       jest.fn().mockReturnThis(),
    limit:       jest.fn().mockReturnThis(),
    insert:      jest.fn().mockReturnThis(),
    update:      jest.fn().mockReturnThis(),
    delete:      jest.fn().mockReturnThis(),
    upsert:      jest.fn().mockReturnThis(),
    single:      jest.fn(() => Promise.resolve({ data: (getResult().data || [])[0] ?? null, error: getResult().error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: (getResult().data || [])[0] ?? null, error: getResult().error })),
    then:        (resolve, reject) => {
      try { return resolve(getResult()); }
      catch (e) { return reject ? reject(e) : Promise.reject(e); }
    },
  };
  return b;
}

const supabase = {
  from:          jest.fn((table) => _makeBuilder(table)),
  rpc:           jest.fn().mockResolvedValue({ data: null, error: null }),
  removeChannel: jest.fn(),
  channel:       jest.fn().mockReturnValue({
    on:        jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
  }),
  auth: {
    signOut:           jest.fn().mockResolvedValue({ error: null }),
    signInWithIdToken: jest.fn().mockResolvedValue({ data: { session: {} }, error: null }),
  },
  storage: {
    from: jest.fn().mockReturnValue({
      upload:    jest.fn().mockResolvedValue({ data: { path: 'test/path' }, error: null }),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/test' } }),
    }),
  },
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

function __setTableData(table, dataOrFn) {
  _tableData[table] = dataOrFn;
}

function __resetAll() {
  Object.keys(_tableData).forEach(k => delete _tableData[k]);
  supabase.from.mockClear();
  supabase.rpc.mockClear();
}

function syncFirebaseToSupabase() {
  return Promise.resolve({ session: {} });
}

module.exports = { supabase, syncFirebaseToSupabase, __setTableData, __resetAll };
