const mysql = require('mysql2/promise');
require('dotenv').config();

// O TiDB Cloud Serverless exige conexão TLS.
// minVersion TLSv1.2 é o que a documentação oficial do TiDB Cloud recomenda
// para o driver mysql2 (não é necessário apontar um certificado CA manualmente
// para o endpoint público deles).
const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
});

async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    console.log('[db] Conectado ao TiDB Cloud com sucesso.');
  } finally {
    conn.release();
  }
}

module.exports = { pool, testConnection };
