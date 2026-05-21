CREATE DATABASE IF NOT EXISTS confnf
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE confnf;

CREATE TABLE IF NOT EXISTS conf_usuario (
  id                INT NOT NULL AUTO_INCREMENT,
  usuario           VARCHAR(60) NOT NULL,
  nome              VARCHAR(120) NOT NULL,
  senha_hash        VARCHAR(128) DEFAULT NULL,
  pin_hash          VARCHAR(128) DEFAULT NULL,
  perfil            ENUM('conferente','supervisor','administrador') NOT NULL,
  ativo             TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_login      DATETIME DEFAULT NULL,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_conf_usuario_usuario (usuario),
  KEY idx_conf_usuario_perfil (perfil),
  KEY idx_conf_usuario_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conf_cabecalho (
  id                INT NOT NULL AUTO_INCREMENT,
  chave_nfe         VARCHAR(44) NOT NULL,
  nNF               VARCHAR(20) DEFAULT NULL,
  serie             VARCHAR(5) DEFAULT NULL,
  cnpj_emitente     VARCHAR(14) DEFAULT NULL,
  nome_emitente     VARCHAR(120) DEFAULT NULL,
  cnpj_destinatario VARCHAR(14) DEFAULT NULL,
  nome_destinatario VARCHAR(120) DEFAULT NULL,
  dhEmi             DATETIME DEFAULT NULL,
  vNF               DECIMAL(15,2) DEFAULT NULL,
  qVol              INT DEFAULT NULL,
  pesoB             DECIMAL(10,3) DEFAULT NULL,
  id_conferente     INT DEFAULT NULL,
  id_supervisor     INT DEFAULT NULL,
  doca              VARCHAR(20) DEFAULT NULL,
  dt_inicio         DATETIME DEFAULT NULL,
  dt_fim            DATETIME DEFAULT NULL,
  status            ENUM('aberta','aguard_aprovacao','recontagem','aprovada','recusada') NOT NULL DEFAULT 'aberta',
  obs               TEXT,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_conf_cabecalho_chave_status (chave_nfe, status),
  KEY idx_conf_cabecalho_chave (chave_nfe),
  KEY idx_conf_cabecalho_status (status),
  KEY idx_conf_cabecalho_conferente (id_conferente),
  KEY idx_conf_cabecalho_supervisor (id_supervisor),
  CONSTRAINT fk_conf_cabecalho_conferente FOREIGN KEY (id_conferente) REFERENCES conf_usuario (id),
  CONSTRAINT fk_conf_cabecalho_supervisor FOREIGN KEY (id_supervisor) REFERENCES conf_usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conf_itens (
  id                INT NOT NULL AUTO_INCREMENT,
  id_cabecalho      INT NOT NULL,
  nItem             INT DEFAULT NULL,
  cProd             VARCHAR(30) DEFAULT NULL,
  cEAN              VARCHAR(20) DEFAULT NULL,
  cEANTrib          VARCHAR(20) DEFAULT NULL,
  xProd             VARCHAR(160) DEFAULT NULL,
  NCM               VARCHAR(8) DEFAULT NULL,
  CFOP              VARCHAR(5) DEFAULT NULL,
  CST_ICMS          VARCHAR(3) DEFAULT NULL,
  uCom              VARCHAR(6) DEFAULT NULL,
  qNF               DECIMAL(12,4) DEFAULT NULL,
  vUnCom            DECIMAL(15,4) DEFAULT NULL,
  vProd             DECIMAL(15,2) DEFAULT NULL,
  qt_conferida      DECIMAL(12,4) DEFAULT NULL,
  qt_estoque_erp    DECIMAL(12,4) DEFAULT NULL,
  unid_erp          VARCHAR(6) DEFAULT NULL,
  fator_aplicado    DECIMAL(12,4) DEFAULT NULL,
  status            ENUM('pendente','conferido','divergente','extra','devolvido','recontagem') NOT NULL DEFAULT 'pendente',
  dt_conferencia    DATETIME DEFAULT NULL,
  obs               TEXT,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conf_itens_cabecalho (id_cabecalho),
  KEY idx_conf_itens_status (status),
  KEY idx_conf_itens_ceans (cEAN, cEANTrib),
  KEY idx_conf_itens_produto (cProd),
  CONSTRAINT fk_conf_itens_cabecalho FOREIGN KEY (id_cabecalho) REFERENCES conf_cabecalho (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conf_extra (
  id                INT NOT NULL AUTO_INCREMENT,
  id_cabecalho      INT NOT NULL,
  cEAN              VARCHAR(20) DEFAULT NULL,
  xProd             VARCHAR(160) DEFAULT NULL,
  qt_conferida      DECIMAL(12,4) DEFAULT NULL,
  dt_registro       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  obs               TEXT,
  PRIMARY KEY (id),
  KEY idx_conf_extra_cabecalho (id_cabecalho),
  CONSTRAINT fk_conf_extra_cabecalho FOREIGN KEY (id_cabecalho) REFERENCES conf_cabecalho (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conf_item_lote (
  id                INT NOT NULL AUTO_INCREMENT,
  id_item           INT NOT NULL,
  lote              VARCHAR(60) DEFAULT NULL,
  dt_validade       DATE DEFAULT NULL,
  qt_informada      DECIMAL(12,4) DEFAULT NULL,
  unidade           VARCHAR(6) DEFAULT NULL,
  obs               TEXT,
  criado_em         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conf_item_lote_item (id_item),
  CONSTRAINT fk_conf_item_lote_item FOREIGN KEY (id_item) REFERENCES conf_itens (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produto_embalagem (
  id                  INT NOT NULL AUTO_INCREMENT,
  cnpj_fornecedor     VARCHAR(14) NOT NULL,
  cProd_fornecedor    VARCHAR(30) NOT NULL,
  cEAN_fornecedor     VARCHAR(20) DEFAULT NULL,
  descricao_forn      VARCHAR(160) DEFAULT NULL,
  unid_forn           VARCHAR(6) NOT NULL,
  id_produto_erp      INT NOT NULL,
  cEAN_unitario       VARCHAR(20) DEFAULT NULL,
  unid_erp            VARCHAR(6) NOT NULL,
  tipo_conversao      ENUM('fixo','peso','nenhum') NOT NULL DEFAULT 'fixo',
  fator_conversao     DECIMAL(12,4) DEFAULT NULL,
  peso_medio_un       DECIMAL(10,4) DEFAULT NULL,
  ativo               TINYINT(1) NOT NULL DEFAULT 1,
  obs                 TEXT,
  PRIMARY KEY (id),
  UNIQUE KEY uk_produto_embalagem_forn_prod (cnpj_fornecedor, cProd_fornecedor),
  KEY idx_produto_embalagem_ean_forn (cEAN_fornecedor),
  KEY idx_produto_embalagem_ean_unitario (cEAN_unitario),
  KEY idx_produto_embalagem_produto_erp (id_produto_erp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conf_log_supervisor (
  id                INT NOT NULL AUTO_INCREMENT,
  id_cabecalho      INT NOT NULL,
  id_item           INT DEFAULT NULL,
  id_supervisor     INT NOT NULL,
  dt_acao           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acao              ENUM('aceitar','devolver','recontagem','aprovar_tudo','rejeitar_nf','forcar_nf') NOT NULL,
  valor_antes       DECIMAL(12,4) DEFAULT NULL,
  valor_depois      DECIMAL(12,4) DEFAULT NULL,
  justificativa     TEXT,
  hash_integridade  VARCHAR(128) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_conf_log_cabecalho (id_cabecalho),
  KEY idx_conf_log_item (id_item),
  KEY idx_conf_log_supervisor (id_supervisor),
  CONSTRAINT fk_conf_log_cabecalho FOREIGN KEY (id_cabecalho) REFERENCES conf_cabecalho (id),
  CONSTRAINT fk_conf_log_item FOREIGN KEY (id_item) REFERENCES conf_itens (id),
  CONSTRAINT fk_conf_log_supervisor FOREIGN KEY (id_supervisor) REFERENCES conf_usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO conf_usuario (usuario, nome, senha_hash, pin_hash, perfil, ativo)
VALUES
  ('conferente', 'Conferente MVP', SHA2('123456', 256), SHA2('1234', 256), 'conferente', 1),
  ('supervisor', 'Supervisor MVP', SHA2('123456', 256), SHA2('4321', 256), 'supervisor', 1),
  ('admin', 'Administrador MVP', SHA2('123456', 256), SHA2('9999', 256), 'administrador', 1)
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome),
  senha_hash = VALUES(senha_hash),
  pin_hash = VALUES(pin_hash),
  perfil = VALUES(perfil),
  ativo = VALUES(ativo);
