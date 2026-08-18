-- Schema do Painel de Prioridades — compatível com TiDB Cloud (dialeto MySQL)

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36) PRIMARY KEY,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
);

CREATE TABLE IF NOT EXISTS tasks (
  id           VARCHAR(36) PRIMARY KEY,
  user_id      VARCHAR(36) NOT NULL,
  description  VARCHAR(500) NOT NULL,
  criticality  TINYINT NOT NULL,   -- 1=Baixa 2=Média 3=Alta 4=Crítica
  effort       TINYINT NOT NULL,   -- 1 a 5
  status       VARCHAR(20) NOT NULL, -- afazer | andamento | concluida
  task_date    DATE NOT NULL,      -- dia em que a tarefa aparece no painel
  due_date     DATE NULL,          -- prazo final (opcional); NULL = sem prazo
  completed_at TIMESTAMP NULL,     -- quando entrou em 'concluida' (para saber se cumpriu o prazo)
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_date (user_id, task_date),
  KEY idx_user_due (user_id, due_date),
  CONSTRAINT fk_tasks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
