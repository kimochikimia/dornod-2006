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
  occupation VARCHAR(500) NULL,
  professions TEXT NULL,
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

-- Мэдээ, сэтгэгдлийн reaction (нэг хүн нэг зүйлд нэг reaction)
CREATE TABLE IF NOT EXISTS reactions (
  target_type ENUM('news','comment') NOT NULL,
  target_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_type, target_id, user_id),
  CONSTRAINT fk_reaction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Мэдээний сэтгэгдэл (нэвтэрсэн хэрэглэгч бичнэ)
CREATE TABLE IF NOT EXISTS news_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  announcement_id INT NOT NULL,
  user_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_comment_news (announcement_id, created_at),
  CONSTRAINT fk_comment_news FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  number VARCHAR(20) NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  seats INT NOT NULL DEFAULT 7,
  max_choices INT NOT NULL DEFAULT 7,
  min_turnout INT NOT NULL DEFAULT 50,
  phase ENUM('draft','nomination','acceptance','voting','closed') NOT NULL DEFAULT 'draft',
  show_live_results TINYINT(1) NOT NULL DEFAULT 1,
  eligible_count INT NULL,
  voting_started_at TIMESTAMP NULL,
  voting_ended_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_election_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  election_id INT NOT NULL,
  user_id INT NOT NULL,
  status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  statement TEXT NULL,
  votes INT NOT NULL DEFAULT 0,
  last_vote_at TIMESTAMP(3) NULL,
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
  location VARCHAR(200) NULL,
  map_url VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Төлөв бүрийн эрх (админ самбараас тохируулна)
CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(20) NOT NULL,
  permission VARCHAR(50) NOT NULL,
  PRIMARY KEY (role, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Эрхийн бүлэг: төлвөөс үл хамааран тухайн хэрэглэгчид нэмж олгосон эрх
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT NOT NULL,
  permission VARCHAR(50) NOT NULL,
  added_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission),
  KEY idx_userperm_perm (permission),
  CONSTRAINT fk_userperm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_userperm_by FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
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
  user_id INT NOT NULL,
  position VARCHAR(255) NOT NULL DEFAULT 'Гишүүн',
  responsibilities TEXT NULL,
  term VARCHAR(50) NULL,
  sort_order INT NOT NULL DEFAULT 100,
  election_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_board_member (user_id, election_id),
  CONSTRAINT fk_board_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_board_election FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Удирдах зөвлөлийн албан тушаалууд (админ үүсгэнэ). board_members.post = code
CREATE TABLE IF NOT EXISTS board_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  election_id INT NULL,
  code VARCHAR(20) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'member',
  seats INT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Удирдах зөвлөлийн бүтэц: албан тушаалуудын мод (нэгж бүр нэг албан тушаал)
CREATE TABLE IF NOT EXISTS board_units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  election_id INT NULL,
  parent_id INT NULL,
  post_id INT NULL,
  name VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_unit_parent FOREIGN KEY (parent_id) REFERENCES board_units(id) ON DELETE SET NULL,
  CONSTRAINT fk_unit_post FOREIGN KEY (post_id) REFERENCES board_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Томилгоо: нэг гишүүн олон албан тушаал хашиж болно (board_members.post/position нь хураангуй)
CREATE TABLE IF NOT EXISTS board_appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  post_id INT NOT NULL,
  appointed_at DATE NULL,
  decision VARCHAR(200) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_appointment (member_id, post_id),
  CONSTRAINT fk_appt_member FOREIGN KEY (member_id) REFERENCES board_members(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_post FOREIGN KEY (post_id) REFERENCES board_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Зөвлөлийн бодлогын баримт бичиг (дүрэм, журам, төлөвлөгөө, тайлан)
CREATE TABLE IF NOT EXISTS board_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  election_id INT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  title VARCHAR(200) NOT NULL,
  purpose VARCHAR(500) NULL,
  status ENUM('draft','approved') NOT NULL DEFAULT 'draft',
  doc_number VARCHAR(50) NULL,
  approved_at DATE NULL,
  decision VARCHAR(200) NULL,
  content MEDIUMTEXT NULL,
  file_name VARCHAR(200) NULL,
  file_mime VARCHAR(100) NULL,
  file_size INT NULL,
  file_data LONGBLOB NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Фото альбом (нүүр хуудас, /gallery). Зургийг өгөгдлийн санд хадгална (бүтэн + жижиг хувилбар).
CREATE TABLE IF NOT EXISTS gallery_albums (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL,
  event_date DATE NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  cover_photo_id INT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_album_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gallery_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  album_id INT NOT NULL,
  caption VARCHAR(300) NULL,
  width INT NULL,
  height INT NULL,
  data MEDIUMBLOB NOT NULL,
  thumb MEDIUMBLOB NOT NULL,
  uploaded_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_photo_album (album_id, created_at),
  CONSTRAINT fk_photo_album FOREIGN KEY (album_id) REFERENCES gallery_albums(id) ON DELETE CASCADE,
  CONSTRAINT fk_gphoto_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Мэдээний зургууд (нэг мэдээнд олон зураг; эхнийх нь нүүр зураг)
CREATE TABLE IF NOT EXISTS news_photos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  announcement_id INT NOT NULL,
  width INT NULL,
  height INT NULL,
  data MEDIUMBLOB NOT NULL,
  thumb MEDIUMBLOB NOT NULL,
  uploaded_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_nphoto_news (announcement_id, id),
  CONSTRAINT fk_nphoto_news FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  CONSTRAINT fk_nphoto_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Сайн үйлсийн аян хөтөлбөр
CREATE TABLE IF NOT EXISTS campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NULL,
  body TEXT NULL,
  goal_amount BIGINT NULL,
  needs VARCHAR(1000) NULL,
  bank_info VARCHAR(1000) NULL,
  contact VARCHAR(300) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status ENUM('active','closed') NOT NULL DEFAULT 'active',
  cover MEDIUMBLOB NULL,
  cover_thumb MEDIUMBLOB NULL,
  cover_v INT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_campaign_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Аянд үзүүлсэн дэмжлэг: мөнгө эсвэл бусад зүйл. Төгсөгч мэдэгдвэл хянагдана (pending), удирдлага баталгаажуулна.
CREATE TABLE IF NOT EXISTS campaign_contributions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  user_id INT NULL,
  donor_name VARCHAR(150) NULL,
  donor_contact VARCHAR(150) NULL,
  kind ENUM('money','item') NOT NULL DEFAULT 'money',
  amount BIGINT NULL,
  item_desc VARCHAR(300) NULL,
  note VARCHAR(500) NULL,
  anonymous TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_contrib_campaign (campaign_id, status, created_at),
  INDEX idx_contrib_user (user_id),
  CONSTRAINT fk_contrib_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_contrib_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_contrib_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Тасалбартай (төлбөртэй) арга хэмжээ. seating: 'none' — суудалгүй (тоо ширхгээр), 'seated' — суудлын плантай.
-- layout: суудлын план (JSON) — ширээ, эгнээ, талбайнууд (public/js/seatmap.js).
CREATE TABLE IF NOT EXISTS ticket_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  summary VARCHAR(500) NULL,
  body TEXT NULL,
  venue VARCHAR(300) NULL,
  event_at DATETIME NOT NULL,
  sale_start DATETIME NULL,
  sale_end DATETIME NOT NULL,
  seating ENUM('none','seated') NOT NULL DEFAULT 'none',
  price BIGINT NOT NULL DEFAULT 0,
  capacity INT NULL,
  max_per_order INT NOT NULL DEFAULT 10,
  hold_hours INT NOT NULL DEFAULT 24,
  layout MEDIUMTEXT NULL,
  bank_name VARCHAR(100) NULL,
  bank_account VARCHAR(60) NULL,
  bank_holder VARCHAR(150) NULL,
  contact VARCHAR(300) NULL,
  status ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tevent_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Тасалбарын захиалга. code — гүйлгээний утгад бичих давтагдашгүй код.
-- pending: төлбөр хүлээгдэж буй (expires_at хүртэл суудал/тоо түгжигдэнэ), paid: төлсөн, cancelled: цуцлагдсан/хугацаа дууссан.
-- seats: захиалсан суудлууд (JSON) — цуцлагдсан ч түүхэнд үлдэнэ.
CREATE TABLE IF NOT EXISTS ticket_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  code VARCHAR(12) NOT NULL,
  user_id INT NULL,
  buyer_name VARCHAR(150) NOT NULL,
  buyer_phone VARCHAR(40) NULL,
  quantity INT NOT NULL,
  amount BIGINT NOT NULL,
  seats TEXT NULL,
  note VARCHAR(500) NULL,
  status ENUM('pending','paid','cancelled') NOT NULL DEFAULT 'pending',
  cancel_reason VARCHAR(20) NULL,
  expires_at DATETIME NULL,
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ticket_code (code),
  INDEX idx_torder_event (event_id, status, created_at),
  INDEX idx_torder_user (user_id),
  CONSTRAINT fk_torder_event FOREIGN KEY (event_id) REFERENCES ticket_events(id) ON DELETE CASCADE,
  CONSTRAINT fk_torder_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_torder_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Идэвхтэй (pending/paid) захиалгын эзэлсэн суудал. (event_id, seat_key) давтагдашгүй тул нэг суудлыг хоёр хүн авч чадахгүй.
CREATE TABLE IF NOT EXISTS ticket_seat_locks (
  event_id INT NOT NULL,
  seat_key VARCHAR(40) NOT NULL,
  order_id INT NOT NULL,
  PRIMARY KEY (event_id, seat_key),
  INDEX idx_tlock_order (order_id),
  CONSTRAINT fk_tlock_event FOREIGN KEY (event_id) REFERENCES ticket_events(id) ON DELETE CASCADE,
  CONSTRAINT fk_tlock_order FOREIGN KEY (order_id) REFERENCES ticket_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Тасалбар шалгаж оруулсан түүх (QR уншуулж "Орсон" дарах бүрт нэг мөр). count — тэр удаад орсон хүний тоо.
CREATE TABLE IF NOT EXISTS ticket_checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  count INT NOT NULL DEFAULT 1,
  checked_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tcheck_order (order_id),
  CONSTRAINT fk_tcheck_order FOREIGN KEY (order_id) REFERENCES ticket_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_tcheck_user FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
