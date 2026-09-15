-- CareerForge schema (MySQL 8 / MariaDB 10.6+)
-- Every statement is idempotent so migrate.js can be re-run safely.

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(190) NOT NULL,
  name          VARCHAR(120) DEFAULT NULL,
  slug          VARCHAR(120) DEFAULT NULL,
  phone         VARCHAR(24)  DEFAULT NULL,
  headline      VARCHAR(180) DEFAULT NULL,
  about         TEXT         DEFAULT NULL,
  avatar_url    VARCHAR(400) DEFAULT NULL,
  campus        VARCHAR(80)  DEFAULT NULL,
  branch        VARCHAR(120) DEFAULT NULL,
  reg_no        VARCHAR(60)  DEFAULT NULL,
  grad_year     SMALLINT     DEFAULT NULL,
  cgpa          DECIMAL(4,2) DEFAULT NULL,
  location      VARCHAR(120) DEFAULT NULL,
  open_to_work  TINYINT(1) NOT NULL DEFAULT 1,
  profile_public TINYINT(1) NOT NULL DEFAULT 1,
  role          ENUM('student','admin') NOT NULL DEFAULT 'student',
  status        ENUM('active','blocked') NOT NULL DEFAULT 'active',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  onboarded     TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_slug (slug),
  KEY idx_users_campus (campus),
  KEY idx_users_grad_year (grad_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otp_codes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(190) NOT NULL,
  code_hash   VARCHAR(120) NOT NULL,
  purpose     ENUM('login','signup') NOT NULL DEFAULT 'login',
  expires_at  DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ip          VARCHAR(64)  DEFAULT NULL,
  user_agent  VARCHAR(300) DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_email_created (email, created_at),
  KEY idx_otp_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            BIGINT UNSIGNED NOT NULL,
  refresh_token_hash VARCHAR(120) NOT NULL,
  ip                 VARCHAR(64)  DEFAULT NULL,
  user_agent         VARCHAR(300) DEFAULT NULL,
  expires_at         DATETIME NOT NULL,
  revoked_at         DATETIME DEFAULT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (refresh_token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-student profiling log: every meaningful action lands here.
CREATE TABLE IF NOT EXISTS activity_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED DEFAULT NULL,
  email      VARCHAR(190) DEFAULT NULL,
  action     VARCHAR(60)  NOT NULL,
  detail     JSON DEFAULT NULL,
  ip         VARCHAR(64)  DEFAULT NULL,
  user_agent VARCHAR(300) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_logs_user_created (user_id, created_at),
  KEY idx_logs_action (action),
  CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_links (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id  BIGINT UNSIGNED NOT NULL,
  platform ENUM('github','leetcode','codechef','hackerrank','linkedin','portfolio','other') NOT NULL,
  username VARCHAR(120) DEFAULT NULL,
  url      VARCHAR(400) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_link_user_platform (user_id, platform),
  CONSTRAINT fk_links_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS educations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  level       ENUM('ug','pg','intermediate','diploma','ssc','other') NOT NULL DEFAULT 'ug',
  institution VARCHAR(180) NOT NULL,
  degree      VARCHAR(120) DEFAULT NULL,
  branch      VARCHAR(120) DEFAULT NULL,
  start_year  SMALLINT DEFAULT NULL,
  end_year    SMALLINT DEFAULT NULL,
  score       DECIMAL(6,2) DEFAULT NULL,
  score_type  ENUM('cgpa','percentage') NOT NULL DEFAULT 'cgpa',
  location    VARCHAR(120) DEFAULT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_edu_user (user_id),
  CONSTRAINT fk_edu_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS skills (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(80) NOT NULL,
  category    ENUM('language','framework','database','tool','cloud','concept','soft','other') NOT NULL DEFAULT 'other',
  proficiency TINYINT UNSIGNED NOT NULL DEFAULT 3,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skill_user_name (user_id, name),
  CONSTRAINT fk_skill_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(180) NOT NULL,
  role        VARCHAR(120) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  tech        JSON DEFAULT NULL,
  highlights  JSON DEFAULT NULL,
  repo_url    VARCHAR(400) DEFAULT NULL,
  live_url    VARCHAR(400) DEFAULT NULL,
  start_date  DATE DEFAULT NULL,
  end_date    DATE DEFAULT NULL,
  featured    TINYINT(1) NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_proj_user (user_id),
  CONSTRAINT fk_proj_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS experiences (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  company     VARCHAR(180) NOT NULL,
  role        VARCHAR(150) NOT NULL,
  type        ENUM('internship','full-time','part-time','freelance','training') NOT NULL DEFAULT 'internship',
  location    VARCHAR(120) DEFAULT NULL,
  start_date  DATE DEFAULT NULL,
  end_date    DATE DEFAULT NULL,
  is_current  TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT DEFAULT NULL,
  highlights  JSON DEFAULT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_exp_user (user_id),
  CONSTRAINT fk_exp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS achievements (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(200) NOT NULL,
  issuer      VARCHAR(180) DEFAULT NULL,
  category    ENUM('award','certification','publication','hackathon','extracurricular','other') NOT NULL DEFAULT 'award',
  date        DATE DEFAULT NULL,
  description TEXT DEFAULT NULL,
  url         VARCHAR(400) DEFAULT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_ach_user (user_id),
  CONSTRAINT fk_ach_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cached LeetCode / CodeChef / GitHub stats. `status` tells the UI whether the
-- section holds real data, an unlinked account, or a username that does not exist.
CREATE TABLE IF NOT EXISTS coding_profiles (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  platform       ENUM('leetcode','codechef','github','hackerrank') NOT NULL,
  username       VARCHAR(120) DEFAULT NULL,
  status         ENUM('ok','not_found','unlinked','error') NOT NULL DEFAULT 'unlinked',
  solved_total   INT DEFAULT NULL,
  easy           INT DEFAULT NULL,
  medium         INT DEFAULT NULL,
  hard           INT DEFAULT NULL,
  contest_rating INT DEFAULT NULL,
  contest_count  INT DEFAULT NULL,
  global_rank    INT DEFAULT NULL,
  star_rating    DECIMAL(4,2) DEFAULT NULL,
  reputation     INT DEFAULT NULL,
  badges         VARCHAR(400) DEFAULT NULL,
  raw            JSON DEFAULT NULL,
  fetched_at     DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cp_user_platform (user_id, platform),
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resumes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(150) NOT NULL DEFAULT 'My Resume',
  template        VARCHAR(40)  NOT NULL DEFAULT 'ats-classic',
  accent          VARCHAR(9)   DEFAULT NULL,
  target_role     VARCHAR(150) DEFAULT NULL,
  job_description TEXT DEFAULT NULL,
  data            JSON NOT NULL,
  ats_score       TINYINT UNSIGNED DEFAULT NULL,
  ats_report      JSON DEFAULT NULL,
  is_default      TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_resume_user (user_id),
  CONSTRAINT fk_resume_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source      VARCHAR(60) NOT NULL DEFAULT 'internal',
  external_id VARCHAR(120) DEFAULT NULL,
  title       VARCHAR(200) NOT NULL,
  company     VARCHAR(180) NOT NULL,
  location    VARCHAR(180) DEFAULT NULL,
  work_mode   ENUM('onsite','remote','hybrid') NOT NULL DEFAULT 'onsite',
  job_type    ENUM('full-time','internship','contract') NOT NULL DEFAULT 'full-time',
  min_ctc     DECIMAL(6,2) DEFAULT NULL,
  max_ctc     DECIMAL(6,2) DEFAULT NULL,
  experience  VARCHAR(60) DEFAULT NULL,
  skills      JSON DEFAULT NULL,
  description TEXT DEFAULT NULL,
  apply_url   VARCHAR(500) DEFAULT NULL,
  posted_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME DEFAULT NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_job_source_ext (source, external_id),
  KEY idx_job_posted (posted_at),
  KEY idx_job_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_alerts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  active       TINYINT(1) NOT NULL DEFAULT 1,
  roles        JSON DEFAULT NULL,
  skills       JSON DEFAULT NULL,
  locations    JSON DEFAULT NULL,
  work_modes   JSON DEFAULT NULL,
  job_types    JSON DEFAULT NULL,
  min_ctc      DECIMAL(6,2) DEFAULT NULL,
  frequency    ENUM('daily','weekly','off') NOT NULL DEFAULT 'daily',
  send_hour    TINYINT UNSIGNED NOT NULL DEFAULT 8,
  last_sent_at DATETIME DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_user (user_id),
  CONSTRAINT fk_alert_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Placement cohort data (LPA7 / LPA8 imports)
--
-- These are institutional records, not accounts. A student_record exists with
-- no user_id until the student signs up and *claims* it — by signing in with a
-- matching email, or by entering their registration number. That keeps 600+
-- people out of the users table who never asked for an account, and keeps the
-- PII in these rows off every public endpoint.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cohorts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code          VARCHAR(40) NOT NULL,
  name          VARCHAR(160) NOT NULL,
  description   VARCHAR(400) DEFAULT NULL,
  source_file   VARCHAR(200) DEFAULT NULL,
  student_count INT NOT NULL DEFAULT 0,
  imported_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cohort_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_records (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cohort_id         BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED DEFAULT NULL,
  claimed_at        DATETIME DEFAULT NULL,

  reg_no            VARCHAR(40)  NOT NULL,
  name              VARCHAR(160) NOT NULL,
  branch            VARCHAR(60)  DEFAULT NULL,
  campus            VARCHAR(20)  DEFAULT NULL,

  company           VARCHAR(180) DEFAULT NULL,
  ctc               DECIMAL(6,2) DEFAULT NULL,

  -- PII: never returned by a public endpoint
  gender            VARCHAR(20)  DEFAULT NULL,
  date_of_birth     DATE         DEFAULT NULL,
  mobile            VARCHAR(30)  DEFAULT NULL,
  placement_email   VARCHAR(190) DEFAULT NULL,
  personal_email    VARCHAR(190) DEFAULT NULL,

  ug_cgpa           DECIMAL(4,2) DEFAULT NULL,
  inter_cgpa        DECIMAL(5,2) DEFAULT NULL,
  ssc_cgpa          DECIMAL(5,2) DEFAULT NULL,

  rank_overall      INT          DEFAULT NULL,
  target_band       VARCHAR(40)  DEFAULT NULL,
  near_next_band    VARCHAR(40)  DEFAULT NULL,
  readiness_index   DECIMAL(5,2) DEFAULT NULL,
  dsa_score         DECIMAL(6,2) DEFAULT NULL,
  cp_score          DECIMAL(6,2) DEFAULT NULL,
  crt_score         DECIMAL(6,2) DEFAULT NULL,
  dev_score         DECIMAL(6,2) DEFAULT NULL,
  consistency_score DECIMAL(6,2) DEFAULT NULL,
  academic_score    DECIMAL(6,2) DEFAULT NULL,
  crt_avg_pct       DECIMAL(6,2) DEFAULT NULL,
  crt_percentile    DECIMAL(6,2) DEFAULT NULL,
  crt_attendance    DECIMAL(6,2) DEFAULT NULL,

  strengths         TEXT DEFAULT NULL,
  gaps              TEXT DEFAULT NULL,
  plan_next_band    TEXT DEFAULT NULL,
  data_notes        TEXT DEFAULT NULL,

  raw               JSON DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_record_cohort_reg (cohort_id, reg_no),
  KEY idx_record_reg (reg_no),
  KEY idx_record_user (user_id),
  KEY idx_record_placement_email (placement_email),
  KEY idx_record_personal_email (personal_email),
  KEY idx_record_band (target_band),
  CONSTRAINT fk_record_cohort FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_assessments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_record_id BIGINT UNSIGNED NOT NULL,
  assessment_no     TINYINT UNSIGNED NOT NULL,
  score             DECIMAL(6,2) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assessment (student_record_id, assessment_no),
  CONSTRAINT fk_assessment_record FOREIGN KEY (student_record_id) REFERENCES student_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Platform stats exactly as captured in the spreadsheets. Kept apart from
-- coding_profiles, which holds live data synced for a signed-in user.
CREATE TABLE IF NOT EXISTS student_coding_stats (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_record_id BIGINT UNSIGNED NOT NULL,
  platform          ENUM('leetcode','codechef','github') NOT NULL,
  username          VARCHAR(120) DEFAULT NULL,
  confidence        ENUM('HIGH','MEDIUM','LOW','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  profile_name      VARCHAR(160) DEFAULT NULL,
  url               VARCHAR(400) DEFAULT NULL,
  solved            INT DEFAULT NULL,
  easy              INT DEFAULT NULL,
  medium            INT DEFAULT NULL,
  hard              INT DEFAULT NULL,
  rating            INT DEFAULT NULL,
  max_rating        INT DEFAULT NULL,
  stars             DECIMAL(4,2) DEFAULT NULL,
  repos             INT DEFAULT NULL,
  total_stars       INT DEFAULT NULL,
  followers         INT DEFAULT NULL,
  top_repo          VARCHAR(300) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stat_record_platform (student_record_id, platform),
  CONSTRAINT fk_stat_record FOREIGN KEY (student_record_id) REFERENCES student_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id   BIGINT UNSIGNED NOT NULL,
  job_ids   JSON DEFAULT NULL,
  job_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  channel   ENUM('email') NOT NULL DEFAULT 'email',
  status    ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  error     VARCHAR(400) DEFAULT NULL,
  sent_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_delivery_user (user_id, sent_at),
  CONSTRAINT fk_delivery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sourced jobs, moderation and applications
--
-- Jobs pulled in by the nightly ingester land as `pending` and are invisible to
-- students until a placement officer approves them. Anything a staff member
-- posts by hand is `approved` on arrival — they are the approver.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_applications (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  job_id         BIGINT UNSIGNED NOT NULL,
  status         ENUM('applied','screening','interviewing','offer','rejected','withdrawn')
                 NOT NULL DEFAULT 'applied',
  applied_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note           VARCHAR(600) DEFAULT NULL,
  -- Proof screenshots hold personal data (names, emails, portal account IDs),
  -- so they are stored OUTSIDE the public /uploads tree and served only through
  -- an authenticated route. This column is a bare filename, never a URL.
  proof_file     VARCHAR(160) DEFAULT NULL,
  proof_bytes    INT UNSIGNED DEFAULT NULL,
  proof_at       DATETIME DEFAULT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_application_user_job (user_id, job_id),
  KEY idx_application_job (job_id),
  KEY idx_application_status (status),
  CONSTRAINT fk_application_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_application_job  FOREIGN KEY (job_id)  REFERENCES jobs(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per source per nightly sweep, so a silent failure is visible in the
-- admin dashboard instead of only in the server log.
CREATE TABLE IF NOT EXISTS job_ingest_runs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source      VARCHAR(60) NOT NULL,
  status      ENUM('ok','partial','failed') NOT NULL DEFAULT 'ok',
  found       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  inserted    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  duplicates  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  below_floor SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  error       VARCHAR(500) DEFAULT NULL,
  ms          INT UNSIGNED DEFAULT NULL,
  started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ingest_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
