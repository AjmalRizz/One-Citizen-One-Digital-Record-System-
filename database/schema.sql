-- OCODR database schema (MySQL 8 / MariaDB 10.4+)
-- Run once:  mysql -u root -p < database/schema.sql
-- Then load demo data:  npm run seed

CREATE DATABASE IF NOT EXISTS ocodr_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ocodr_db;

CREATE TABLE IF NOT EXISTS roles (
  role_id      INT PRIMARY KEY,
  role_name    VARCHAR(50) NOT NULL UNIQUE,
  description  VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS citizens (
  citizen_id         VARCHAR(20) PRIMARY KEY,
  nic_number         VARCHAR(30) UNIQUE,
  first_name         VARCHAR(100) NOT NULL,
  middle_names       VARCHAR(150),
  last_name          VARCHAR(100) NOT NULL,
  name_si            VARCHAR(255),
  name_ta            VARCHAR(255),
  gender             VARCHAR(10),
  date_of_birth      DATE,
  blood_group        VARCHAR(5),
  profile_picture    VARCHAR(255),
  current_address    VARCHAR(255),
  permanent_address  VARCHAR(255),
  birth_place        VARCHAR(100),
  contact_phone      VARCHAR(30),
  qr_token           VARCHAR(100) UNIQUE,
  date_of_issue      DATE,
  date_of_expiry     DATE,
  card_serial        VARCHAR(30),
  signature_name     VARCHAR(100),
  is_active          TINYINT(1) DEFAULT 1,
  is_deceased        TINYINT(1) DEFAULT 0,
  is_child           TINYINT(1) DEFAULT 0,
  father_name        VARCHAR(150),
  father_nic         VARCHAR(30),
  mother_name        VARCHAR(150),
  mother_nic         VARCHAR(30),
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  user_id               INT AUTO_INCREMENT PRIMARY KEY,
  username              VARCHAR(60) NOT NULL UNIQUE,
  password_hash         VARCHAR(255) NOT NULL,
  email                 VARCHAR(150),
  phone_number          VARCHAR(30),
  role_id               INT NOT NULL,
  associated_citizen_id VARCHAR(20) NULL,
  profile_picture       VARCHAR(255),
  is_active             TINYINT(1) DEFAULT 1,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS otp_verifications (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  identifier  VARCHAR(100) NOT NULL,
  otp_code    VARCHAR(6) NOT NULL,
  purpose     ENUM('LOGIN','REGISTER','VERIFY_RECORD') NOT NULL,
  expires_at  DATETIME NOT NULL,
  is_used     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id            INT,
  action_type        VARCHAR(100),
  module_accessed    VARCHAR(100),
  target_citizen_id  VARCHAR(20),
  ip_address         VARCHAR(64),
  user_agent         VARCHAR(255),
  timestamp          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_uploads (
  doc_id               INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id           VARCHAR(20) NOT NULL,
  module_category      VARCHAR(60),
  document_title       VARCHAR(255),
  file_path            VARCHAR(255),
  file_mime_type       VARCHAR(100),
  uploaded_by_user_id  INT,
  uploaded_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS birth_registrations (
  birth_reg_id         INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id           VARCHAR(20) NOT NULL,
  registration_number  VARCHAR(50),
  place_of_birth       VARCHAR(150),
  hospital_name        VARCHAR(150),
  attending_physician  VARCHAR(150),
  father_citizen_id    VARCHAR(20) NULL,
  mother_citizen_id    VARCHAR(20) NULL,
  informant_name       VARCHAR(150),
  date_of_registration DATE,
  registered_by_user_id INT,
  father_name          VARCHAR(150),
  father_nic           VARCHAR(30),
  father_phone         VARCHAR(30),
  mother_name          VARCHAR(150),
  mother_nic           VARCHAR(30),
  mother_phone         VARCHAR(30),
  informant_phone      VARCHAR(30),
  informant_nic        VARCHAR(30),
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS family_relationships (
  relationship_id    INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id         VARCHAR(20) NOT NULL,
  related_citizen_id VARCHAR(20) NOT NULL,
  relationship_type  VARCHAR(30),
  verified           TINYINT(1) DEFAULT 0,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marriages (
  marriage_id           INT AUTO_INCREMENT PRIMARY KEY,
  certificate_number    VARCHAR(50),
  spouse_one_id         VARCHAR(20),
  spouse_two_id         VARCHAR(20) NULL,
  spouse_two_name       VARCHAR(150) NULL,
  marriage_date         DATE,
  registration_place    VARCHAR(150),
  registered_by_user_id INT,
  status                VARCHAR(30),
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS death_registrations (
  death_id             INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id           VARCHAR(20) NOT NULL,
  date_of_death        DATE,
  place_of_death       VARCHAR(150),
  cause_of_death       VARCHAR(255),
  certificate_number   VARCHAR(50),
  registered_by_user_id INT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medical_records (
  medical_record_id   INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id          VARCHAR(20) NOT NULL,
  diagnosed_condition VARCHAR(255),
  chronic_flag        TINYINT(1) DEFAULT 0,
  allergies           VARCHAR(255),
  hospital_name       VARCHAR(150),
  treating_physician  VARCHAR(150),
  diagnosis_date      DATE,
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vaccination_records (
  vaccine_id          INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id          VARCHAR(20) NOT NULL,
  vaccine_name        VARCHAR(150),
  dose_number         INT,
  batch_number        VARCHAR(50),
  administration_date DATE,
  center_name         VARCHAR(150),
  administered_by     VARCHAR(150),
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS school_education (
  record_id            INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id           VARCHAR(20) NOT NULL,
  school_name          VARCHAR(150),
  admission_number     VARCHAR(50),
  start_year           INT,
  end_year             INT,
  highest_grade_passed VARCHAR(50),
  conduct_remarks      TEXT,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exam_results (
  result_id         INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id        VARCHAR(20) NOT NULL,
  exam_name         VARCHAR(150),
  exam_index_number VARCHAR(50),
  exam_year         INT,
  subject           VARCHAR(100),
  grade             VARCHAR(10),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS higher_education (
  qualification_id     INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id           VARCHAR(20) NOT NULL,
  institution_name     VARCHAR(150),
  qualification_title  VARCHAR(200),
  qualification_level  VARCHAR(30),
  class_or_gpa         VARCHAR(100),
  graduation_year      INT,
  verification_status  VARCHAR(30) DEFAULT 'PENDING',
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employment_history (
  employment_id   INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id      VARCHAR(20) NOT NULL,
  employer_name   VARCHAR(150),
  job_title       VARCHAR(150),
  employment_type VARCHAR(50),
  start_date      DATE,
  end_date        DATE NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS passports (
  passport_id     INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id      VARCHAR(20) NOT NULL,
  passport_number VARCHAR(30),
  issue_date      DATE,
  expiry_date     DATE,
  issue_country   VARCHAR(80),
  status          VARCHAR(30),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS driving_licences (
  licence_id      INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id      VARCHAR(20) NOT NULL,
  licence_number  VARCHAR(30),
  vehicle_classes VARCHAR(100),
  issue_date      DATE,
  expiry_date     DATE,
  demerit_points  INT DEFAULT 0,
  status          VARCHAR(30),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS property_ownership (
  property_id          INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id           VARCHAR(20) NOT NULL,
  deed_number          VARCHAR(50),
  land_registry_office VARCHAR(150),
  property_address     VARCHAR(255),
  extent_area          VARCHAR(50),
  ownership_percentage DECIMAL(5,2),
  registration_date    DATE,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
