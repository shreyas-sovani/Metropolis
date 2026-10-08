interface SqlRows {
  toArray(): Record<string, unknown>[];
}

export interface Sql {
  exec(query: string, ...bindings: unknown[]): SqlRows;
}

function rows(sql: Sql, query: string, ...bindings: unknown[]): Record<string, unknown>[] {
  return sql.exec(query, ...bindings).toArray();
}

function columns(sql: Sql, table: string): Set<string> {
  return new Set(rows(sql, `PRAGMA table_info(${table})`).map((row) => String(row.name)));
}

function addColumn(sql: Sql, table: string, name: string, definition: string) {
  if (!columns(sql, table).has(name)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function applied(sql: Sql): Set<number> {
  return new Set(rows(sql, "SELECT version FROM schema_migrations").map((row) => Number(row.version)));
}

const STEPS: { version: number; apply: (sql: Sql) => void }[] = [
  {
    version: 1,
    apply(sql) {
      sql.exec(`CREATE TABLE IF NOT EXISTS ticks (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS health_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_error TEXT)`);
      sql.exec(`INSERT OR IGNORE INTO health_state (id, last_error) VALUES (1, NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS pool (proxy TEXT PRIMARY KEY, status TEXT NOT NULL)`);
    },
  },
  {
    version: 2,
    apply(sql) {
      addColumn(sql, "pool", "account_id", "account_id TEXT NOT NULL DEFAULT ''");
      addColumn(sql, "pool", "perp_id", "perp_id TEXT NOT NULL DEFAULT ''");
      addColumn(sql, "pool", "side", "side TEXT NOT NULL DEFAULT ''");
      addColumn(sql, "pool", "leverage", "leverage TEXT NOT NULL DEFAULT ''");
      addColumn(sql, "pool", "created_at", "created_at INTEGER NOT NULL DEFAULT 0");
      sql.exec(`CREATE TABLE IF NOT EXISTS claims (
        proxy TEXT PRIMARY KEY,
        privy_user_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        ip TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        accepted_at INTEGER
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS mandates (
        proxy TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        typed_data TEXT NOT NULL,
        sig TEXT NOT NULL,
        active INTEGER NOT NULL,
        budget_used_cns TEXT NOT NULL,
        kind TEXT NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proxy TEXT NOT NULL,
        perp_id TEXT NOT NULL,
        amount_cns TEXT NOT NULL,
        tx_hash TEXT,
        block INTEGER,
        dist_before TEXT,
        dist_after TEXT,
        status TEXT NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS keys (name TEXT PRIMARY KEY, next_nonce INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS health (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_alarm_at INTEGER,
        last_error TEXT
      )`);
      sql.exec(`INSERT OR IGNORE INTO health (id, last_alarm_at, last_error) VALUES (1, NULL, NULL)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS claims_user ON claims (privy_user_id)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS mandates_active ON mandates (active)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS actions_proxy ON actions (proxy)`);
    },
  },
  {
    version: 3,
    apply(sql) {
      addColumn(sql, "pool", "market", "market TEXT NOT NULL DEFAULT ''");
      addColumn(sql, "pool", "role", "role TEXT NOT NULL DEFAULT 'pool'");
      addColumn(sql, "pool", "pair_id", "pair_id TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 4,
    apply(sql) {
      addColumn(sql, "actions", "reason", "reason TEXT NOT NULL DEFAULT ''");
      sql.exec(`CREATE TABLE IF NOT EXISTS keeper_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        max_gap_ms INTEGER NOT NULL DEFAULT 0,
        nonce_errors INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER
      )`);
      sql.exec(`INSERT OR IGNORE INTO keeper_stats (id, max_gap_ms, nonce_errors, started_at) VALUES (1, 0, 0, NULL)`);
    },
  },
  {
    version: 5,
    apply(sql) {
      sql.exec(`CREATE TABLE IF NOT EXISTS mandate_nonces (
        proxy TEXT NOT NULL,
        nonce TEXT NOT NULL,
        PRIMARY KEY (proxy, nonce)
      )`);
    },
  },
  {
    version: 6,
    apply(sql) {
      sql.exec(`CREATE TABLE IF NOT EXISTS sandbox_hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE INDEX IF NOT EXISTS sandbox_hits_ip ON sandbox_hits (ip, at)`);
      addColumn(sql, "keeper_stats", "canary_at", "canary_at INTEGER");
    },
  },
  {
    version: 7,
    apply(sql) {
      addColumn(sql, "keeper_stats", "recycled_at", "recycled_at INTEGER");
    },
  },
  {
    version: 8,
    apply(sql) {
      addColumn(sql, "actions", "liq_before", "liq_before TEXT");
    },
  },
  {
    version: 9,
    apply(sql) {
      addColumn(sql, "actions", "created_at", "created_at INTEGER NOT NULL DEFAULT 0");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status)");
      sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_actions_confirmed_open ON actions(id) WHERE status = 'confirmed' AND dist_after IS NULL",
      );
      sql.exec("CREATE INDEX IF NOT EXISTS idx_pool_role ON pool(role)");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_pool_status ON pool(status)");
      // claims is keyed by proxy, not id. The partial index covers the unaccepted-claim scan.
      sql.exec("CREATE INDEX IF NOT EXISTS idx_claims_unaccepted ON claims(proxy) WHERE accepted_at IS NULL");
    },
  },
  {
    version: 10,
    apply(sql) {
      addColumn(sql, "claims", "transfer_tx", "transfer_tx TEXT");
      addColumn(sql, "claims", "drip_tx", "drip_tx TEXT");
      addColumn(sql, "claims", "accept_tx", "accept_tx TEXT");
      addColumn(sql, "keeper_stats", "saves_scanned_at", "saves_scanned_at INTEGER");
      sql.exec(`CREATE TABLE IF NOT EXISTS saves (
        tx_hash TEXT PRIMARY KEY,
        proxy TEXT,
        perp_id TEXT,
        side TEXT,
        pre_liq TEXT,
        cross_block INTEGER,
        cross_mark TEXT,
        added_cns TEXT,
        recorded_at INTEGER
      )`);
      sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_actions_watched ON actions(proxy) WHERE status = 'confirmed' AND liq_before IS NOT NULL",
      );
    },
  },
  {
    version: 11,
    apply(sql) {
      // Rows from before v9 carry created_at = 0. The dashboard already dates them at the claim's acceptance (else the claim),
      // so they take that time, or now when no claim exists. Every history window can then be a plain range seek.
      sql.exec(
        `UPDATE actions SET created_at = COALESCE(
           (SELECT COALESCE(claims.accepted_at, claims.claimed_at) FROM claims WHERE claims.proxy = actions.proxy), ?)
         WHERE created_at = 0`,
        Date.now(),
      );
      // status has three values, but the planner preferred this index over proxy and the partial indexes,
      // so each per-account lookup read every confirmed action.
      sql.exec("DROP INDEX IF EXISTS idx_actions_status");
      // Keyed on proxy with no proxy in the query, so the watched scan read the whole index.
      sql.exec("DROP INDEX IF EXISTS idx_actions_watched");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_actions_pending ON actions(id) WHERE status = 'pending'");
      sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_actions_last_block ON actions(proxy, perp_id) WHERE status = 'confirmed' AND block IS NOT NULL",
      );
      sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_actions_watched_at ON actions(created_at)
         WHERE status = 'confirmed' AND liq_before IS NOT NULL AND liq_before != '' AND tx_hash IS NOT NULL AND tx_hash != ''`,
      );
      sql.exec("CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at)");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_claims_claimed ON claims(claimed_at)");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_saves_recorded ON saves(recorded_at)");
      sql.exec("CREATE INDEX IF NOT EXISTS idx_sandbox_hits_at ON sandbox_hits(at)");
      addColumn(sql, "keeper_stats", "pruned_at", "pruned_at INTEGER");
    },
  },
];

export function migrate(sql: Sql): number[] {
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`);
  const have = applied(sql);
  for (const step of STEPS) {
    if (have.has(step.version)) continue;
    step.apply(sql);
    sql.exec("INSERT INTO schema_migrations (version) VALUES (?)", step.version);
  }
  return [...applied(sql)].sort((left, right) => left - right);
}

export function crudRoundTrip(sql: Sql): { ok: true; versions: number[] } {
  const first = migrate(sql);
  const second = migrate(sql);
  if (first.join() !== second.join()) throw new Error("migration was not idempotent");

  sql.exec(
    `INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at)
     VALUES ('selftest', '1', '16', 'long', '1500', 'available', 1)`,
  );
  sql.exec(
    `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at)
     VALUES ('selftest', 'did:privy:selftest', '0x0000000000000000000000000000000000000001', '127.0.0.1', 1, NULL)`,
  );
  sql.exec(
    `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind)
     VALUES ('selftest', '0x0000000000000000000000000000000000000001', '{}', '0x', 1, '0', 'house')`,
  );
  sql.exec(
    `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status)
     VALUES ('selftest', '16', '1', NULL, NULL, NULL, NULL, 'pending')`,
  );
  sql.exec(`INSERT INTO keys (name, next_nonce) VALUES ('operator', 4)`);
  sql.exec(`UPDATE health SET last_alarm_at = 9, last_error = NULL WHERE id = 1`);

  const pool = rows(sql, "SELECT status, side FROM pool WHERE proxy = 'selftest'")[0];
  const claim = rows(sql, "SELECT privy_user_id FROM claims WHERE proxy = 'selftest'")[0];
  const mandate = rows(sql, "SELECT kind, active FROM mandates WHERE proxy = 'selftest'")[0];
  const action = rows(sql, "SELECT status FROM actions WHERE proxy = 'selftest'")[0];
  const key = rows(sql, "SELECT next_nonce FROM keys WHERE name = 'operator'")[0];
  const health = rows(sql, "SELECT last_alarm_at FROM health WHERE id = 1")[0];
  if (!pool || pool.status !== "available" || pool.side !== "long") throw new Error("pool read failed");
  if (!claim || claim.privy_user_id !== "did:privy:selftest") throw new Error("claim read failed");
  if (!mandate || mandate.kind !== "house" || Number(mandate.active) !== 1) throw new Error("mandate read failed");
  if (!action || action.status !== "pending") throw new Error("action read failed");
  if (!key || Number(key.next_nonce) !== 4) throw new Error("key read failed");
  if (!health || Number(health.last_alarm_at) !== 9) throw new Error("health read failed");

  sql.exec(`UPDATE pool SET status = 'claimed' WHERE proxy = 'selftest'`);
  const updated = rows(sql, "SELECT status FROM pool WHERE proxy = 'selftest'")[0];
  if (!updated || updated.status !== "claimed") throw new Error("pool update failed");

  sql.exec(`DELETE FROM actions WHERE proxy = 'selftest'`);
  sql.exec(`DELETE FROM mandates WHERE proxy = 'selftest'`);
  sql.exec(`DELETE FROM claims WHERE proxy = 'selftest'`);
  sql.exec(`DELETE FROM pool WHERE proxy = 'selftest'`);
  sql.exec(`DELETE FROM keys WHERE name = 'operator'`);
  sql.exec(`UPDATE health SET last_alarm_at = NULL WHERE id = 1`);
  const left = rows(sql, "SELECT COUNT(*) AS n FROM pool WHERE proxy = 'selftest'")[0];
  if (!left || Number(left.n) !== 0) throw new Error("pool delete failed");
  return { ok: true, versions: second };
}
