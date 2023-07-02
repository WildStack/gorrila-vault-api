import * as path from 'path';
import * as fs from 'fs';

import { Pool, PoolConfig, QueryResult } from 'pg';
import { Kysely, Migrator, PostgresDialect, FileMigrationProvider, MigrationResultSet, sql } from 'kysely';
import { Logger } from '@nestjs/common';
import { formatDate } from './helper';

const migrationFolder = path.join(__dirname, '../migrations');
const migrationLogger = new Logger('Migration logger');

export async function migrateCommand(
  config: PoolConfig,
  type: 'latest' | 'oneUp' | 'oneDown',
  options?: { dontExit?: boolean },
) {
  const { db, migrator } = getMigrator(config);
  let migrationResult: MigrationResultSet | null = null;

  // check database existence
  await checkDatabaseExistence(config);

  // check connection
  await checkConnection(db, config.database as string);

  switch (type) {
    case 'latest':
      migrationResult = await migrator.migrateToLatest();
      break;
    case 'oneUp':
      migrationResult = await migrator.migrateUp();
      break;
    case 'oneDown':
      migrationResult = await migrator.migrateDown();
      break;
    default:
      migrationResult = null;
      break;
  }

  if (!migrationResult) {
    migrationLogger.error('Something went wrong');
    process.exit(0);
  }

  const { error, results } = migrationResult;

  if (error) {
    migrationLogger.error('failed to migrate');
    migrationLogger.error(error);
    await db.destroy();
    process.exit(0);
  }

  results?.forEach(it => {
    if (it.status === 'Success') {
      migrationLogger.verbose(`Migration "${it.migrationName}" was executed successfully`);
    }

    if (it.status === 'Error') {
      migrationLogger.error(`Failed to execute migration "${it.migrationName}"`);
    }
  });

  await db.destroy();

  migrationLogger.verbose(`Completed migration running`);
  await getMigrations(config);

  if (!options?.dontExit) {
    process.exit(1);
  }
}

export function createMigrationFile(migrationName: string) {
  const fileName = `${Date.now()}-${migrationName}.ts`;
  const filePath = `${migrationFolder}/${fileName}`;

  // Create the migration file
  fs.writeFileSync(
    filePath,
    `import { Kysely } from 'kysely';\n\nexport async function up(db: Kysely<any>): Promise<void> {\n\t// Migration code\n}\n\nexport async function down(db: Kysely<any>): Promise<void> {\n\t// Migration code\n}`,
  );

  migrationLogger.verbose(`Migration file created: ${fileName}`);
  migrationLogger.verbose(path.relative(process.cwd(), filePath)); // relative path from src
}

function getMigrator(config: PoolConfig): { migrator: Migrator; db: Kysely<unknown> } {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool(config) }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs: fs.promises,
      path,
      migrationFolder,
    }),
  });

  return { migrator, db };
}

async function getMigrations(config: PoolConfig) {
  const { db, migrator } = getMigrator(config);

  const migrationResult = await migrator.getMigrations();

  if (migrationResult.length) {
    migrationLogger.verbose('Applied migrations: ');
    migrationResult?.forEach(({ name, executedAt }) => {
      if (!executedAt) {
        migrationLogger.warn(`\t{ Not applied yet fileName: ${name} }`);
      } else {
        migrationLogger.verbose(`\t{ FileName: ${name} : Applied yet: ${formatDate(executedAt)} }`);
      }
    });
  } else {
    migrationLogger.verbose('No migration found');
  }

  await db.destroy();
}

async function checkConnection(db: Kysely<unknown>, dbName: string) {
  // check connection
  try {
    await sql`select 1`.execute(db);
    migrationLogger.verbose(`Database connection to ${dbName} sucessfull `);
  } catch (error) {
    migrationLogger.error('Connection error');
  }
}

async function checkDatabaseExistence(config: PoolConfig) {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({
        database: 'postgres',
        host: config.host,
        user: config.user,
        password: config.password,
        port: config.port,
        max: config.max,
      }),
    }),
  });

  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    migrationLogger.error(`Connection to database postgres for checking ${config.database} existence error`);
  }

  // check database existence (if not create it)
  try {
    const dbs = (await sql`select datname from pg_database;`.execute(db)) as QueryResult<{ datname: string }>;
    const dbNames = dbs.rows.map(e => e.datname);

    if (!dbNames.includes(config.database || '')) {
      migrationLogger.error(`Migration with name ${config.database} does not exist`);
      process.exit(0);
    }
  } catch (error) {
    console.log(error);
    process.exit(0);
  }
}
