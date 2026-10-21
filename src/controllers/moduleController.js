const crypto = require('crypto');
const { pool } = require('../config/db');
const { logAudit } = require('../middleware/auditLogger');

/**
 * Generate unique national citizen ID
 * Format: LK-YYYYMMDD-XXXX
 */
function generateCitizenId(dobString) {
  const dateStr = (dobString || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `LK-${dateStr}-${randomSuffix}`;
}

/**
 * Generate cryptographic secure QR verification token
 */
function generateQrToken(citizenId) {
  return crypto.createHash('sha256')
    .update(`${citizenId}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`)
    .digest('hex');
}

/**
 * POST /api/medical/add
 * Hospital only: Add diagnosis or medical entry
 */
async function addMedicalRecord(req, res) {
  try {
    const {
      citizen_id,
      diagnosed_condition,
      chronic_flag = false,
      allergies = '',
      hospital_name,
      treating_physician,
      diagnosis_date,
      notes = ''
    } = req.body;

    if (!citizen_id || !diagnosed_condition || !hospital_name || !diagnosis_date) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: citizen_id, diagnosed_condition, hospital_name, diagnosis_date.'
      });
    }

    // Verify citizen exists
    const [citizenCheck] = await pool.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizen_id]
    );
    if (citizenCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID ${citizen_id} not found.`
      });
    }

    const [result] = await pool.query(
      `INSERT INTO medical_records
       (citizen_id, diagnosed_condition, chronic_flag, allergies, hospital_name, treating_physician, diagnosis_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        citizen_id,
        diagnosed_condition,
        Boolean(chronic_flag),
        allergies,
        hospital_name,
        treating_physician || req.user.username,
        diagnosis_date,
        notes
      ]
    );

    // Mandatory Audit Log
    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: 'HEALTHCARE_MODULE',
      targetCitizenId: citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(201).json({
      success: true,
      message: 'Medical diagnosis record added successfully.',
      medical_record_id: result.insertId
    });
  } catch (error) {
    console.error('[addMedicalRecord Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record medical entry.',
      error: error.message
    });
  }
}

/**
 * POST /api/education/add
 * School or University only: Add school or higher education academic record
 */
async function addEducationRecord(req, res) {
  try {
    const userRole = (req.user.role_name || '').toUpperCase();
    if (userRole === 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Administrators are not authorized to add citizen records.'
      });
    }

    let {
      citizen_id,
      type = 'HIGHER', // 'SCHOOL' or 'HIGHER'
      // School fields
      school_name,
      admission_number,
      start_year,
      end_year,
      highest_grade_passed,
      conduct_remarks,
      // Higher education fields
      institution_name,
      qualification_title,
      qualification_level = 'BACHELORS',
      class_or_gpa,
      graduation_year,
      verification_status = 'VERIFIED'
    } = req.body;

    if (userRole === 'CITIZEN') {
      citizen_id = req.user.associated_citizen_id || citizen_id;
    }

    if (!citizen_id) {
      return res.status(400).json({
        success: false,
        message: 'Citizen ID is required.'
      });
    }

    // Verify citizen exists
    const [citizenCheck] = await pool.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizen_id]
    );
    if (citizenCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID ${citizen_id} not found.`
      });
    }

    let insertId = null;

    if (type.toUpperCase() === 'SCHOOL') {
      if (!school_name || !start_year) {
        return res.status(400).json({
          success: false,
          message: 'school_name and start_year are required for school education records.'
        });
      }

      const [result] = await pool.query(
        `INSERT INTO school_education
         (citizen_id, school_name, admission_number, start_year, end_year, highest_grade_passed, conduct_remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          citizen_id,
          school_name,
          admission_number || null,
          start_year,
          end_year || null,
          highest_grade_passed || null,
          conduct_remarks || 'Satisfactory'
        ]
      );
      insertId = result.insertId;
    } else {
      if (!institution_name || !qualification_title || !graduation_year) {
        return res.status(400).json({
          success: false,
          message: 'institution_name, qualification_title, and graduation_year are required for higher education.'
        });
      }

      const [result] = await pool.query(
        `INSERT INTO higher_education
         (citizen_id, institution_name, qualification_title, qualification_level, class_or_gpa, graduation_year, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          citizen_id,
          institution_name,
          qualification_title,
          qualification_level,
          class_or_gpa || null,
          graduation_year,
          verification_status
        ]
      );
      insertId = result.insertId;
    }

    // Audit log
    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: 'EDUCATION_MODULE',
      targetCitizenId: citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(201).json({
      success: true,
      message: 'Education record successfully registered.',
      record_id: insertId
    });
  } catch (error) {
    console.error('[addEducationRecord Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record academic entry.',
      error: error.message
    });
  }
}

/**
 * Strict Human Name Validation Guardrail
 * Rejects hallucinated tokens, numbers, synthetic strings, and non-name patterns
 */
function isValidRealName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  // Name must be 2 to 60 characters and contain only Latin alphabet letters, spaces, apostrophes, hyphens, and periods
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (!/^[a-zA-Z\s\.\'\-]+$/.test(trimmed)) return false;

  // Blocklist of synthetic / dummy / test / hallucinated tokens
  const lower = trimmed.toLowerCase();
  const prohibitedTokens = [
    'test', 'dummy', 'fake', 'sample', 'hallucination', 'hallucinated',
    'placeholder', 'unknown', 'anonymous', 'none', 'null', 'undefined',
    'asdf', 'qwerty', 'tester', 'demo', 'mock', 'fake name', 'no name',
    'john doe', 'jane doe', 'foo', 'bar', 'baz'
  ];

  for (const token of prohibitedTokens) {
    const words = lower.split(/[\s\.\'\-]+/);
    if (words.includes(token)) return false;
    if (lower === token) return false;
  }

  // Reject strings where a single character is repeated 4+ times consecutively (e.g. "aaaaa")
  if (/(.)\1{3,}/.test(lower)) return false;

  // Must contain at least 2 alphabetic letters
  const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (letterCount < 2) return false;

  return true;
}

/**
 * POST /api/vital/register-birth
 * Registrar only: Register a new birth, generate unique citizen_id & qr_token atomically
 */
async function registerBirth(req, res) {
  const userRole = (req.user.role_name || '').toUpperCase();
  if (userRole === 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Administrators are not authorized to add citizen records.'
    });
  }

  const connection = await pool.getConnection();

  try {
    const {
      first_name,
      middle_names = '',
      last_name,
      gender,
      date_of_birth,
      blood_group = 'O+',
      place_of_birth,
      hospital_name = '',
      attending_physician = '',
      father_citizen_id = null,
      mother_citizen_id = null,
      informant_name = '',
      current_address = '',
      permanent_address = '',
      profile_picture = null
    } = req.body;

    if (!first_name || !last_name || !gender || !date_of_birth || !place_of_birth) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Required fields: first_name, last_name, gender, date_of_birth, place_of_birth.'
      });
    }

    // Anti-Hallucination & Legal Name Guardrail Validation
    if (!isValidRealName(first_name)) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Invalid First Name. Names must be genuine human legal names (alphabetical characters only; minimum 2 characters; no placeholder or synthetic test names).'
      });
    }

    if (middle_names && middle_names.trim() && !isValidRealName(middle_names)) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Invalid Middle Names. Middle names must contain only genuine alphabetical naming characters.'
      });
    }

    if (!isValidRealName(last_name)) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Invalid Last Name / Surname. Names must be genuine human legal names (alphabetical characters only; minimum 2 characters; no placeholder or synthetic test names).'
      });
    }

    if (informant_name && informant_name.trim()) {
      const cleanInformant = informant_name.split('(')[0].trim();
      if (!isValidRealName(cleanInformant)) {
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'Invalid Informant Name. Please enter the informant\'s genuine legal full name.'
        });
      }
    }

    // Resolve Parent IDs (supports both Citizen ID format and National NIC number)
    let resolvedMotherId = null;
    let resolvedFatherId = null;
    let parentNotes = [];

    if (mother_citizen_id && mother_citizen_id.trim()) {
      const cleanM = mother_citizen_id.trim();
      const [mCheck] = await connection.query(
        `SELECT citizen_id FROM citizens WHERE citizen_id = ? OR nic_number = ? LIMIT 1`,
        [cleanM, cleanM]
      );
      if (mCheck.length > 0) {
        resolvedMotherId = mCheck[0].citizen_id;
      } else {
        parentNotes.push(`Mother ID/NIC: ${cleanM}`);
      }
    }

    if (father_citizen_id && father_citizen_id.trim()) {
      const cleanF = father_citizen_id.trim();
      const [fCheck] = await connection.query(
        `SELECT citizen_id FROM citizens WHERE citizen_id = ? OR nic_number = ? LIMIT 1`,
        [cleanF, cleanF]
      );
      if (fCheck.length > 0) {
        resolvedFatherId = fCheck[0].citizen_id;
      } else {
        parentNotes.push(`Father ID/NIC: ${cleanF}`);
      }
    }

    // Preserve unregistered parent NICs in informant_name if needed
    let finalInformant = (informant_name || '').trim();
    if (parentNotes.length > 0 && finalInformant.length < 100) {
      finalInformant += (finalInformant ? ' ' : '') + `[${parentNotes.join('; ')}]`;
    }

    await connection.beginTransaction();

    // Generate unique citizen_id and cryptographic QR token
    let citizenId = generateCitizenId(date_of_birth);
    let qrToken = generateQrToken(citizenId);

    // Ensure citizen_id is strictly unique
    let [existingCheck] = await connection.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );
    while (existingCheck.length > 0) {
      citizenId = generateCitizenId(date_of_birth);
      [existingCheck] = await connection.query(
        `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
        [citizenId]
      );
    }

    // 1. Insert Citizen Demographics
    const address = permanent_address || current_address || place_of_birth;
    const isMaleChild = (gender || '').toUpperCase().startsWith('M');
    const assignedPhoto = profile_picture || (isMaleChild ? '/uploads/citizen_bilaal.jpg' : '/uploads/citizen_yumna.jpg');

    await connection.query(
      `INSERT INTO citizens
       (citizen_id, first_name, middle_names, last_name, gender, date_of_birth, blood_group, profile_picture, current_address, permanent_address, qr_token, is_deceased)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        citizenId,
        first_name.trim(),
        middle_names ? middle_names.trim() : '',
        last_name.trim(),
        gender,
        date_of_birth,
        blood_group,
        assignedPhoto,
        address,
        address,
        qrToken
      ]
    );

    // 2. Insert Birth Registration with safely resolved parent citizen IDs
    const regNumber = `BR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const today = new Date().toISOString().split('T')[0];

    const [birthResult] = await connection.query(
      `INSERT INTO birth_registrations
       (citizen_id, registration_number, place_of_birth, hospital_name, attending_physician, father_citizen_id, mother_citizen_id, informant_name, date_of_registration, registered_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        citizenId,
        regNumber,
        place_of_birth.trim(),
        hospital_name.trim(),
        attending_physician.trim(),
        resolvedFatherId,
        resolvedMotherId,
        finalInformant,
        today,
        req.user.user_id
      ]
    );

    // 3. Link Family Relationships if parent citizen was resolved in citizens registry
    if (resolvedFatherId) {
      await connection.query(
        `INSERT INTO family_relationships (citizen_id, related_citizen_id, relationship_type, verified)
         VALUES (?, ?, 'PARENT', 1)`,
        [citizenId, resolvedFatherId]
      ).catch(() => {});
    }
    if (resolvedMotherId) {
      await connection.query(
        `INSERT INTO family_relationships (citizen_id, related_citizen_id, relationship_type, verified)
         VALUES (?, ?, 'PARENT', 1)`,
        [citizenId, resolvedMotherId]
      ).catch(() => {});
    }

    await connection.commit();
    connection.release();

    // Audit Log
    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: 'CIVIL_REGISTRY_VITAL',
      targetCitizenId: citizenId,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    const fullName = `${first_name.trim()} ${middle_names ? middle_names.trim() : ''} ${last_name.trim()}`.replace(/\s+/g, ' ').trim();

    return res.status(201).json({
      success: true,
      message: 'Completed / Successfully created the birth information registration',
      data: {
        citizen_id: citizenId,
        registration_number: regNumber,
        full_name: fullName,
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        gender,
        date_of_birth,
        blood_group,
        place_of_birth: place_of_birth.trim(),
        hospital_name: hospital_name.trim() || 'N/A',
        mother_citizen_id: mother_citizen_id ? mother_citizen_id.trim() : null,
        father_citizen_id: father_citizen_id ? father_citizen_id.trim() : null,
        informant_name: informant_name.trim() || 'N/A',
        qr_token: qrToken,
        date_of_registration: today,
        birth_reg_id: birthResult.insertId
      }
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[registerBirth Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete birth registration transaction.',
      error: error.message
    });
  }
}

/**
 * POST /api/passport/add
 * Citizen or Immigration only: Add passport details (not admin)
 */
async function addPassportRecord(req, res) {
  try {
    const userRole = (req.user.role_name || '').toUpperCase();
    if (userRole === 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Administrators are not authorized to add citizen records.'
      });
    }

    let {
      citizen_id,
      passport_number,
      issue_date,
      expiry_date,
      issue_country = 'SRI LANKA',
      status = 'ACTIVE'
    } = req.body;

    if (userRole === 'CITIZEN') {
      citizen_id = req.user.associated_citizen_id || citizen_id;
    }

    if (!citizen_id || !passport_number || !issue_date || !expiry_date) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: citizen_id, passport_number, issue_date, expiry_date.'
      });
    }

    const cleanPassport = passport_number.trim().toUpperCase();

    // Verify citizen exists
    const [citizenCheck] = await pool.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizen_id]
    );
    if (citizenCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID ${citizen_id} not found.`
      });
    }

    // Check duplicate passport number
    const [existing] = await pool.query(
      `SELECT passport_id FROM passports WHERE passport_number = ?`,
      [cleanPassport]
    );
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Passport number '${cleanPassport}' is already registered in the immigration system.`
      });
    }

    const [result] = await pool.query(
      `INSERT INTO passports
       (citizen_id, passport_number, issue_date, expiry_date, issue_country, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        citizen_id,
        cleanPassport,
        issue_date,
        expiry_date,
        (issue_country || 'SRI LANKA').trim().toUpperCase(),
        (status || 'ACTIVE').trim().toUpperCase()
      ]
    );

    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: 'PASSPORT_MODULE',
      targetCitizenId: citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(201).json({
      success: true,
      message: 'Passport record added successfully.',
      passport_id: result.insertId,
      data: {
        passport_id: result.insertId,
        citizen_id,
        passport_number: cleanPassport,
        issue_date,
        expiry_date,
        issue_country: (issue_country || 'SRI LANKA').trim().toUpperCase(),
        status: (status || 'ACTIVE').trim().toUpperCase()
      }
    });
  } catch (error) {
    console.error('[addPassportRecord Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record passport details.',
      error: error.message
    });
  }
}

/**
 * POST /api/licence/add
 * Citizen or Police only: Add driving licence details (not admin)
 */
async function addLicenceRecord(req, res) {
  try {
    const userRole = (req.user.role_name || '').toUpperCase();
    if (userRole === 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Administrators are not authorized to add citizen records.'
      });
    }

    let {
      citizen_id,
      licence_number,
      vehicle_classes,
      issue_date,
      expiry_date,
      demerit_points = 0,
      status = 'VALID'
    } = req.body;

    if (userRole === 'CITIZEN') {
      citizen_id = req.user.associated_citizen_id || citizen_id;
    }

    if (!citizen_id || !licence_number || !vehicle_classes || !issue_date || !expiry_date) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: citizen_id, licence_number, vehicle_classes, issue_date, expiry_date.'
      });
    }

    const cleanLicence = licence_number.trim().toUpperCase();

    // Verify citizen exists
    const [citizenCheck] = await pool.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizen_id]
    );
    if (citizenCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID ${citizen_id} not found.`
      });
    }

    // Check duplicate licence number
    const [existing] = await pool.query(
      `SELECT licence_id FROM driving_licences WHERE licence_number = ?`,
      [cleanLicence]
    );
    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Driving licence number '${cleanLicence}' is already registered in the traffic system.`
      });
    }

    const [result] = await pool.query(
      `INSERT INTO driving_licences
       (citizen_id, licence_number, vehicle_classes, issue_date, expiry_date, demerit_points, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        citizen_id,
        cleanLicence,
        vehicle_classes.trim(),
        issue_date,
        expiry_date,
        parseInt(demerit_points, 10) || 0,
        (status || 'VALID').trim().toUpperCase()
      ]
    );

    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: 'POLICE_LICENCE_MODULE',
      targetCitizenId: citizen_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(201).json({
      success: true,
      message: 'Driving licence record added successfully.',
      licence_id: result.insertId,
      data: {
        licence_id: result.insertId,
        citizen_id,
        licence_number: cleanLicence,
        vehicle_classes: vehicle_classes.trim(),
        issue_date,
        expiry_date,
        demerit_points: parseInt(demerit_points, 10) || 0,
        status: (status || 'VALID').trim().toUpperCase()
      }
    });
  } catch (error) {
    console.error('[addLicenceRecord Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record driving licence details.',
      error: error.message
    });
  }
}

/**
 * POST /api/vital/marriage/add
 * Citizen or Registrar only: Add civil marriage record (not admin)
 */
async function addMarriageRecord(req, res) {
  try {
    const userRole = (req.user.role_name || '').toUpperCase();
    if (userRole === 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Administrators are not authorized to add citizen records.'
      });
    }

    let {
      certificate_number,
      spouse_one_id,
      spouse_two_id,
      marriage_date,
      registration_place,
      status = 'ACTIVE'
    } = req.body;

    if (userRole === 'CITIZEN') {
      spouse_one_id = req.user.associated_citizen_id || spouse_one_id;
    }

    if (!spouse_one_id || !marriage_date || !registration_place) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: spouse_one_id, marriage_date, registration_place.'
      });
    }

    let resolvedSpouseTwo = null;
    if (spouse_two_id && spouse_two_id.trim()) {
      const cleanS2 = spouse_two_id.trim();
      const [s2Check] = await pool.query(
        `SELECT citizen_id FROM citizens WHERE citizen_id = ? OR nic_number = ? LIMIT 1`,
        [cleanS2, cleanS2]
      );
      if (s2Check.length > 0) {
        resolvedSpouseTwo = s2Check[0].citizen_id;
      }
    }

    const certNum = certificate_number ? certificate_number.trim().toUpperCase() : `MC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const [result] = await pool.query(
      `INSERT INTO marriages
       (certificate_number, spouse_one_id, spouse_two_id, marriage_date, registration_place, registered_by_user_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        certNum,
        spouse_one_id,
        resolvedSpouseTwo,
        marriage_date,
        registration_place.trim(),
        req.user.user_id,
        (status || 'ACTIVE').trim().toUpperCase()
      ]
    );

    await logAudit({
      userId: req.user.user_id,
      actionType: 'CREATE',
      moduleAccessed: 'CIVIL_REGISTRY_MARRIAGE',
      targetCitizenId: spouse_one_id,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(201).json({
      success: true,
      message: 'Civil marriage record successfully registered.',
      marriage_id: result.insertId,
      certificate_number: certNum
    });
  } catch (error) {
    console.error('[addMarriageRecord Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record marriage details.',
      error: error.message
    });
  }
}

module.exports = {
  addMedicalRecord,
  addEducationRecord,
  registerBirth,
  addPassportRecord,
  addLicenceRecord,
  addMarriageRecord
};
