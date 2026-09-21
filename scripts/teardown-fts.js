// This is completely harmless to run, the index will be rebuilt when we start up server again
import Database from 'better-sqlite3';
import path from 'path';

/**
 * EXPLANATION (Why do we drop tables?):
 * Prisma's schema engine fundamentally does not support SQLite Virtual Tables (FTS5) 
 * or custom triggers. If they exist in the DB but not the schema, running `prisma db push`
 * causes a "schema drift" panic and crashes.
 * This script safely removes them immediately before `db push`. The application 
 * will automatically and safely rebuild the FTS index on boot via `initFTS()`.
 */
try {
	const dbPath = path.resolve(process.cwd(), 'prisma/dev.db');
	const db = new Database(dbPath);
	
	db.exec(`
		DROP TRIGGER IF EXISTS Document_ai;
		DROP TRIGGER IF EXISTS Document_ad;
		DROP TRIGGER IF EXISTS Document_au;
		DROP TABLE IF EXISTS DocumentIndex;
		DROP TABLE IF EXISTS DocumentIndex_config;
		DROP TABLE IF EXISTS DocumentIndex_content;
		DROP TABLE IF EXISTS DocumentIndex_data;
		DROP TABLE IF EXISTS DocumentIndex_docsize;
		DROP TABLE IF EXISTS DocumentIndex_idx;
	`);
	
	console.log('✅ [Pre-Push] Safely cleared FTS5 tables and triggers for Prisma compatibility.');
	db.close();
} catch (e) {
	console.warn(`⚠️ [Pre-Push] Could not drop FTS tables (${e.message}). Skipping.`);
}