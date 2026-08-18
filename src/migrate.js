// Roda o schema.sql contra o banco configurado no .env
// Uso: npm run migrate
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

// Alterações aplicadas em bancos que já existem (o schema.sql só cobre banco novo).
// Cada entrada é idempotente: checamos antes se a coluna/índice já existe.
const COLUMN_MIGRATIONS = [
  { table: 'tasks', column: 'due_date',     ddl: 'ALTER TABLE tasks ADD COLUMN due_date DATE NULL' },
  { table: 'tasks', column: 'completed_at', ddl: 'ALTER TABLE tasks ADD COLUMN completed_at TIMESTAMP NULL' },
];

const INDEX_MIGRATIONS = [
  { table: 'tasks', index: 'idx_user_due', ddl: 'CREATE INDEX idx_user_due ON tasks (user_id, due_date)' },
];

async function applyIncrementalMigrations(conn) {
  for (const m of COLUMN_MIGRATIONS) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [m.table, m.column]
    );
    if (rows.length > 0) continue;
    console.log('[migrate] Adicionando coluna', m.table + '.' + m.column);
    await conn.query(m.ddl);
  }

  for (const m of INDEX_MIGRATIONS) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
      [m.table, m.index]
    );
    if (rows.length > 0) continue;
    console.log('[migrate] Criando índice', m.index);
    await conn.query(m.ddl);
  }
}

async function migrate() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // mysql2 não roda múltiplas statements de uma vez por padrão nesse pool,
  // então separamos por ";" e executamos uma a uma.
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  const conn = await pool.getConnection();
  try {
    for (const stmt of statements) {
      console.log('[migrate] Executando:', stmt.slice(0, 60).replace(/\s+/g, ' '), '...');
      await conn.query(stmt);
    }
    await applyIncrementalMigrations(conn);
    console.log('[migrate] Schema aplicado com sucesso.');
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('[migrate] Falhou:', err.message);
  process.exit(1);
});
