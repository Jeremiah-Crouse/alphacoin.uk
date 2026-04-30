CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userEmail TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    sourcePool TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pools (
    poolName TEXT PRIMARY KEY,
    balance REAL NOT NULL
);

-- Initial seeding of known pools (based on pre-failure About.md)
INSERT INTO pools (poolName, balance) VALUES ('genesis_treasury', 1054576.0);
INSERT INTO pools (poolName, balance) VALUES ('velocity_pool', 100000.0);
INSERT INTO pools (poolName, balance) VALUES ('faucet_reserve', 20000.0);
INSERT INTO pools (poolName, balance) VALUES ('faucet_wallet', 15970.0);
INSERT INTO pools (poolName, balance) VALUES ('lobster_republic_grant', 5000.0);
INSERT INTO pools (poolName, balance) VALUES ('bot_nodes', 50.0);
INSERT INTO pools (poolName, balance) VALUES ('sovereign_accounts', 1610.0);

-- Placeholder for bot-node specific balances if needed separately
-- CREATE TABLE bot_node_balances (
--     nodeId TEXT PRIMARY KEY,
--     balance REAL NOT NULL
-- );

-- Placeholder for ledger integrity tracking
CREATE TABLE protocol_state (
    key TEXT PRIMARY KEY,
    value TEXT
);
INSERT INTO protocol_state (key, value) VALUES ('last_audit_timestamp', '2026-05-07T00:00:00Z');
INSERT INTO protocol_state (key, value) VALUES ('canonical_supply', '1223336.0');

