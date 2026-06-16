/**
 * Reusable Supabase query builder mock factory.
 * Usage:
 *   const { mockSupabase, setQueryResult } = createSupabaseMock();
 *   jest.mock('../../src/lib/supabase', () => ({ supabase: mockSupabase }));
 *   setQueryResult({ data: [...], error: null });
 */

export function createQueryBuilder(resolveWith = { data: [], error: null }) {
  const builder = {
    select:     jest.fn().mockReturnThis(),
    eq:         jest.fn().mockReturnThis(),
    neq:        jest.fn().mockReturnThis(),
    gte:        jest.fn().mockReturnThis(),
    lte:        jest.fn().mockReturnThis(),
    in:         jest.fn().mockReturnThis(),
    not:        jest.fn().mockReturnThis(),
    order:      jest.fn().mockReturnThis(),
    limit:      jest.fn().mockReturnThis(),
    overlaps:   jest.fn().mockReturnThis(),
    insert:     jest.fn().mockReturnThis(),
    update:     jest.fn().mockReturnThis(),
    delete:     jest.fn().mockReturnThis(),
    upsert:     jest.fn().mockReturnThis(),
    single:     jest.fn().mockResolvedValue(resolveWith),
    maybeSingle:jest.fn().mockResolvedValue(resolveWith),
    // Make the builder itself thenable (await builder → resolveWith)
    then: (resolve, reject) => Promise.resolve(resolveWith).then(resolve, reject),
  };
  return builder;
}

/**
 * Creates a fresh supabase mock where each `from()` call returns
 * a new query builder. Call `mockFrom` to configure per-table behaviour.
 */
export function createSupabaseMock() {
  const tableResults = {};
  const defaultResult = { data: [], error: null };

  const mockSupabase = {
    from: jest.fn((table) => {
      const result = tableResults[table] ?? defaultResult;
      return createQueryBuilder(result);
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    channel: jest.fn().mockReturnValue({
      on:        jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    }),
    removeChannel: jest.fn(),
    auth: {
      signOut:           jest.fn().mockResolvedValue({ error: null }),
      signInWithIdToken: jest.fn().mockResolvedValue({ data: { session: {} }, error: null }),
    },
  };

  function setTableResult(table, data, error = null) {
    tableResults[table] = { data, error };
  }

  function resetAll() {
    Object.keys(tableResults).forEach(k => delete tableResults[k]);
    mockSupabase.from.mockClear();
  }

  return { mockSupabase, setTableResult, resetAll };
}
