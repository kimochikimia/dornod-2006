CREATE TABLE IF NOT EXISTS schools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  surname VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(120) NULL,
  password_hash VARCHAR(100) NOT NULL,
  school_id INT NULL,
  class_name VARCHAR(20) NULL,
  occupation VARCHAR(150) NULL,
  city VARCHAR(100) NULL,
  bio TEXT NULL,
  role ENUM('member','moderator','subadmin','admin') NOT NULL DEFAULT 'member',
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(128) PRIMARY KEY,
  expires BIGINT NOT NULL,
  data MEDIUMTEXT NOT NULL,
  INDEX idx_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  author_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ann_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS change_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message TEXT NOT NULL,
  status ENUM('open','done') NOT NULL DEFAULT 'open',
  admin_note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS elections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  seats INT NOT NULL DEFAULT 7,
  max_choices INT NOT NULL DEFAULT 7,
  phase ENUM('draft','nomination','acceptance','voting','closed') NOT NULL DEFAULT 'draft',
  show_live_results TINYINT(1) NOT NULL DEFAULT 1,
  eligible_count INT NULL,
  voting_started_at TIMESTAMP NULL,
  voting_ended_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  election_id INT NOT NULL,
  user_id INT NOT NULL,
  status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  statement TEXT NULL,
  votes INT NOT NULL DEFAULT 0,
  responded_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate (election_id, user_id),
  CONSTRAINT fk_cand_election FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE,
  CONSTRAINT fk_cand_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nominations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id INT NOT NULL,
  nominator_id INT NOT NULL,
  reason VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nomination (candidate_id, nominator_id),
  CONSTRAINT fk_nom_candidate FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  CONSTRAINT fk_nom_user FOREIGN KEY (nominator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Нууц санал: хэн санал өгснийг л тэмдэглэнэ, хэнд өгснийг хадгалахгүй.
-- Саналын тоо candidates.votes дээр шууд нэмэгдэнэ.
CREATE TABLE IF NOT EXISTS ballots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  election_id INT NOT NULL,
  voter_id INT NULL,
  school_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ballot (election_id, voter_id),
  CONSTRAINT fk_ballot_election FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE,
  CONSTRAINT fk_ballot_user FOREIGN KEY (voter_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Төлөвлөгөөт ажил (task) болон чухал үе (milestone)
CREATE TABLE IF NOT EXISTS plan_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  kind ENUM('task','milestone') NOT NULL DEFAULT 'task',
  start_date DATE NOT NULL,
  end_date DATE NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#4f7cff',
  responsible VARCHAR(150) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Төлөв бүрийн эрх (админ самбараас тохируулна)
CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(20) NOT NULL,
  permission VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Төгсөгчийн зураг (Railway-ийн файлын систем түр зуурынх тул өгөгдлийн санд хадгална)
CREATE TABLE IF NOT EXISTS user_photos (
  user_id INT PRIMARY KEY,
  mime VARCHAR(30) NOT NULL,
  data MEDIUMBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_photo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Удирдах зөвлөлийн гишүүд
CREATE TABLE IF NOT EXISTS board_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  position VARCHAR(100) NOT NULL DEFAULT 'Гишүүн',
  responsibilities TEXT NULL,
  term VARCHAR(50) NULL,
  sort_order INT NOT NULL DEFAULT 100,
  election_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_board_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_board_election FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
