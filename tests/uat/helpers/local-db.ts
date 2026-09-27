import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const resetLocalUatDatabaseIfConfigured = (): void => {
    const resetCommand = process.env.UAT_RESET_COMMAND;
    if (resetCommand) {
        execSync(resetCommand, {
            stdio: 'inherit',
            shell: process.env.SHELL || '/bin/sh',
        });
        return;
    }

    const dbPath = process.env.UAT_SQLITE_DB_PATH;
    if (!dbPath) return;

    const resetSql = readFileSync(
        resolve(process.cwd(), 'tests/uat/reset_uat_state.sql'),
        'utf8',
    );
    const seedSql = readFileSync(
        resolve(process.cwd(), 'tests/uat/seed_fake_portfolio.sql'),
        'utf8',
    );

    execFileSync('sqlite3', [dbPath], {
        input: `${resetSql}\n${seedSql}`,
        stdio: ['pipe', 'inherit', 'inherit'],
    });
};

export const resetOverlaySignalStateIfConfigured = (): boolean => {
    const resetCommand = process.env.UAT_SIGNAL_RESET_COMMAND;
    if (resetCommand) {
        execSync(resetCommand, {
            stdio: 'inherit',
            shell: process.env.SHELL || '/bin/sh',
        });
        return true;
    }

    const dbPath = process.env.UAT_SQLITE_DB_PATH;
    if (!dbPath) return false;

    execFileSync('sqlite3', [dbPath], {
        input: `
            DELETE FROM overlay_event_classes;
            DELETE FROM overlay_stage1_sources;
            DELETE FROM overlay_events;
            DELETE FROM overlay_stage1_state_classes;
            DELETE FROM overlay_stage1_state;
            DELETE FROM equity_sizing_history;
            DELETE FROM equity_sizing;
            DELETE FROM q4_crisis_state;
            DELETE FROM overlay_signal_state;
        `,
        stdio: ['pipe', 'inherit', 'inherit'],
    });
    return true;
};
