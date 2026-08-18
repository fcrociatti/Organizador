const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurado no .env — gere um valor aleatório antes de subir o servidor.');
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function register({ email, password, name }) {
  if (!isValidEmail(email)) {
    const err = new Error('E-mail inválido.');
    err.status = 400;
    throw err;
  }
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('A senha precisa ter pelo menos 8 caracteres.');
    err.status = 400;
    throw err;
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing.length > 0) {
    const err = new Error('Já existe uma conta com esse e-mail.');
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = uuidv4();

  await pool.query(
    'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
    [id, email.toLowerCase(), passwordHash, name || null]
  );

  const user = { id, email: email.toLowerCase(), name: name || null };
  const token = signToken(user);
  return { user, token };
}

async function login({ email, password }) {
  if (!isValidEmail(email) || typeof password !== 'string') {
    const err = new Error('E-mail ou senha inválidos.');
    err.status = 401;
    throw err;
  }

  const [rows] = await pool.query(
    'SELECT id, email, name, password_hash FROM users WHERE email = ?',
    [email.toLowerCase()]
  );

  // Mensagem genérica de propósito — não revelar se o e-mail existe ou não.
  const genericError = () => {
    const err = new Error('E-mail ou senha inválidos.');
    err.status = 401;
    throw err;
  };

  if (rows.length === 0) genericError();

  const row = rows[0];
  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) genericError();

  const user = { id: row.id, email: row.email, name: row.name };
  const token = signToken(user);
  return { user, token };
}

// Middleware do Express que exige um Bearer token válido.
// Preenche req.user = { id, email } quando o token é válido.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

module.exports = { register, login, requireAuth };
