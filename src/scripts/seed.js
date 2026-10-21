const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

async function seedDatabase() {
  console.log('[Seed] Starting database migration & initial data seeding...');

  try {
    // 1. Create otp_verifications table if missing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        identifier VARCHAR(100) NOT NULL,
        otp_code VARCHAR(6) NOT NULL,
        purpose ENUM('LOGIN', 'REGISTER', 'VERIFY_RECORD') NOT NULL,
        expires_at DATETIME NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Seed] Verified table: otp_verifications');

    // 2. Ensure roles exist
    const rolesList = [
      { id: 1, name: 'CITIZEN', desc: 'Citizen accessing own profile and records' },
      { id: 2, name: 'HOSPITAL', desc: 'Ministry of Health and registered healthcare providers' },
      { id: 3, name: 'SCHOOL', desc: 'Primary and secondary educational institutes' },
      { id: 4, name: 'UNIVERSITY', desc: 'Higher education institutes' },
      { id: 5, name: 'REGISTRAR', desc: 'Registrar Generals Department for Vital Statistics' },
      { id: 6, name: 'POLICE', desc: 'Law enforcement and traffic authorities' },
      { id: 7, name: 'IMMIGRATION', desc: 'Department of Immigration and Emigration' },
      { id: 8, name: 'REVENUE', desc: 'Inland Revenue Department for tax management' },
      { id: 9, name: 'LAND_REGISTRY', desc: 'Land and property records authority' },
      { id: 10, name: 'ADMIN', desc: 'System administrator for audit, roles, and maintenance' }
    ];

    for (const r of rolesList) {
      await pool.query(
        `INSERT INTO roles (role_id, role_name, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [r.id, r.name, r.desc]
      );
    }
    console.log('[Seed] Verified system roles (1-10)');

    // 3. Seed Demo Citizens
    const citizenId = 'LK-19900512-0042';
    const nicNumber = '199055401234';
    const qrToken = 'qr_token_lk_19900512_0042_secure_hash_v1';

    await pool.query(
      `INSERT INTO citizens
       (citizen_id, nic_number, first_name, middle_names, last_name, name_si, name_ta, gender, date_of_birth, blood_group, profile_picture, current_address, permanent_address, birth_place, contact_phone, qr_token, date_of_issue, date_of_expiry, card_serial, signature_name, is_deceased)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         nic_number = VALUES(nic_number),
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         name_si = VALUES(name_si),
         name_ta = VALUES(name_ta),
         blood_group = VALUES(blood_group),
         profile_picture = VALUES(profile_picture),
         current_address = VALUES(current_address),
         permanent_address = VALUES(permanent_address),
         birth_place = VALUES(birth_place),
         contact_phone = VALUES(contact_phone),
         qr_token = VALUES(qr_token),
         date_of_issue = VALUES(date_of_issue),
         date_of_expiry = VALUES(date_of_expiry),
         card_serial = VALUES(card_serial),
         signature_name = VALUES(signature_name)`,
      [
        citizenId,
        nicNumber,
        'Yumna',
        'Fathima',
        'Silva',
        'යුම්නා ෆාතිමා සිල්වා',
        'யும்னா பாத்திமா சில்வா',
        'FEMALE',
        '1990-05-12',
        'O+',
        '/uploads/citizen_yumna.jpg',
        'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka',
        'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka',
        'Colombo',
        '+94771234567',
        qrToken,
        '2025-01-15',
        '2035-01-14',
        '08SLK-942',
        'Yumna'
      ]
    );

    // Seed Wasim Bari Ahmadh Bilaal (Official Smart NIC from user photos)
    const bilaalCitizenId = 'LK-20051102-0220';
    const bilaalNic = '200530702203';
    const bilaalQrToken = '20378454CBC6431CA51DA25E3A5CD78E';
    await pool.query(
      `INSERT INTO citizens
       (citizen_id, nic_number, first_name, middle_names, last_name, name_si, name_ta, gender, date_of_birth, blood_group, profile_picture, current_address, permanent_address, birth_place, contact_phone, qr_token, date_of_issue, date_of_expiry, card_serial, signature_name, is_deceased)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         nic_number = VALUES(nic_number),
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         name_si = VALUES(name_si),
         name_ta = VALUES(name_ta),
         blood_group = VALUES(blood_group),
         profile_picture = VALUES(profile_picture),
         current_address = VALUES(current_address),
         permanent_address = VALUES(permanent_address),
         birth_place = VALUES(birth_place),
         contact_phone = VALUES(contact_phone),
         qr_token = VALUES(qr_token),
         date_of_issue = VALUES(date_of_issue),
         date_of_expiry = VALUES(date_of_expiry),
         card_serial = VALUES(card_serial),
         signature_name = VALUES(signature_name)`,
      [
        bilaalCitizenId,
        bilaalNic,
        'Wasim',
        'Bari Ahmadh',
        'Bilaal',
        'වසීම් බාරි අහ්මද් බිලාල්',
        'வசீம் பாரி அஹ்மத் பிலால்',
        'MALE',
        '2005-11-02',
        'O+',
        '/uploads/citizen_bilaal.jpg',
        '186/C, Pahala Kondadeniya, Katugastota.',
        '186/C, Pahala Kondadeniya, Katugastota.',
        'Kandy',
        '+94772345678',
        bilaalQrToken,
        '2025-01-27',
        '2035-01-26',
        '05CBD-220',
        'Bilaal'
      ]
    );

    // Seed spouse citizen
    const spouseId = 'LK-19880214-9912';
    await pool.query(
      `INSERT INTO citizens
       (citizen_id, nic_number, first_name, middle_names, last_name, gender, date_of_birth, blood_group, profile_picture, current_address, permanent_address, contact_phone, qr_token, is_deceased)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         nic_number = VALUES(nic_number),
         first_name = VALUES(first_name),
         last_name = VALUES(last_name)`,
      [
        spouseId,
        '198804501234',
        'Kasun',
        'Buddhika',
        'Silva',
        'MALE',
        '1988-02-14',
        'A+',
        null,
        'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka',
        'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka',
        '+94777654321',
        'qr_token_lk_19880214_9912_secure_hash'
      ]
    );
    console.log(`[Seed] Seeded demo citizens: ${citizenId}, ${bilaalCitizenId} & ${spouseId}`);

    // 4. Seed Demo Users for All Roles (Password for all: password123)
    const saltRounds = 10;
    const defaultPasswordHash = await bcrypt.hash('password123', saltRounds);

    const usersToSeed = [
      { username: 'admin', email: 'admin@ocodr.gov.lk', role_id: 10, citizen_id: null, profile_picture: null },
      { username: 'citizen', email: 'citizen@ocodr.gov.lk', role_id: 1, citizen_id: citizenId, profile_picture: '/uploads/citizen_yumna.jpg' },
      { username: 'bilaal', email: 'bilaal@pupil.edu.lk', role_id: 1, citizen_id: bilaalCitizenId, profile_picture: '/uploads/citizen_bilaal.jpg' },
      { username: 'doctor.perera', email: 'doctor@health.gov.lk', role_id: 2, citizen_id: null, profile_picture: null },
      { username: 'principal.bandara', email: 'principal@school.edu.lk', role_id: 3, citizen_id: null, profile_picture: null },
      { username: 'registrar.uoc', email: 'registrar@uoc.ac.lk', role_id: 4, citizen_id: null, profile_picture: null },
      { username: 'registrar.vital', email: 'vital@rgd.gov.lk', role_id: 5, citizen_id: null, profile_picture: null },
      { username: 'officer.fernando', email: 'police@police.gov.lk', role_id: 6, citizen_id: null, profile_picture: null },
      { username: 'officer.wickramasinghe', email: 'immigration@immigration.gov.lk', role_id: 7, citizen_id: null, profile_picture: null }
    ];

    for (const u of usersToSeed) {
      await pool.query(
        `INSERT INTO users (username, password_hash, role_id, associated_citizen_id, email, profile_picture, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           role_id = VALUES(role_id),
           associated_citizen_id = VALUES(associated_citizen_id),
           email = VALUES(email),
           profile_picture = VALUES(profile_picture),
           is_active = 1`,
        [u.username, defaultPasswordHash, u.role_id, u.citizen_id, u.email, u.profile_picture]
      );
    }
    console.log('[Seed] Seeded 8 demo users with password "password123"');

    // 5. Seed Medical Records for Demo Citizen
    await pool.query('DELETE FROM medical_records WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO medical_records
       (citizen_id, diagnosed_condition, chronic_flag, allergies, hospital_name, treating_physician, diagnosis_date, notes)
       VALUES
       (?, 'Type 2 Diabetes Mellitus', 1, 'Penicillin, Sulfa drugs', 'National Hospital of Sri Lanka, Colombo', 'Dr. A. C. Perera, MBBS MD (Endocrinology)', '2023-04-15', 'Patient maintained on Metformin 500mg twice daily with lifestyle modifications. Regular glycemic reviews every 6 months.'),
       (?, 'Mild Bronchial Asthma', 1, 'Penicillin', 'Colombo South Teaching Hospital', 'Dr. M. S. Fernando, MBBS MD', '2021-08-20', 'Triggered by humidity and severe pollen. Prescribed Salbutamol Inhaler 100mcg as needed.')`,
      [citizenId, citizenId]
    );

    // 6. Seed Vaccination Records
    await pool.query('DELETE FROM vaccination_records WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO vaccination_records
       (citizen_id, vaccine_name, dose_number, batch_number, administration_date, center_name, administered_by)
       VALUES
       (?, 'Pfizer-BioNTech COVID-19', 1, 'PF-9821-B4', '2021-06-10', 'Sugathadasa Stadium Vaccination Center', 'Nursing Officer K. L. Jayasinghe'),
       (?, 'Pfizer-BioNTech COVID-19', 2, 'PF-9943-C1', '2021-07-15', 'Sugathadasa Stadium Vaccination Center', 'Nursing Officer K. L. Jayasinghe'),
       (?, 'Pfizer-BioNTech Booster', 3, 'PF-1102-X9', '2022-01-20', 'Colombo General Hospital MOH Unit', 'Medical Officer Dr. T. Senaratne'),
       (?, 'BCG Vaccine', 1, 'BCG-1990-05', '1990-05-14', 'Castle Street Maternity Hospital, Colombo', 'MOH Immunization Clinic'),
       (?, 'MMR Vaccine', 1, 'MMR-1991-11', '1991-05-20', 'Colombo Municipal Council Health Center', 'Child Welfare Clinic')`,
      [citizenId, citizenId, citizenId, citizenId, citizenId]
    );

    // 7. Seed School Education
    await pool.query('DELETE FROM school_education WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO school_education
       (citizen_id, school_name, admission_number, start_year, end_year, highest_grade_passed, conduct_remarks)
       VALUES
       (?, 'Visakha Vidyalaya, Colombo 04', 'VV-1996-4821', 1996, 2009, 'Grade 13 (A/L)', 'Exemplary conduct throughout academic tenure. Senior School Prefect and Science Society President.')`,
      [citizenId]
    );

    // 8. Seed Higher Education
    await pool.query('DELETE FROM higher_education WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO higher_education
       (citizen_id, institution_name, qualification_title, qualification_level, class_or_gpa, graduation_year, verification_status)
       VALUES
       (?, 'University of Colombo School of Computing', 'Bachelor of Science (Hons) in Computer Science', 'BACHELORS', 'First Class Honours (GPA 3.86)', 2014, 'VERIFIED'),
       (?, 'University of Moratuwa', 'Master of Science in Information Technology & Security', 'MASTERS', 'Merit Award (GPA 3.75)', 2018, 'VERIFIED')`,
      [citizenId, citizenId]
    );

    // 9. Seed Exam Results
    await pool.query('DELETE FROM exam_results WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO exam_results
       (citizen_id, exam_name, exam_index_number, exam_year, subject, grade)
       VALUES
       (?, 'G.C.E. Advanced Level', '6291844', 2009, 'Combined Mathematics', 'A'),
       (?, 'G.C.E. Advanced Level', '6291844', 2009, 'Physics', 'A'),
       (?, 'G.C.E. Advanced Level', '6291844', 2009, 'Chemistry', 'B'),
       (?, 'G.C.E. Advanced Level', '6291844', 2009, 'General English', 'A'),
       (?, 'G.C.E. Ordinary Level', '3104822', 2006, 'Mathematics', 'A'),
       (?, 'G.C.E. Ordinary Level', '3104822', 2006, 'Science', 'A'),
       (?, 'G.C.E. Ordinary Level', '3104822', 2006, 'English Language', 'A')`,
      [citizenId, citizenId, citizenId, citizenId, citizenId, citizenId, citizenId]
    );

    // 10. Seed Passports
    await pool.query('DELETE FROM passports WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO passports
       (citizen_id, passport_number, issue_date, expiry_date, issue_country, status)
       VALUES
       (?, 'N8291042', '2022-03-10', '2032-03-10', 'SRI LANKA', 'ACTIVE')`,
      [citizenId]
    );

    // 11. Seed Driving Licences
    await pool.query('DELETE FROM driving_licences WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO driving_licences
       (citizen_id, licence_number, vehicle_classes, issue_date, expiry_date, demerit_points, status)
       VALUES
       (?, 'B8291044', 'B, B1, G1 (Light Motor Car / Dual Purpose)', '2012-08-15', '2030-08-15', 0, 'VALID')`,
      [citizenId]
    );

    // 12. Seed Birth Registration
    await pool.query('DELETE FROM birth_registrations WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO birth_registrations
       (citizen_id, registration_number, place_of_birth, hospital_name, attending_physician, informant_name, date_of_registration, registered_by_user_id)
       VALUES
       (?, 'BR-1990-0512-8821', 'Castle Street Hospital for Women, Colombo 08', 'Castle Street Hospital', 'Dr. K. Jayasuriya, FRCOG', 'M. Silva (Father)', '1990-05-15', 1)`,
      [citizenId]
    );

    // 13. Seed Marriage
    await pool.query('DELETE FROM marriages WHERE spouse_one_id = ? OR spouse_two_id = ?', [citizenId, citizenId]);
    await pool.query(
      `INSERT INTO marriages
       (certificate_number, spouse_one_id, spouse_two_id, marriage_date, registration_place, registered_by_user_id, status)
       VALUES
       ('MC-2019-0814-332', ?, 'LK-19880214-9912', '2019-08-14', 'Colombo Divisional Secretariat Civil Registry', 1, 'ACTIVE')`,
      [citizenId]
    );

    // 14. Seed Employment & Property
    await pool.query('DELETE FROM property_ownership WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO property_ownership
       (citizen_id, deed_number, land_registry_office, property_address, extent_area, ownership_percentage, registration_date)
       VALUES
       (?, 'DEED-CMB-84920', 'Colombo Land Registry', 'No. 42, Galle Road, Colombo 03', '15.5 Perches', 100.00, '2017-11-20')`,
      [citizenId]
    );

    await pool.query('DELETE FROM employment_history WHERE citizen_id = ?', [citizenId]);
    await pool.query(
      `INSERT INTO employment_history
       (citizen_id, employer_name, job_title, employment_type, start_date, end_date)
       VALUES
       (?, 'National Information Technology Agency (NITA)', 'Principal Digital Systems Architect', 'PUBLIC', '2019-01-15', NULL)`,
      [citizenId]
    );

    // 15. Initial Audit Log Entry
    await pool.query(
      `INSERT INTO audit_logs (user_id, action_type, module_accessed, target_citizen_id, ip_address, user_agent)
       VALUES (1, 'CREATE', 'DATABASE_SEED', ?, '127.0.0.1', 'System Provisioning Engine')`,
      [citizenId]
    );

    console.log('[Seed] Database initialization and seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error] Failed to initialize database:', error);
    process.exit(1);
  }
}

seedDatabase();
