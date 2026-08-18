const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth); // todas as rotas de tarefas exigem login

const VALID_STATUS = ['afazer', 'andamento', 'concluida'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMPORT = 500;

function validateTaskInput(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.description !== undefined) {
    if (typeof body.description !== 'string' || !body.description.trim()) {
      const err = new Error('description é obrigatória.');
      err.status = 400;
      throw err;
    }
    out.description = body.description.trim();
  }

  if (!partial || body.criticality !== undefined) {
    const c = Number(body.criticality);
    if (![1, 2, 3, 4].includes(c)) {
      const err = new Error('criticality deve ser 1, 2, 3 ou 4.');
      err.status = 400;
      throw err;
    }
    out.criticality = c;
  }

  if (!partial || body.effort !== undefined) {
    const e = Number(body.effort);
    if (![1, 2, 3, 4, 5].includes(e)) {
      const err = new Error('effort deve ser de 1 a 5.');
      err.status = 400;
      throw err;
    }
    out.effort = e;
  }

  if (!partial || body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) {
      const err = new Error(`status deve ser um de: ${VALID_STATUS.join(', ')}.`);
      err.status = 400;
      throw err;
    }
    out.status = body.status;
  }

  if (!partial || body.date !== undefined) {
    if (!DATE_RE.test(body.date)) {
      const err = new Error('date deve estar no formato YYYY-MM-DD.');
      err.status = 400;
      throw err;
    }
    out.date = body.date;
  }

  // dueDate é opcional em qualquer caso: null/'' limpa o prazo.
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === '') {
      out.dueDate = null;
    } else if (!DATE_RE.test(body.dueDate)) {
      const err = new Error('dueDate deve estar no formato YYYY-MM-DD (ou null para remover o prazo).');
      err.status = 400;
      throw err;
    } else {
      out.dueDate = body.dueDate;
    }
  }

  // O prazo não pode ser anterior ao dia em que a tarefa está agendada —
  // isso só geraria uma tarefa nascida atrasada por engano de digitação.
  if (out.dueDate && out.date && out.dueDate < out.date) {
    const err = new Error('dueDate não pode ser anterior a date.');
    err.status = 400;
    throw err;
  }

  return out;
}

const TASK_COLUMNS = `id, description, criticality, effort, status,
       DATE_FORMAT(task_date, '%Y-%m-%d') AS date,
       DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate,
       completed_at AS completedAt`;

// GET /api/tasks?date=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const { date } = req.query;
    if (!DATE_RE.test(date || '')) {
      return res.status(400).json({ error: 'Informe ?date=YYYY-MM-DD.' });
    }
    const [rows] = await pool.query(
      `SELECT ${TASK_COLUMNS}
       FROM tasks WHERE user_id = ? AND task_date = ?
       ORDER BY criticality DESC, effort ASC`,
      [req.user.id, date]
    );
    res.json({ tasks: rows });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar tarefas.' });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    const data = validateTaskInput(req.body);
    const id = uuidv4();
    await pool.query(
      `INSERT INTO tasks (id, user_id, description, criticality, effort, status, task_date, due_date, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, data.description, data.criticality, data.effort, data.status, data.date,
       data.dueDate ?? null, data.status === 'concluida' ? new Date() : null]
    );
    res.status(201).json({ task: { id, dueDate: null, ...data } });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erro ao criar tarefa.' });
  }
});

// PATCH /api/tasks/:id  (aceita atualização parcial — usado por editar, mudar status e transbordar)
router.patch('/:id', async (req, res) => {
  try {
    const data = validateTaskInput(req.body, { partial: true });
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    }

    // Numa atualização parcial só um dos dois campos pode vir; buscamos o valor
    // atual do outro para conferir que o prazo não acaba antes do dia da tarefa.
    if (data.dueDate !== undefined || data.date !== undefined) {
      const [current] = await pool.query(
        `SELECT DATE_FORMAT(task_date, '%Y-%m-%d') AS date,
                DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate
         FROM tasks WHERE id = ? AND user_id = ?`,
        [req.params.id, req.user.id]
      );
      if (current.length === 0) {
        return res.status(404).json({ error: 'Tarefa não encontrada.' });
      }
      const finalDate = data.date !== undefined ? data.date : current[0].date;
      const finalDue = data.dueDate !== undefined ? data.dueDate : current[0].dueDate;
      if (finalDue && finalDue < finalDate) {
        return res.status(400).json({ error: 'dueDate não pode ser anterior a date.' });
      }
    }

    const fieldMap = {
      description: 'description', criticality: 'criticality', effort: 'effort',
      status: 'status', date: 'task_date', dueDate: 'due_date',
    };
    const setClauses = Object.keys(data).map(k => `${fieldMap[k]} = ?`);
    const values = Object.values(data);

    // Marca/desmarca o carimbo de conclusão junto com a mudança de status,
    // para que o histórico saiba se o prazo foi cumprido.
    if (data.status !== undefined) {
      if (data.status === 'concluida') {
        setClauses.push('completed_at = COALESCE(completed_at, ?)');
        values.push(new Date());
      } else {
        setClauses.push('completed_at = NULL');
      }
    }

    const [result] = await pool.query(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`,
      [...values, req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erro ao atualizar tarefa.' });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao excluir tarefa.' });
  }
});

// POST /api/tasks/import  { tasks: [{description, criticality, effort, status, date}, ...] }
router.post('/import', async (req, res) => {
  try {
    const list = req.body.tasks;
    if (!Array.isArray(list)) {
      return res.status(400).json({ error: 'tasks deve ser um array.' });
    }
    if (list.length > MAX_IMPORT) {
      return res.status(400).json({ error: `Importe no máximo ${MAX_IMPORT} tarefas por vez.` });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const inserted = [];
      for (const item of list) {
        const data = validateTaskInput(item);
        const id = uuidv4();
        await conn.query(
          `INSERT INTO tasks (id, user_id, description, criticality, effort, status, task_date, due_date, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, req.user.id, data.description, data.criticality, data.effort, data.status, data.date,
           data.dueDate ?? null, data.status === 'concluida' ? new Date() : null]
        );
        inserted.push({ id, dueDate: null, ...data });
      }
      await conn.commit();
      res.status(201).json({ imported: inserted.length, tasks: inserted });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erro ao importar tarefas.' });
  }
});

// GET /api/tasks/deadlines?ref=YYYY-MM-DD&days=7
// Agenda de prazos: o que está atrasado e o que vence nos próximos N dias.
// Tarefas concluídas não entram — prazo cumprido não é mais cobrança.
router.get('/deadlines', async (req, res) => {
  try {
    const ref = DATE_RE.test(req.query.ref || '') ? req.query.ref : null;
    if (!ref) {
      return res.status(400).json({ error: 'Informe ?ref=YYYY-MM-DD (a data considerada "hoje").' });
    }
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 90);

    const [rows] = await pool.query(
      `SELECT ${TASK_COLUMNS}, DATEDIFF(due_date, ?) AS daysLeft
       FROM tasks
       WHERE user_id = ?
         AND due_date IS NOT NULL
         AND status <> 'concluida'
         AND due_date <= DATE_ADD(?, INTERVAL ? DAY)
       ORDER BY due_date ASC, criticality DESC, effort ASC`,
      [ref, req.user.id, ref, days]
    );

    const overdue = rows.filter(r => r.daysLeft < 0);
    const dueToday = rows.filter(r => r.daysLeft === 0);
    const upcoming = rows.filter(r => r.daysLeft > 0);

    res.json({
      ref,
      days,
      counts: { overdue: overdue.length, dueToday: dueToday.length, upcoming: upcoming.length },
      overdue,
      dueToday,
      upcoming,
    });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar prazos.' });
  }
});

module.exports = router;
