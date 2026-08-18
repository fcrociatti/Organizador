const express = require('express');
const { register, login, requireAuth } = require('../auth');
const { pool } = require('../db');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const { user, token } = await register({ email, password, name });
    res.status(201).json({ user, token });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erro ao registrar usuário.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await login({ email, password });
    res.json({ user, token });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erro ao fazer login.' });
  }
});

// Retorna os dados do usuário logado — útil pro frontend confirmar
// se o token salvo ainda é válido ao abrir o app.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, name, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar usuário.' });
  }
});

module.exports = router;
