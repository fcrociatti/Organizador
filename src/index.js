require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { testConnection } = require('./db');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);

// handler de erro genérico, por segurança (nunca vaza detalhes internos)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

const PORT = process.env.PORT || 3000;

testConnection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[api] Rodando na porta ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[db] Falha ao conectar no TiDB Cloud:', err.message);
    process.exit(1);
  });
