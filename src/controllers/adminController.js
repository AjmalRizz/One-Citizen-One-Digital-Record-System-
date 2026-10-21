const { pool } = require('../config/db');
const { logAudit } = require('../middleware/auditLogger');

/**
 * Universal helper to extract audit user context
 */
function getAuditContext(req) {
  return {
    userId: req.user.user_id,
    ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'UNKNOWN'
  };
}

/**
 * GET /api/admin/overview-counts
 * Summary statistics across all 7 national sectors
 */
async function getOverviewCounts(req, res) {
  try {
    const [[cCount]] = await pool.query('SELECT COUNT(*) as total FROM citizens');
    const [[hCount]] = await pool.query('SELECT COUNT(*) as total FROM medical_records');
    const [[sCount]] = await pool.query('SELECT COUNT(*) as total FROM school_education');
    const [[uCount]] = await pool.query('SELECT COUNT(*) as total FROM higher_education');
    const [[pCount]] = await pool.query('SELECT COUNT(*) as total FROM driving_licences');
    const [[iCount]] = await pool.query('SELECT COUNT(*) as total FROM passports');
    const [[rCount]] = await pool.query('SELECT COUNT(*) as total FROM birth_registrations');

    return res.status(200).json({
      success: true,
      counts: {
        citizens: cCount.total,
        hospital: hCount.total,
        school: sCount.total,
        university: uCount.total,
        police: pCount.total,
        immigration: iCount.total,
        registrar: rCount.total
      }
    });
  } catch (error) {
    console.error('[getOverviewCounts Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve overview counts.' });
  }
}

/**
 * GET /api/admin/citizens
 * View all citizen records with search and pagination
 */
async function getAllCitizens(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE citizen_id LIKE ? OR nic_number LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR contact_phone LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(`SELECT COUNT(*) as total FROM citizens ${whereSql}`, params);
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT citizen_id, nic_number, first_name, middle_names, last_name, gender, date_of_birth,
              blood_group, contact_phone, current_address, permanent_address, is_active, is_deceased, created_at
       FROM citizens
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_ALL_CITIZENS',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1
      }
    });
  } catch (error) {
    console.error('[getAllCitizens Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve citizen records.' });
  }
}

/**
 * DELETE /api/admin/citizens/:citizenId
 * Admin deletes a citizen record completely (cascading purge)
 */
async function deleteCitizen(req, res) {
  const { citizenId } = req.params;
  const ctx = getAuditContext(req);

  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.query('SELECT citizen_id, first_name, last_name FROM citizens WHERE citizen_id = ?', [citizenId]);
    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: `Citizen '${citizenId}' not found.` });
    }

    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // Cascade delete across all linked records
    await connection.query('DELETE FROM document_uploads WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM family_relationships WHERE citizen_id = ? OR related_citizen_id = ?', [citizenId, citizenId]);
    await connection.query('DELETE FROM birth_registrations WHERE citizen_id = ?', [citizenId]);
    await connection.query('UPDATE birth_registrations SET father_citizen_id = NULL WHERE father_citizen_id = ?', [citizenId]);
    await connection.query('UPDATE birth_registrations SET mother_citizen_id = NULL WHERE mother_citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM death_registrations WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM driving_licences WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM passports WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM medical_records WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM vaccination_records WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM exam_results WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM higher_education WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM school_education WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM employment_history WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM property_ownership WHERE citizen_id = ?', [citizenId]);
    await connection.query('DELETE FROM marriages WHERE spouse_one_id = ? OR spouse_two_id = ?', [citizenId, citizenId]);
    
    // Safely unlink any user accounts associated with this citizen and deactivate them
    await connection.query('UPDATE users SET associated_citizen_id = NULL, is_active = 0 WHERE associated_citizen_id = ?', [citizenId]);
    
    // Delete master citizen record
    await connection.query('DELETE FROM citizens WHERE citizen_id = ?', [citizenId]);

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();
    connection.release();

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_PURGE_CITIZEN',
      targetCitizenId: citizenId
    });

    return res.status(200).json({
      success: true,
      message: `Citizen record '${citizenId}' and all sector attachments were successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteCitizen Error]', error);
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      await connection.rollback();
    } catch (rbErr) {
      console.warn('[Rollback Warning]', rbErr.message);
    }
    connection.release();
    return res.status(500).json({ success: false, message: error.message || 'Failed to delete citizen record.' });
  }
}

/**
 * GET /api/admin/hospital
 * View all clinical & medical entries across all citizens
 */
async function getAllHospitalRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE m.citizen_id LIKE ? OR m.diagnosed_condition LIKE ? OR m.hospital_name LIKE ? OR m.treating_physician LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.nic_number LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM medical_records m LEFT JOIN citizens c ON m.citizen_id = c.citizen_id ${whereSql}`,
      params
    );
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT m.medical_record_id, m.citizen_id, m.diagnosed_condition, m.chronic_flag, m.allergies,
              m.hospital_name, m.treating_physician, m.diagnosis_date, m.notes, m.created_at,
              c.first_name, c.last_name, c.nic_number
       FROM medical_records m
       LEFT JOIN citizens c ON m.citizen_id = c.citizen_id
       ${whereSql}
       ORDER BY m.diagnosis_date DESC, m.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_HOSPITAL_REGISTRY',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    console.error('[getAllHospitalRecords Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve hospital records.' });
  }
}

/**
 * DELETE /api/admin/hospital/:id
 * Delete a specific clinical/medical record
 */
async function deleteHospitalRecord(req, res) {
  const { id } = req.params;
  const ctx = getAuditContext(req);

  try {
    const [existing] = await pool.query('SELECT medical_record_id, citizen_id, diagnosed_condition FROM medical_records WHERE medical_record_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `Medical record #${id} not found.` });
    }

    await pool.query('DELETE FROM medical_records WHERE medical_record_id = ?', [id]);

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_DELETE_HOSPITAL_RECORD',
      targetCitizenId: existing[0].citizen_id
    });

    return res.status(200).json({
      success: true,
      message: `Medical entry #${id} (${existing[0].diagnosed_condition}) was successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteHospitalRecord Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete hospital record.' });
  }
}

/**
 * GET /api/admin/school
 * View all primary & secondary school education entries
 */
async function getAllSchoolRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE s.citizen_id LIKE ? OR s.school_name LIKE ? OR s.admission_number LIKE ? OR s.highest_grade_passed LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.nic_number LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM school_education s LEFT JOIN citizens c ON s.citizen_id = c.citizen_id ${whereSql}`,
      params
    );
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT s.record_id, s.citizen_id, s.school_name, s.admission_number, s.start_year, s.end_year,
              s.highest_grade_passed, s.conduct_remarks, s.created_at,
              c.first_name, c.last_name, c.nic_number
       FROM school_education s
       LEFT JOIN citizens c ON s.citizen_id = c.citizen_id
       ${whereSql}
       ORDER BY s.end_year DESC, s.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_SCHOOL_REGISTRY',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    console.error('[getAllSchoolRecords Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve school records.' });
  }
}

/**
 * DELETE /api/admin/school/:id
 * Delete a specific school education record
 */
async function deleteSchoolRecord(req, res) {
  const { id } = req.params;
  const ctx = getAuditContext(req);

  try {
    const [existing] = await pool.query('SELECT record_id, citizen_id, school_name FROM school_education WHERE record_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `School record #${id} not found.` });
    }

    await pool.query('DELETE FROM school_education WHERE record_id = ?', [id]);

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_DELETE_SCHOOL_RECORD',
      targetCitizenId: existing[0].citizen_id
    });

    return res.status(200).json({
      success: true,
      message: `School entry #${id} (${existing[0].school_name}) was successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteSchoolRecord Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete school record.' });
  }
}

/**
 * GET /api/admin/university
 * View all higher education & tertiary qualifications
 */
async function getAllUniversityRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE h.citizen_id LIKE ? OR h.institution_name LIKE ? OR h.qualification_title LIKE ? OR h.qualification_level LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.nic_number LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM higher_education h LEFT JOIN citizens c ON h.citizen_id = c.citizen_id ${whereSql}`,
      params
    );
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT h.qualification_id, h.citizen_id, h.institution_name, h.qualification_title,
              h.qualification_level, h.class_or_gpa, h.graduation_year, h.verification_status, h.created_at,
              c.first_name, c.last_name, c.nic_number
       FROM higher_education h
       LEFT JOIN citizens c ON h.citizen_id = c.citizen_id
       ${whereSql}
       ORDER BY h.graduation_year DESC, h.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_UNIVERSITY_REGISTRY',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    console.error('[getAllUniversityRecords Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve university records.' });
  }
}

/**
 * DELETE /api/admin/university/:id
 * Delete a specific higher education record
 */
async function deleteUniversityRecord(req, res) {
  const { id } = req.params;
  const ctx = getAuditContext(req);

  try {
    const [existing] = await pool.query('SELECT qualification_id, citizen_id, qualification_title FROM higher_education WHERE qualification_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `University qualification #${id} not found.` });
    }

    await pool.query('DELETE FROM higher_education WHERE qualification_id = ?', [id]);

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_DELETE_UNIVERSITY_RECORD',
      targetCitizenId: existing[0].citizen_id
    });

    return res.status(200).json({
      success: true,
      message: `University record #${id} (${existing[0].qualification_title}) was successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteUniversityRecord Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete university record.' });
  }
}

/**
 * GET /api/admin/police
 * View all police & driving licences records
 */
async function getAllPoliceRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE d.citizen_id LIKE ? OR d.licence_number LIKE ? OR d.vehicle_classes LIKE ? OR d.status LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.nic_number LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM driving_licences d LEFT JOIN citizens c ON d.citizen_id = c.citizen_id ${whereSql}`,
      params
    );
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT d.licence_id, d.citizen_id, d.licence_number, d.vehicle_classes,
              d.issue_date, d.expiry_date, d.demerit_points, d.status,
              c.first_name, c.last_name, c.nic_number
       FROM driving_licences d
       LEFT JOIN citizens c ON d.citizen_id = c.citizen_id
       ${whereSql}
       ORDER BY d.issue_date DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_POLICE_REGISTRY',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    console.error('[getAllPoliceRecords Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve police records.' });
  }
}

/**
 * DELETE /api/admin/police/:id
 * Delete a specific driving licence record
 */
async function deletePoliceRecord(req, res) {
  const { id } = req.params;
  const ctx = getAuditContext(req);

  try {
    const [existing] = await pool.query('SELECT licence_id, citizen_id, licence_number FROM driving_licences WHERE licence_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `Driving licence #${id} not found.` });
    }

    await pool.query('DELETE FROM driving_licences WHERE licence_id = ?', [id]);

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_DELETE_POLICE_RECORD',
      targetCitizenId: existing[0].citizen_id
    });

    return res.status(200).json({
      success: true,
      message: `Driving licence #${id} (${existing[0].licence_number}) was successfully deleted.`
    });
  } catch (error) {
    console.error('[deletePoliceRecord Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete police record.' });
  }
}

/**
 * GET /api/admin/immigration
 * View all passport and travel records
 */
async function getAllImmigrationRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE p.citizen_id LIKE ? OR p.passport_number LIKE ? OR p.issue_country LIKE ? OR p.status LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.nic_number LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM passports p LEFT JOIN citizens c ON p.citizen_id = c.citizen_id ${whereSql}`,
      params
    );
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT p.passport_id, p.citizen_id, p.passport_number, p.issue_date, p.expiry_date,
              p.issue_country, p.status,
              c.first_name, c.last_name, c.nic_number
       FROM passports p
       LEFT JOIN citizens c ON p.citizen_id = c.citizen_id
       ${whereSql}
       ORDER BY p.issue_date DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_IMMIGRATION_REGISTRY',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    console.error('[getAllImmigrationRecords Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve immigration records.' });
  }
}

/**
 * DELETE /api/admin/immigration/:id
 * Delete a specific passport record
 */
async function deleteImmigrationRecord(req, res) {
  const { id } = req.params;
  const ctx = getAuditContext(req);

  try {
    const [existing] = await pool.query('SELECT passport_id, citizen_id, passport_number FROM passports WHERE passport_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `Passport #${id} not found.` });
    }

    await pool.query('DELETE FROM passports WHERE passport_id = ?', [id]);

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_DELETE_IMMIGRATION_RECORD',
      targetCitizenId: existing[0].citizen_id
    });

    return res.status(200).json({
      success: true,
      message: `Passport record #${id} (${existing[0].passport_number}) was successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteImmigrationRecord Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete immigration record.' });
  }
}

/**
 * GET /api/admin/registrar
 * View all vital civil statistics (birth records)
 */
async function getAllRegistrarRecords(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const offset = (page - 1) * limit;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    let params = [];

    if (q) {
      whereSql = `WHERE b.citizen_id LIKE ? OR b.registration_number LIKE ? OR b.place_of_birth LIKE ? OR b.hospital_name LIKE ? OR b.attending_physician LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.nic_number LIKE ?`;
      const term = `%${q}%`;
      params = [term, term, term, term, term, term, term, term];
    }

    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM birth_registrations b LEFT JOIN citizens c ON b.citizen_id = c.citizen_id ${whereSql}`,
      params
    );
    const total = countRow.total;

    const [rows] = await pool.query(
      `SELECT b.birth_reg_id, b.citizen_id, b.registration_number, b.place_of_birth, b.hospital_name,
              b.attending_physician, b.father_citizen_id, b.mother_citizen_id, b.informant_name,
              b.date_of_registration, b.created_at,
              c.first_name, c.last_name, c.nic_number
       FROM birth_registrations b
       LEFT JOIN citizens c ON b.citizen_id = c.citizen_id
       ${whereSql}
       ORDER BY b.date_of_registration DESC, b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const ctx = getAuditContext(req);
    await logAudit({
      ...ctx,
      actionType: 'VIEW',
      moduleAccessed: 'ADMIN_REGISTRAR_REGISTRY',
      targetCitizenId: q || 'ALL'
    });

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }
    });
  } catch (error) {
    console.error('[getAllRegistrarRecords Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve registrar records.' });
  }
}

/**
 * DELETE /api/admin/registrar/birth/:id
 * Delete a specific birth registration record
 */
async function deleteRegistrarRecord(req, res) {
  const { id } = req.params;
  const ctx = getAuditContext(req);

  try {
    const [existing] = await pool.query('SELECT birth_reg_id, citizen_id, registration_number FROM birth_registrations WHERE birth_reg_id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `Birth registration #${id} not found.` });
    }

    await pool.query('DELETE FROM birth_registrations WHERE birth_reg_id = ?', [id]);

    await logAudit({
      ...ctx,
      actionType: 'DELETE',
      moduleAccessed: 'ADMIN_DELETE_REGISTRAR_RECORD',
      targetCitizenId: existing[0].citizen_id
    });

    return res.status(200).json({
      success: true,
      message: `Birth registration #${id} (${existing[0].registration_number}) was successfully deleted.`
    });
  } catch (error) {
    console.error('[deleteRegistrarRecord Error]', error);
    return res.status(500).json({ success: false, message: 'Failed to delete registrar record.' });
  }
}

module.exports = {
  getOverviewCounts,
  getAllCitizens,
  deleteCitizen,
  getAllHospitalRecords,
  deleteHospitalRecord,
  getAllSchoolRecords,
  deleteSchoolRecord,
  getAllUniversityRecords,
  deleteUniversityRecord,
  getAllPoliceRecords,
  deletePoliceRecord,
  getAllImmigrationRecords,
  deleteImmigrationRecord,
  getAllRegistrarRecords,
  deleteRegistrarRecord
};
