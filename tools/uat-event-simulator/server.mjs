import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const appName = 'alpha-edge-uat-backend';
const databasePath = '/litefs/trading.db';
const localDatabasePath = process.env.EVENT_SIMULATOR_DB_PATH || '';
const port = Number(process.env.PORT || 3000);
const fixture = {
    ticker: 'AEVT',
    fullTicker: 'ASX:AEVT',
    name: 'UAT Event Simulator',
    isin: 'UAT000000AEVT',
    price: 5,
    quantity: 100,
    value: 500,
};

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function runProcess(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
                return;
            }
            reject(new Error((stderr || stdout || `${command} exited ${code}`).trim()));
        });
    });
}

function runFly(command) {
    return runProcess('fly', ['ssh', 'console', '-a', appName, '-C', command]);
}

async function runSql(sql, json = false) {
    if (localDatabasePath) {
        const flags = json ? ['-json', '-bail', localDatabasePath, sql] : ['-bail', localDatabasePath, sql];
        return runProcess('sqlite3', flags);
    }
    const encoded = Buffer.from(sql, 'utf8').toString('base64');
    const sqliteFlags = json ? '-json -bail' : '-bail';
    const remote = `printf %s ${shellQuote(encoded)} | base64 -d | sqlite3 ${sqliteFlags} ${shellQuote(databasePath)}`;
    return runFly(`sh -lc ${shellQuote(remote)}`);
}

async function queryJson(sql) {
    const output = await runSql(sql, true);
    return output ? JSON.parse(output) : [];
}

const latestStatementQuery = `
    SELECT id, account_name, statement_date, total_value_aud, cash_aud
    FROM account_statements
    ORDER BY statement_date DESC, id DESC
    LIMIT 1;
`;

const fixtureStatusQuery = `
    SELECT
        h.id AS holding_id,
        h.quantity,
        h.current_price,
        h.value_aud,
        h.is_active,
        sa.id AS analysis_id,
		h.security_id AS holding_security_id,
		sa.security_id AS analysis_security_id,
        sa.primary_asset_class,
		si.id AS identity_id,
        sp.position_state,
		(SELECT cash_reserve FROM asset_class_config WHERE code = 'GOLD_MINERS') AS class_cash_reserve,
        (SELECT id FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1) AS latest_statement_id
    FROM holdings h
    LEFT JOIN stock_analysis sa ON sa.security_id = h.security_id
	LEFT JOIN security_identities si ON si.id = h.security_id
    LEFT JOIN security_positions sp ON sp.ticker = h.ticker
    WHERE h.company_name = '${fixture.name}' AND h.is_active = 1
    LIMIT 1;
`;

const existingFixtureStatementValueQuery = `
    SELECT value_aud
    FROM statement_holdings
    WHERE statement_id = (SELECT id FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1)
      AND details = '${fixture.name}'
    LIMIT 1;
`;

const fixtureInboxPredicate = `(payload LIKE '%uat-event-simulator:%' OR json_extract(payload, '$.ticker') IN ('ASX:AEVT', 'ASX_DLY:AEVT'))`;

function prepareFixtureSql(hasInbox = false) {
    return `
        PRAGMA foreign_keys = ON;
        BEGIN IMMEDIATE;

        ${hasInbox ? `
        CREATE TEMP TABLE simulator_inbox_idle (pending INTEGER CHECK(pending = 0));
        INSERT INTO simulator_inbox_idle SELECT COUNT(*) FROM webhook_inbox
        WHERE ${fixtureInboxPredicate} AND status IN ('PENDING','PROCESSING');
        DROP TABLE simulator_inbox_idle;
        DELETE FROM webhook_inbox WHERE ${fixtureInboxPredicate};
        ` : ''}

        UPDATE account_statements
        SET cash_aud = cash_aud + COALESCE((
            SELECT value_aud
            FROM statement_holdings
            WHERE statement_id = account_statements.id
              AND details = '${fixture.name}'
            LIMIT 1
        ), 0)
        WHERE id = (SELECT id FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1);

        DELETE FROM statement_holdings WHERE details = '${fixture.name}';
        DELETE FROM holdings WHERE company_name = '${fixture.name}';
        DELETE FROM stock_analysis WHERE name = '${fixture.name}' OR UPPER(ticker) IN ('${fixture.fullTicker}', '${fixture.ticker}');
        DELETE FROM company_mappings WHERE company_name = '${fixture.name}';
        DELETE FROM security_positions WHERE ticker = '${fixture.ticker}';
        DELETE FROM commodity_theme_events
        WHERE event_key LIKE 'GOLD:uat-event-simulator:%'
           OR security_ticker IN ('${fixture.fullTicker}', 'ASX_DLY:${fixture.ticker}');
		DELETE FROM webhook_dead_letters WHERE ${fixtureInboxPredicate};
        DELETE FROM active_alerts
        WHERE UPPER(ticker) IN ('${fixture.fullTicker}', '${fixture.ticker}');
        -- Fixture alert history may have user decision records. Retire it
        -- instead of deleting audited alerts and violating that relationship.
        UPDATE alerts
        SET is_active = 0,
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            resolved_reason = COALESCE(resolved_reason, 'SIMULATOR_RESET')
        WHERE ticker = '${fixture.ticker}' AND UPPER(COALESCE(exchange_prefix, 'ASX:')) = 'ASX:';
        UPDATE alerts
        SET is_active = 0,
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
            resolved_reason = COALESCE(resolved_reason, 'SIMULATOR_RESET')
        WHERE id IN (
            SELECT alert_id FROM security_actions
            WHERE source_event_key LIKE 'GOLD:uat-event-simulator:%'
        );
        -- Ordinary CDF/TMS fixture alerts have no source_event_key. Retire
        -- every unresolved action linked to the fixture alerts as well, so a
        -- previous run cannot keep blocking the fresh scenario queue.
        UPDATE security_actions
        SET status = 'NOT_APPLICABLE',
            blocked_by_action_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE alert_id IN (
            SELECT id
            FROM alerts
            WHERE ticker = '${fixture.ticker}'
              AND UPPER(COALESCE(exchange_prefix, 'ASX:')) = 'ASX:'
        )
          AND status IN ('OPEN', 'BLOCKED');
        UPDATE security_actions
        SET status = 'NOT_APPLICABLE', updated_at = CURRENT_TIMESTAMP
        WHERE source_event_key LIKE 'GOLD:uat-event-simulator:%'
          AND status NOT IN ('CONFIRMED', 'IGNORED', 'EXPIRED', 'NOT_APPLICABLE');
        -- Simulator actions are disposable projections of the fixture events.
        -- Remove only these rows so the same deterministic event IDs create a
        -- fresh queue outcome on every clean run.
        DELETE FROM security_actions
        WHERE source_event_key LIKE 'GOLD:uat-event-simulator:%';
        DELETE FROM security_name_aliases
        WHERE security_id IN (
            SELECT id FROM security_identities
            WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}'
        );
        DELETE FROM security_identities
        WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}';

        INSERT INTO security_identities (isin, exchange_prefix, ticker, canonical_name)
        VALUES ('${fixture.isin}', 'ASX:', '${fixture.ticker}', '${fixture.name}');
        INSERT INTO security_name_aliases (security_id, name, normalized_name, source)
        VALUES (
            (SELECT id FROM security_identities WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}'),
            '${fixture.name}', 'uat event simulator', 'uat_event_simulator'
        );

        INSERT INTO company_mappings (company_name, ticker, exchange_prefix, security_id, enriched_at)
        VALUES ('${fixture.name}', '${fixture.ticker}', 'ASX:',
            (SELECT id FROM security_identities WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}'), CURRENT_TIMESTAMP);

        -- The fixture needs an explicit class cash pool so its Add action can
        -- exercise the same funded-ticket path as UAT. This is mock-only UAT
        -- ledger state; it never sends a broker order.
        INSERT INTO asset_class_config (code, display_name, cash_reserve, stock_allocation_ratio, active)
        VALUES ('GOLD_MINERS', 'Gold Miners', 250, 0.75, 1)
        ON CONFLICT(code) DO UPDATE SET
            cash_reserve = MAX(COALESCE(asset_class_config.cash_reserve, 0), excluded.cash_reserve),
            stock_allocation_ratio = excluded.stock_allocation_ratio,
            active = 1,
            updated_at = CURRENT_TIMESTAMP;

        INSERT INTO stock_analysis (
            ticker, name, security_id, current_price, analyst_pt, allocation,
            include_in_sizing, primary_asset_class, security_type,
            is_watchlist, is_external, updated_at
        ) VALUES (
            '${fixture.fullTicker}', '${fixture.name}',
            (SELECT id FROM security_identities WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}'),
            ${fixture.price}, 6.8, 20,
            1, 'GOLD_MINERS', 'STOCK', 0, 0, CURRENT_TIMESTAMP
        );

        INSERT INTO holdings (
            isin, ticker, company_name, exchange_prefix,
            security_id, quantity, cost_aud, current_price, value_aud,
            gain_loss_aud, gain_loss_pct, currency, market_value,
            cash_reserve, is_active, last_synced_at, updated_at
        ) VALUES (
            '${fixture.isin}', '${fixture.ticker}', '${fixture.name}', 'ASX:',
            (SELECT id FROM security_identities WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}'),
            ${fixture.quantity}, ${fixture.value}, ${fixture.price}, ${fixture.value},
            0, 0, 'AUD', ${fixture.value}, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        );

        INSERT INTO statement_holdings (
            statement_id, security_id, details, quantity, cost_aud, current_price,
            value_aud, gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve
        ) VALUES (
            (SELECT id FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1),
            (SELECT id FROM security_identities WHERE exchange_prefix = 'ASX:' AND ticker = '${fixture.ticker}'),
            '${fixture.name}', ${fixture.quantity}, ${fixture.value}, ${fixture.price},
            ${fixture.value}, 0, 0, 'AUD', ${fixture.value}, 0
        );

        UPDATE account_statements
        SET cash_aud = cash_aud - ${fixture.value}
        WHERE id = (SELECT id FROM account_statements ORDER BY statement_date DESC, id DESC LIMIT 1);

        INSERT INTO security_positions (ticker, position_state, manual_override, entry_date, stopped_waiting_reentry, last_updated)
        VALUES ('${fixture.ticker}', 'BUY', 0, CURRENT_TIMESTAMP, 0, CURRENT_TIMESTAMP);

        COMMIT;
    `;
}

function writeJson(response, status, body) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
}

async function prepareFixture() {
    const [statements, existingFixtureRows] = await Promise.all([
        queryJson(latestStatementQuery),
        queryJson(existingFixtureStatementValueQuery),
    ]);
    const latest = statements[0];
    if (!latest) throw new Error('UAT has no statement to fund the simulator holding.');
    const reusableFixtureCash = Number(existingFixtureRows[0]?.value_aud || 0);
    const availableCash = Number(latest.cash_aud || 0) + reusableFixtureCash;
    if (availableCash < fixture.value) {
        throw new Error(`UAT cash is below the required $${fixture.value.toLocaleString()} fixture value after releasing any existing simulator holding.`);
    }
    const inboxTables = await queryJson("SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_inbox'");
    await runSql(prepareFixtureSql(inboxTables.length > 0));
    const status = await queryJson(fixtureStatusQuery);
    if (!status[0] ||
        Number(status[0].value_aud) !== fixture.value ||
        !status[0].identity_id ||
        status[0].holding_security_id !== status[0].analysis_security_id ||
        status[0].holding_security_id !== status[0].identity_id ||
        status[0].primary_asset_class !== 'GOLD_MINERS' ||
        Number(status[0].class_cash_reserve || 0) < 250) {
        throw new Error('Fixture write could not be verified.');
    }
    return { fixture, statement: latest, status: status[0] };
}

const server = createServer(async (request, response) => {
    try {
        if (request.method === 'GET' && (request.url === '/' || request.url === '/index.html')) {
            const html = await readFile(join(directory, 'index.html'));
            response.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            response.end(html);
            return;
        }
        if (request.method === 'GET' && request.url === '/fixture/status') {
            const [statement, status] = await Promise.all([
                queryJson(latestStatementQuery),
                queryJson(fixtureStatusQuery),
            ]);
            writeJson(response, 200, { fixture, statement: statement[0] || null, status: status[0] || null });
            return;
        }
        if (request.method === 'POST' && request.url === '/fixture/prepare') {
            writeJson(response, 201, await prepareFixture());
            return;
        }
        writeJson(response, 404, { error: 'Not found' });
    } catch (error) {
        writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
});

server.listen(port, '127.0.0.1', () => {
    console.log(`UAT event simulator available at http://localhost:${port}`);
    console.log(localDatabasePath
        ? `Fixture writes use local database ${localDatabasePath} (${fixture.fullTicker}).`
        : `Fixture writes are fixed to ${appName} (${fixture.fullTicker}).`);
});
