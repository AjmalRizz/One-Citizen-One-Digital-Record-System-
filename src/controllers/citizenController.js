const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { logAudit } = require('../middleware/auditLogger');

/**
 * Helper to construct full name
 */
function formatFullName(c) {
  return [c.first_name, c.middle_names, c.last_name].filter(Boolean).join(' ');
}

/**
 * GET /api/citizens/search?q=...
 * Search citizens by Citizen ID or NIC Number
 */
async function searchCitizens(req, res) {
  try {
    const queryTerm = (req.query.q || req.query.query || '').trim();
    if (!queryTerm) {
      return res.status(400).json({
        success: false,
        message: 'Search query parameter (q) is required.'
      });
    }

    const [rows] = await pool.query(
      `SELECT citizen_id, nic_number, first_name, middle_names, last_name, gender, date_of_birth, profile_picture, qr_token
       FROM citizens
       WHERE citizen_id LIKE ? OR nic_number LIKE ? OR first_name LIKE ? OR last_name LIKE ?
       LIMIT 20`,
      [`%${queryTerm}%`, `%${queryTerm}%`, `%${queryTerm}%`, `%${queryTerm}%`]
    );

    const formatted = rows.map(c => ({
      citizen_id: c.citizen_id,
      nic_number: c.nic_number,
      full_name: formatFullName(c),
      first_name: c.first_name,
      last_name: c.last_name,
      gender: c.gender,
      date_of_birth: c.date_of_birth,
      profile_picture: c.profile_picture,
      qr_token: c.qr_token
    }));

    // Audit log
    await logAudit({
      userId: req.user.user_id,
      actionType: 'VIEW',
      moduleAccessed: 'SEARCH',
      targetCitizenId: queryTerm,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted
    });
  } catch (error) {
    console.error('[searchCitizens Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to execute citizen search.',
      error: error.message
    });
  }
}

/**
 * GET /api/citizens/:citizenId
 * Strict Role-Based Citizen Data Access with Audit Logging
 */
async function getCitizenById(req, res) {
  const { citizenId } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const userId = req.user.user_id;
  const associatedCitizenId = req.user.associated_citizen_id;
  const ipAddress = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'UNKNOWN';

  try {
    // 1. CITIZEN Role Security Check: can only view own record
    if (userRole === 'CITIZEN' && associatedCitizenId !== citizenId) {
      await logAudit({
        userId,
        actionType: 'VIEW',
        moduleAccessed: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetCitizenId: citizenId,
        ipAddress,
        userAgent
      });

      return res.status(403).json({
        success: false,
        message: 'Security Violation: You are only permitted to access your own digital record.'
      });
    }

    // 2. Fetch Base Citizen Demographic Record
    const [citizenRows] = await pool.query(
      `SELECT citizen_id, nic_number, first_name, middle_names, last_name, name_si, name_ta, gender,
              date_of_birth, blood_group, profile_picture, current_address, permanent_address, birth_place,
              contact_phone, qr_token, date_of_issue, date_of_expiry, card_serial, signature_name,
              is_deceased, created_at, updated_at
       FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );

    if (citizenRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizenId}' was not found in the national registry.`
      });
    }

    const citizen = citizenRows[0];
    citizen.full_name = formatFullName(citizen);

    const isMaleCitizen = (citizen.gender || '').toUpperCase().startsWith('M');
    const defaultCitizenPic = isMaleCitizen ? '/uploads/citizen_bilaal.jpg' : '/uploads/citizen_yumna.jpg';
    if (!citizen.profile_picture || citizen.profile_picture.includes('citizen_bilaal.jpg') || citizen.profile_picture.includes('citizen_yumna.jpg')) {
      citizen.profile_picture = defaultCitizenPic;
    }

    // Prepare response object strictly partitioned according to role
    let responseData = {
      role_context: userRole,
      citizen_id: citizen.citizen_id
    };

    let moduleAccessed = 'CITIZEN_PROFILE';

    // ----------------------------------------------------
    // ROLE: HOSPITAL
    // Allowed: Demographics, blood group, allergies, medical_records, vaccination_records ONLY
    // Strictly exclude: education, tax, police, passports, properties, marriages
    // ----------------------------------------------------
    if (userRole === 'HOSPITAL') {
      moduleAccessed = 'HEALTHCARE_MODULE';

      responseData.demographics = {
        citizen_id: citizen.citizen_id,
        full_name: citizen.full_name,
        date_of_birth: citizen.date_of_birth,
        gender: citizen.gender,
        blood_group: citizen.blood_group,
        profile_picture: citizen.profile_picture,
        contact_phone: citizen.contact_phone
      };

      const [medicalRecords] = await pool.query(
        `SELECT medical_record_id, diagnosed_condition, chronic_flag, allergies, hospital_name, treating_physician, diagnosis_date, notes, created_at
         FROM medical_records WHERE citizen_id = ? ORDER BY diagnosis_date DESC`,
        [citizenId]
      );

      const [vaccinations] = await pool.query(
        `SELECT vaccine_id, vaccine_name, dose_number, batch_number, administration_date, center_name, administered_by, created_at
         FROM vaccination_records WHERE citizen_id = ? ORDER BY administration_date DESC`,
        [citizenId]
      );

      // Extract unique allergies across records
      const documentedAllergies = medicalRecords
        .map(r => r.allergies)
        .filter(Boolean)
        .join(', ');

      responseData.blood_group = citizen.blood_group;
      responseData.documented_allergies = documentedAllergies || 'None Recorded';
      responseData.medical_records = medicalRecords;
      responseData.vaccination_records = vaccinations;
    }

    // ----------------------------------------------------
    // ROLE: SCHOOL or UNIVERSITY
    // Allowed: Demographics and school_education, higher_education, exam_results ONLY
    // Strictly exclude: medical, tax, police, passports, properties
    // ----------------------------------------------------
    else if (userRole === 'SCHOOL' || userRole === 'UNIVERSITY') {
      moduleAccessed = 'EDUCATION_MODULE';

      responseData.demographics = {
        citizen_id: citizen.citizen_id,
        full_name: citizen.full_name,
        date_of_birth: citizen.date_of_birth,
        gender: citizen.gender,
        profile_picture: citizen.profile_picture,
        permanent_address: citizen.permanent_address,
        contact_phone: citizen.contact_phone
      };

      const [schools] = await pool.query(
        `SELECT record_id, school_name, admission_number, start_year, end_year, highest_grade_passed, conduct_remarks, created_at
         FROM school_education WHERE citizen_id = ? ORDER BY start_year DESC`,
        [citizenId]
      );

      const [higherEd] = await pool.query(
        `SELECT qualification_id, institution_name, qualification_title, qualification_level, class_or_gpa, graduation_year, verification_status, created_at
         FROM higher_education WHERE citizen_id = ? ORDER BY graduation_year DESC`,
        [citizenId]
      );

      const [exams] = await pool.query(
        `SELECT result_id, exam_name, exam_index_number, exam_year, subject, grade, created_at
         FROM exam_results WHERE citizen_id = ? ORDER BY exam_year DESC, subject ASC`,
        [citizenId]
      );

      responseData.school_education = schools;
      responseData.higher_education = higherEd;
      responseData.exam_results = exams;
    }

    // ----------------------------------------------------
    // ROLE: POLICE or IMMIGRATION
    // Allowed: Demographics, passports, driving_licences ONLY
    // Strictly exclude: medical, education, tax, health
    // ----------------------------------------------------
    else if (userRole === 'POLICE' || userRole === 'IMMIGRATION') {
      moduleAccessed = userRole === 'IMMIGRATION' ? 'IMMIGRATION_MODULE' : 'LAW_ENFORCEMENT_MODULE';

      responseData.demographics = {
        citizen_id: citizen.citizen_id,
        nic_number: citizen.nic_number,
        full_name: citizen.full_name,
        date_of_birth: citizen.date_of_birth,
        gender: citizen.gender,
        profile_picture: citizen.profile_picture,
        current_address: citizen.current_address,
        permanent_address: citizen.permanent_address,
        contact_phone: citizen.contact_phone,
        is_deceased: citizen.is_deceased
      };

      const [passports] = await pool.query(
        `SELECT passport_id, passport_number, issue_date, expiry_date, issue_country, status
         FROM passports WHERE citizen_id = ? ORDER BY issue_date DESC`,
        [citizenId]
      );

      const [licences] = await pool.query(
        `SELECT licence_id, licence_number, vehicle_classes, issue_date, expiry_date, demerit_points, status
         FROM driving_licences WHERE citizen_id = ? ORDER BY issue_date DESC`,
        [citizenId]
      );

      responseData.passports = passports;
      responseData.driving_licences = licences;
    }

    // ----------------------------------------------------
    // ROLE: REGISTRAR
    // Allowed: Birth registrations, family relationships, marriages, death registrations
    // ----------------------------------------------------
    else if (userRole === 'REGISTRAR') {
      moduleAccessed = 'CIVIL_REGISTRY_MODULE';

      responseData.demographics = citizen;

      const [births] = await pool.query(
        `SELECT b.*,
                COALESCE(b.father_name, CONCAT_WS(' ', fc.first_name, fc.middle_names, fc.last_name)) AS display_father_name,
                COALESCE(b.father_nic, fc.nic_number) AS display_father_nic,
                COALESCE(b.father_phone, fc.contact_phone) AS display_father_phone,
                COALESCE(b.mother_name, CONCAT_WS(' ', mc.first_name, mc.middle_names, mc.last_name)) AS display_mother_name,
                COALESCE(b.mother_nic, mc.nic_number) AS display_mother_nic,
                COALESCE(b.mother_phone, mc.contact_phone) AS display_mother_phone
         FROM birth_registrations b
         LEFT JOIN citizens fc ON b.father_citizen_id = fc.citizen_id
         LEFT JOIN citizens mc ON b.mother_citizen_id = mc.citizen_id
         WHERE b.citizen_id = ?`,
        [citizenId]
      );

      const [relationships] = await pool.query(
        `SELECT fr.*, c.first_name, c.last_name, c.nic_number
         FROM family_relationships fr
         LEFT JOIN citizens c ON fr.related_citizen_id = c.citizen_id
         WHERE fr.citizen_id = ?`,
        [citizenId]
      );

      const [marriages] = await pool.query(
        `SELECT m.*, 
                c1.first_name as spouse_one_first, c1.last_name as spouse_one_last,
                c2.first_name as spouse_two_first, c2.last_name as spouse_two_last
         FROM marriages m
         LEFT JOIN citizens c1 ON m.spouse_one_id = c1.citizen_id
         LEFT JOIN citizens c2 ON m.spouse_two_id = c2.citizen_id
         WHERE m.spouse_one_id = ? OR m.spouse_two_id = ?`,
        [citizenId, citizenId]
      );

      const [deaths] = await pool.query(
        `SELECT * FROM death_registrations WHERE citizen_id = ?`,
        [citizenId]
      );

      responseData.birth_registrations = births;
      responseData.family_relationships = relationships;
      responseData.marriages = marriages;
      responseData.death_registrations = deaths;
    }

    // ----------------------------------------------------
    // ROLE: CITIZEN or ADMIN
    // CITIZEN gets their complete record. ADMIN gets full access.
    // ----------------------------------------------------
    else {
      moduleAccessed = userRole === 'ADMIN' ? 'ADMIN_CITIZEN_AUDIT' : 'CITIZEN_FULL_PORTAL';

      responseData.demographics = citizen;

      const [medical] = await pool.query(
        `SELECT * FROM medical_records WHERE citizen_id = ? ORDER BY diagnosis_date DESC`,
        [citizenId]
      );
      const [vaccines] = await pool.query(
        `SELECT * FROM vaccination_records WHERE citizen_id = ? ORDER BY administration_date DESC`,
        [citizenId]
      );
      const [schools] = await pool.query(
        `SELECT * FROM school_education WHERE citizen_id = ? ORDER BY start_year DESC`,
        [citizenId]
      );
      const [higher] = await pool.query(
        `SELECT * FROM higher_education WHERE citizen_id = ? ORDER BY graduation_year DESC`,
        [citizenId]
      );
      const [exams] = await pool.query(
        `SELECT * FROM exam_results WHERE citizen_id = ? ORDER BY exam_year DESC, subject ASC`,
        [citizenId]
      );
      const [passports] = await pool.query(
        `SELECT * FROM passports WHERE citizen_id = ? ORDER BY issue_date DESC`,
        [citizenId]
      );
      const [licences] = await pool.query(
        `SELECT * FROM driving_licences WHERE citizen_id = ? ORDER BY issue_date DESC`,
        [citizenId]
      );
      const [births] = await pool.query(
        `SELECT b.*,
                COALESCE(b.father_name, CONCAT_WS(' ', fc.first_name, fc.middle_names, fc.last_name)) AS display_father_name,
                COALESCE(b.father_nic, fc.nic_number) AS display_father_nic,
                COALESCE(b.father_phone, fc.contact_phone) AS display_father_phone,
                COALESCE(b.mother_name, CONCAT_WS(' ', mc.first_name, mc.middle_names, mc.last_name)) AS display_mother_name,
                COALESCE(b.mother_nic, mc.nic_number) AS display_mother_nic,
                COALESCE(b.mother_phone, mc.contact_phone) AS display_mother_phone
         FROM birth_registrations b
         LEFT JOIN citizens fc ON b.father_citizen_id = fc.citizen_id
         LEFT JOIN citizens mc ON b.mother_citizen_id = mc.citizen_id
         WHERE b.citizen_id = ?`,
        [citizenId]
      );
      const [marriages] = await pool.query(
        `SELECT * FROM marriages WHERE spouse_one_id = ? OR spouse_two_id = ?`,
        [citizenId, citizenId]
      );
      const [properties] = await pool.query(
        `SELECT * FROM property_ownership WHERE citizen_id = ?`,
        [citizenId]
      );
      const [employment] = await pool.query(
        `SELECT * FROM employment_history WHERE citizen_id = ? ORDER BY start_date DESC`,
        [citizenId]
      );

      responseData.medical_records = medical;
      responseData.vaccination_records = vaccines;
      responseData.school_education = schools;
      responseData.higher_education = higher;
      responseData.exam_results = exams;
      responseData.passports = passports;
      responseData.driving_licences = licences;
      responseData.birth_registrations = births;
      responseData.marriages = marriages;
      responseData.property_ownership = properties;
      responseData.employment_history = employment;
    }

    // Mandatory Audit Logging for citizen access
    await logAudit({
      userId,
      actionType: 'VIEW',
      moduleAccessed,
      targetCitizenId: citizenId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[getCitizenById Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve citizen record.',
      error: error.message
    });
  }
}

/**
 * POST /api/citizens/:citizenId/photo
 * Upload or update official citizen profile photograph
 */
async function uploadCitizenPhoto(req, res) {
  const { citizenId } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const associatedCitizenId = req.user.associated_citizen_id;

  try {
    // 1. Authorization: Only the citizen themselves or REGISTRAR / ADMIN can update photo
    if (userRole === 'CITIZEN' && associatedCitizenId !== citizenId) {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: You may only upload a profile photo for your own record.'
      });
    }

    if (!['CITIZEN', 'REGISTRAR', 'ADMIN'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Your role is not authorized to update citizen photographs.'
      });
    }

    // 2. Validate uploaded file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No photo file provided. Please select an image file (JPEG, PNG, WebP).'
      });
    }

    const photoUrl = `/uploads/${req.file.filename}`;

    // 3. Verify citizen exists
    const [citizenCheck] = await pool.query(
      `SELECT citizen_id FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );
    if (citizenCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizenId}' not found.`
      });
    }

    // 4. Update citizen profile_picture
    await pool.query(
      `UPDATE citizens SET profile_picture = ? WHERE citizen_id = ?`,
      [photoUrl, citizenId]
    );

    // 5. If user account is linked to this citizen, update users.profile_picture as well
    await pool.query(
      `UPDATE users SET profile_picture = ? WHERE associated_citizen_id = ?`,
      [photoUrl, citizenId]
    );

    // 6. Audit Logging
    await logAudit({
      userId: req.user.user_id,
      actionType: 'UPDATE',
      moduleAccessed: 'PROFILE_PHOTO',
      targetCitizenId: citizenId,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN'
    });

    return res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully.',
      photo_url: photoUrl
    });
  } catch (error) {
    console.error('[uploadCitizenPhoto Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture.',
      error: error.message
    });
  }
}

/**
 * PUT /api/citizens/:citizenId
 * Update citizen details (Self-service for citizen contact/address; Administrative for civil status)
 */
async function updateCitizenInfo(req, res) {
  const { citizenId } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const userId = req.user.user_id;
  const associatedCitizenId = req.user.associated_citizen_id;
  const ipAddress = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'UNKNOWN';

  try {
    // 1. RBAC authorization: Strictly ONLY ADMIN can edit citizen information
    if (userRole !== 'ADMIN') {
      await logAudit({
        userId,
        actionType: 'UPDATE',
        moduleAccessed: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        targetCitizenId: citizenId,
        ipAddress,
        userAgent
      });
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only system administrators are authorized to edit citizen information.'
      });
    }

    // 2. Fetch existing citizen
    const [existingRows] = await pool.query(
      `SELECT * FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizenId}' not found.`
      });
    }

    const {
      contact_phone,
      current_address,
      permanent_address,
      first_name,
      middle_names,
      last_name,
      blood_group
    } = req.body;

    let updateFields = [];
    let updateParams = [];

    // Fields editable by Citizen (and Admin/Registrar)
    if (contact_phone !== undefined) {
      const cleanPhone = (contact_phone || '').trim();
      if (cleanPhone && !/^[+0-9\s\-()]{7,25}$/.test(cleanPhone)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid contact phone format. Please enter a valid phone number.'
        });
      }
      updateFields.push('contact_phone = ?');
      updateParams.push(cleanPhone);
    }

    if (current_address !== undefined) {
      const cleanAddr = (current_address || '').trim();
      if (cleanAddr.length < 3 || cleanAddr.length > 255) {
        return res.status(400).json({
          success: false,
          message: 'Current address must be between 3 and 255 characters.'
        });
      }
      updateFields.push('current_address = ?');
      updateParams.push(cleanAddr);
    }

    if (permanent_address !== undefined) {
      const cleanPermAddr = (permanent_address || '').trim();
      if (cleanPermAddr.length < 3 || cleanPermAddr.length > 255) {
        return res.status(400).json({
          success: false,
          message: 'Permanent address must be between 3 and 255 characters.'
        });
      }
      updateFields.push('permanent_address = ?');
      updateParams.push(cleanPermAddr);
    }

    // Civil Demographics fields: Editable only by REGISTRAR or ADMIN
    if (['REGISTRAR', 'ADMIN'].includes(userRole)) {
      if (first_name !== undefined) {
        const cleanFirst = (first_name || '').trim();
        if (cleanFirst && cleanFirst.length >= 2) {
          updateFields.push('first_name = ?');
          updateParams.push(cleanFirst);
        }
      }
      if (middle_names !== undefined) {
        updateFields.push('middle_names = ?');
        updateParams.push((middle_names || '').trim());
      }
      if (last_name !== undefined) {
        const cleanLast = (last_name || '').trim();
        if (cleanLast && cleanLast.length >= 2) {
          updateFields.push('last_name = ?');
          updateParams.push(cleanLast);
        }
      }
    }

    // Blood Group: Editable by HOSPITAL, REGISTRAR, or ADMIN
    if (['HOSPITAL', 'REGISTRAR', 'ADMIN'].includes(userRole)) {
      if (blood_group !== undefined) {
        const cleanBlood = (blood_group || '').trim().toUpperCase();
        if (['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(cleanBlood)) {
          updateFields.push('blood_group = ?');
          updateParams.push(cleanBlood);
        }
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid editable fields provided for update.'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateParams.push(citizenId);

    const sql = `UPDATE citizens SET ${updateFields.join(', ')} WHERE citizen_id = ?`;
    await pool.query(sql, updateParams);

    // Fetch updated record
    const [updatedRows] = await pool.query(
      `SELECT citizen_id, nic_number, first_name, middle_names, last_name, gender,
              date_of_birth, blood_group, profile_picture, current_address, permanent_address,
              contact_phone, qr_token, is_deceased, created_at, updated_at
       FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );

    const updatedCitizen = updatedRows[0];
    updatedCitizen.full_name = formatFullName(updatedCitizen);

    // Mandatory Audit Log
    await logAudit({
      userId,
      actionType: 'UPDATE',
      moduleAccessed: 'CITIZEN_DEMOGRAPHICS_UPDATE',
      targetCitizenId: citizenId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Citizen information updated successfully.',
      data: updatedCitizen
    });
  } catch (error) {
    console.error('[updateCitizenInfo Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update citizen information.',
      error: error.message
    });
  }
}

/**
 * DELETE /api/citizens/:citizenId/photo
 * Remove citizen profile photograph and restore default initials avatar
 */
async function deleteCitizenPhoto(req, res) {
  const { citizenId } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const userId = req.user.user_id;
  const associatedCitizenId = req.user.associated_citizen_id;
  const ipAddress = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'UNKNOWN';

  try {
    // 1. Citizens are strictly forbidden from deleting information
    if (userRole === 'CITIZEN') {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Citizens are not permitted to delete information.'
      });
    }

    if (!['ADMIN', 'REGISTRAR'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only administrators and registrars can delete profile photos.'
      });
    }

    // 2. Fetch existing citizen photo
    const [citizenRows] = await pool.query(
      `SELECT citizen_id, profile_picture FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );

    if (citizenRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizenId}' not found.`
      });
    }

    const currentPhoto = citizenRows[0].profile_picture;

    // 3. Unlink physical file if present
    if (currentPhoto && currentPhoto.startsWith('/uploads/')) {
      const diskPath = path.resolve(__dirname, '..', '..', currentPhoto.replace(/^\//, ''));
      if (fs.existsSync(diskPath)) {
        try {
          fs.unlinkSync(diskPath);
        } catch (err) {
          console.warn(`[deleteCitizenPhoto] Could not unlink ${diskPath}:`, err.message);
        }
      }
    }

    // 4. Update database to NULL
    await pool.query('UPDATE citizens SET profile_picture = NULL WHERE citizen_id = ?', [citizenId]);
    await pool.query('UPDATE users SET profile_picture = NULL WHERE associated_citizen_id = ?', [citizenId]);

    // 5. Audit Logging
    await logAudit({
      userId,
      actionType: 'DELETE',
      moduleAccessed: 'PROFILE_PHOTO',
      targetCitizenId: citizenId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Profile photograph deleted successfully. Reverted to initials avatar.'
    });
  } catch (error) {
    console.error('[deleteCitizenPhoto Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete profile photograph.',
      error: error.message
    });
  }
}

/**
 * DELETE /api/citizens/:citizenId/field/:fieldName
 * Delete / Clear specific optional citizen information fields (contact_phone, current_address, permanent_address)
 */
async function clearCitizenField(req, res) {
  const { citizenId, fieldName } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const userId = req.user.user_id;
  const associatedCitizenId = req.user.associated_citizen_id;
  const ipAddress = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'UNKNOWN';

  const allowedFields = ['contact_phone', 'current_address', 'permanent_address'];
  if (!allowedFields.includes(fieldName)) {
    return res.status(400).json({
      success: false,
      message: `Field '${fieldName}' cannot be deleted. Permitted fields to clear: ${allowedFields.join(', ')}`
    });
  }

  try {
    // 1. Citizens are strictly forbidden from deleting information
    if (userRole === 'CITIZEN') {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Citizens are not permitted to delete information.'
      });
    }

    if (!['ADMIN', 'REGISTRAR'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only administrators and registrars can clear citizen information fields.'
      });
    }

    // 2. Verify citizen exists
    const [citizenRows] = await pool.query(
      `SELECT * FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );

    if (citizenRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizenId}' not found.`
      });
    }

    // 3. Clear the field in DB
    await pool.query(`UPDATE citizens SET ?? = NULL WHERE citizen_id = ?`, [fieldName, citizenId]);

    // 4. Audit Log
    await logAudit({
      userId,
      actionType: 'DELETE',
      moduleAccessed: `CITIZEN_DEMOGRAPHICS_DELETE_${fieldName.toUpperCase()}`,
      targetCitizenId: citizenId,
      ipAddress,
      userAgent
    });

    // 5. Fetch updated citizen
    const [updatedRows] = await pool.query(
      `SELECT citizen_id, nic_number, first_name, middle_names, last_name, gender,
              date_of_birth, blood_group, profile_picture, current_address, permanent_address,
              contact_phone, qr_token, is_deceased, is_active, created_at, updated_at
       FROM citizens WHERE citizen_id = ?`,
      [citizenId]
    );

    const updated = updatedRows[0];
    updated.full_name = formatFullName(updated);

    return res.status(200).json({
      success: true,
      message: `Field '${fieldName}' was successfully cleared.`,
      data: updated
    });
  } catch (error) {
    console.error('[clearCitizenField Error]', error);
    return res.status(500).json({
      success: false,
      message: `Failed to clear field '${fieldName}'.`,
      error: error.message
    });
  }
}

/**
 * DELETE /api/citizens/:citizenId
 * Delete or deactivate citizen record from the national registry
 */
async function deleteCitizenRecord(req, res) {
  const { citizenId } = req.params;
  const userRole = (req.user.role_name || '').toUpperCase();
  const userId = req.user.user_id;
  const associatedCitizenId = req.user.associated_citizen_id;
  const ipAddress = req.ip || req.connection?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'UNKNOWN';
  const isPurge = req.query.purge === 'true';

  try {
    // 1. Citizens are strictly forbidden from deleting information
    if (userRole === 'CITIZEN') {
      return res.status(403).json({
        success: false,
        message: 'Security Violation: Citizens are not permitted to delete information.'
      });
    }

    // 2. Administrative Role Check
    if (!['ADMIN', 'REGISTRAR'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Registrars and Administrators can delete or deactivate citizen records.'
      });
    }

    // Verify existence
    const [existing] = await pool.query(`SELECT citizen_id, first_name, last_name FROM citizens WHERE citizen_id = ?`, [citizenId]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Citizen with ID '${citizenId}' was not found.`
      });
    }

    if (isPurge && userRole === 'ADMIN') {
      // Complete cascade purge of test/corrupt record
      await pool.query('DELETE FROM audit_logs WHERE target_citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM document_uploads WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM family_relationships WHERE citizen_id = ? OR related_citizen_id = ?', [citizenId, citizenId]);
      await pool.query('DELETE FROM birth_registrations WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM death_registrations WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM driving_licences WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM passports WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM medical_records WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM vaccination_records WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM exam_results WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM higher_education WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM school_education WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM employment_history WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM property_ownership WHERE citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM marriages WHERE spouse_one_id = ? OR spouse_two_id = ?', [citizenId, citizenId]);
      await pool.query('DELETE FROM users WHERE associated_citizen_id = ?', [citizenId]);
      await pool.query('DELETE FROM citizens WHERE citizen_id = ?', [citizenId]);

      await logAudit({
        userId,
        actionType: 'DELETE',
        moduleAccessed: 'CITIZEN_RECORD_PURGE',
        targetCitizenId: citizenId,
        ipAddress,
        userAgent
      });

      return res.status(200).json({
        success: true,
        message: `Citizen record '${citizenId}' and all linked registry entries were permanently purged.`
      });
    }

    // Default: Soft Deactivation
    await pool.query('UPDATE citizens SET is_active = 0 WHERE citizen_id = ?', [citizenId]);
    await pool.query('UPDATE users SET is_active = 0 WHERE associated_citizen_id = ?', [citizenId]);

    await logAudit({
      userId,
      actionType: 'DELETE',
      moduleAccessed: 'CITIZEN_RECORD_DEACTIVATE',
      targetCitizenId: citizenId,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: `Citizen record '${citizenId}' was successfully deactivated in the national registry.`
    });
  } catch (error) {
    console.error('[deleteCitizenRecord Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete or deactivate citizen record.',
      error: error.message
    });
  }
}

module.exports = {
  getCitizenById,
  searchCitizens,
  uploadCitizenPhoto,
  updateCitizenInfo,
  deleteCitizenPhoto,
  clearCitizenField,
  deleteCitizenRecord
};
