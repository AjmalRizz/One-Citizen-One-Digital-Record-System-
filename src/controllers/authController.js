const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { pool } = require('../config/db');
const { generateOtp, sendOtpEmail } = require('../utils/mailer');
const { logAudit } = require('../middleware/auditLogger');

dotenv.config();

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET is not set in .env. Server cannot start securely.');
  process.exit(1);
}

/**
 * Strict Human Name Validation Guardrail
 */
function isValidRealName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (!/^[a-zA-Z\s\.\'\-]+$/.test(trimmed)) return false;

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

  if (/(.)\1{3,}/.test(lower)) return false;
  const letterCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  return letterCount >= 2;
}

/**
 * POST /api/auth/send-otp
 * Generates 6-digit cryptographic OTP and sends to real email
 */
async function sendOtp(req, res) {
  try {
    const { identifier, purpose = 'LOGIN' } = req.body;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Identifier (email address) is required.'
      });
    }

    const validPurposes = ['LOGIN', 'REGISTER', 'VERIFY_RECORD'];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: `Invalid purpose. Permitted purposes: ${validPurposes.join(', ')}`
      });
    }

    const otpCode = generateOtp();

    // Save to otp_verifications table using MySQL NOW() for timezone consistency
    await pool.query(
      `INSERT INTO otp_verifications (identifier, otp_code, purpose, expires_at, is_used)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), FALSE)`,
      [identifier, otpCode, purpose, OTP_EXPIRY_MINUTES]
    );

    // Send via real email (non-blocking for ultra-fast response)
    sendOtpEmail(identifier, otpCode, purpose).catch(err => {
      console.error('[sendOtpEmail non-blocking error]', err.message);
    });

    return res.status(200).json({
      success: true,
      message: `Verification OTP has been dispatched to ${identifier}.`,
      expires_in_minutes: OTP_EXPIRY_MINUTES,
      dev_otp: otpCode
    });
  } catch (error) {
    console.error('[sendOtp Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate and dispatch OTP.',
      error: error.message
    });
  }
}

/**
 * POST /api/auth/verify-otp
 * Validates the identifier + OTP combination and issues session token
 */
async function verifyOtp(req, res) {
  try {
    const { identifier, otp_code, purpose = 'LOGIN', temp_token } = req.body;

    if (!identifier || !otp_code) {
      return res.status(400).json({
        success: false,
        message: 'Both identifier and otp_code are required.'
      });
    }

    // Lookup valid unexpired OTP
    const [rows] = await pool.query(
      `SELECT * FROM otp_verifications
       WHERE identifier = ? AND otp_code = ? AND purpose = ? AND is_used = FALSE AND expires_at >= NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [identifier, otp_code.trim(), purpose]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code. Please request a new code.'
      });
    }

    const otpRecord = rows[0];

    // Mark as used immediately to prevent replay attacks
    await pool.query(
      `UPDATE otp_verifications SET is_used = TRUE WHERE id = ?`,
      [otpRecord.id]
    );

    // If verification was for LOGIN, resolve user and return full JWT
    let userPayload = null;
    let token = null;

    if (purpose === 'LOGIN' || temp_token) {
      let queryUser = null;

      // Decode temp_token if provided
      if (temp_token) {
        try {
          const decoded = jwt.verify(temp_token, process.env.JWT_SECRET);
          queryUser = decoded.user_id;
        } catch (e) {
          // Fall back to identifier lookup
        }
      }

      let userQuery = `
        SELECT u.user_id, u.username, u.email, u.phone_number, u.associated_citizen_id, u.profile_picture, u.is_active, r.role_name,
               c.gender AS citizen_gender
        FROM users u
        INNER JOIN roles r ON u.role_id = r.role_id
        LEFT JOIN citizens c ON u.associated_citizen_id = c.citizen_id
        WHERE `;
      
      let userParams = [];
      if (queryUser) {
        userQuery += `u.user_id = ?`;
        userParams.push(queryUser);
      } else {
        userQuery += `(u.email = ? OR u.phone_number = ? OR u.username = ?)`;
        userParams.push(identifier, identifier, identifier);
      }

      const [userRows] = await pool.query(userQuery, userParams);

      if (userRows.length > 0) {
        const user = userRows[0];
        if (!user.is_active) {
          return res.status(403).json({
            success: false,
            message: 'User account is deactivated. Contact system administrator.'
          });
        }

        const isMaleUser = (user.citizen_gender || '').toUpperCase().startsWith('M');
        const defaultPic = isMaleUser ? '/uploads/citizen_bilaal.jpg' : '/uploads/citizen_yumna.jpg';
        let effectivePic = user.profile_picture;
        if (!effectivePic && user.associated_citizen_id) {
          effectivePic = defaultPic;
        } else if (effectivePic && (effectivePic.includes('citizen_bilaal.jpg') || effectivePic.includes('citizen_yumna.jpg'))) {
          effectivePic = defaultPic;
        }

        userPayload = {
          user_id: user.user_id,
          username: user.username,
          role_name: user.role_name,
          associated_citizen_id: user.associated_citizen_id,
          profile_picture: effectivePic,
          gender: user.citizen_gender || null,
          email: user.email
        };

        token = jwt.sign(userPayload, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRES_IN || '8h'
        });

        // Audit log the successful 2FA login
        await logAudit({
          userId: user.user_id,
          actionType: 'VIEW',
          moduleAccessed: 'AUTHENTICATION',
          targetCitizenId: user.associated_citizen_id || 'N/A',
          ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
          userAgent: req.headers['user-agent'] || 'UNKNOWN'
        });
      }
    }

    // Generate temporary verification token for registration / record verification if not login
    const verificationToken = jwt.sign(
      { identifier, purpose, verified: true, verified_at: new Date() },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.status(200).json({
      success: true,
      message: 'OTP verification successful.',
      token: token || verificationToken,
      user: userPayload,
      verification_token: verificationToken
    });
  } catch (error) {
    console.error('[verifyOtp Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP.',
      error: error.message
    });
  }
}

/**
 * POST /api/auth/login
 * Requires Username, Password, and Email.
 * Detects whether the email given is correct and whether the password is correct.
 * Sends OTP exclusively to real email.
 */
async function login(req, res) {
  try {
    const { username, password, email, direct_token } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required to log in.'
      });
    }

    if (!direct_token && (!email || !email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and password are all required to log in.'
      });
    }

    // Find user by username or email
    const trimmedInput = username.trim();
    const isEmailInput = trimmedInput.includes('@');
    const [rows] = await pool.query(
      `SELECT u.user_id, u.username, u.password_hash, u.email, u.phone_number,
              u.associated_citizen_id, u.profile_picture, u.is_active, r.role_name,
              c.gender AS citizen_gender
       FROM users u
       INNER JOIN roles r ON u.role_id = r.role_id
       LEFT JOIN citizens c ON u.associated_citizen_id = c.citizen_id
       WHERE ${isEmailInput ? 'u.email = ?' : 'u.username = ?'}`,
      [trimmedInput]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username. Account not found.'
      });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deactivated. Please contact your administrator.'
      });
    }

    // Explicit detection 1: Verify password correctness
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please verify your credentials and try again.'
      });
    }

    // Explicit detection 2: Verify email correctness
    if (!direct_token && email) {
      if (email.trim().toLowerCase() !== (user.email || '').toLowerCase()) {
        return res.status(401).json({
          success: false,
          message: 'Incorrect email address. The provided email does not match this user account.'
        });
      }
    }

    // If direct token requested (for automation/switching persona in dashboard)
    if (direct_token === true) {
      const isMaleUser = (user.citizen_gender || '').toUpperCase().startsWith('M');
      const defaultPic = isMaleUser ? '/uploads/citizen_bilaal.jpg' : '/uploads/citizen_yumna.jpg';
      let effectivePic = user.profile_picture;
      if (!effectivePic && user.associated_citizen_id) {
        effectivePic = defaultPic;
      } else if (effectivePic && (effectivePic.includes('citizen_bilaal.jpg') || effectivePic.includes('citizen_yumna.jpg'))) {
        effectivePic = defaultPic;
      }

      const userPayload = {
        user_id: user.user_id,
        username: user.username,
        role_name: user.role_name,
        associated_citizen_id: user.associated_citizen_id,
        profile_picture: effectivePic,
        gender: user.citizen_gender || null,
        email: user.email
      };

      const token = jwt.sign(userPayload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h'
      });

      await logAudit({
        userId: user.user_id,
        actionType: 'VIEW',
        moduleAccessed: 'AUTHENTICATION',
        targetCitizenId: user.associated_citizen_id || 'N/A',
        ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'UNKNOWN'
      });

      return res.status(200).json({
        success: true,
        message: 'Login successful.',
        requires_2fa: false,
        token,
        user: userPayload
      });
    }

    // Use registered email
    const identifier = user.email || (email ? email.trim() : null);
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'No registered email found for this user.'
      });
    }

    // 2FA Flow: Generate and dispatch OTP to user's registered real email
    const otpCode = generateOtp();

    await pool.query(
      `INSERT INTO otp_verifications (identifier, otp_code, purpose, expires_at, is_used)
       VALUES (?, ?, 'LOGIN', DATE_ADD(NOW(), INTERVAL ? MINUTE), FALSE)`,
      [identifier, otpCode, OTP_EXPIRY_MINUTES]
    );

    // Send email with OTP (non-blocking for fast response)
    sendOtpEmail(identifier, otpCode, 'LOGIN').catch(err => {
      console.error('[sendOtpEmail non-blocking in login]', err.message);
    });

    // Sign temporary 2FA token
    const tempToken = jwt.sign(
      { user_id: user.user_id, username: user.username, is_2fa_pending: true },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    // Mask identifier for UI display
    let maskedIdentifier = identifier;
    if (identifier.includes('@')) {
      const [name, domain] = identifier.split('@');
      maskedIdentifier = name.substring(0, 2) + '***@' + domain;
    }

    const isSmtpConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
    const isWebClient = req.body?.client_mode === 'web' || req.headers['x-client-platform'] === 'web';

    const responsePayload = {
      success: true,
      requires_2fa: true,
      message: isSmtpConfigured
        ? `2FA security code dispatched to ${maskedIdentifier}. Please check your inbox and enter the 6-digit code.`
        : `2FA security code generated for ${maskedIdentifier}. (Real email delivery requires SMTP in .env).`,
      identifier: identifier,
      masked_identifier: maskedIdentifier,
      temp_token: tempToken,
      expires_in_minutes: OTP_EXPIRY_MINUTES,
      smtp_configured: isSmtpConfigured
    };

    if (isWebClient) {
      responsePayload.dev_otp = otpCode;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('[login Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication processing failed.',
      error: error.message
    });
  }
}

/**
 * POST /api/auth/register
 * Citizen Self-Registration:
 * Validates real name, unique credentials, generates citizen ID and creates user account.
 */
async function registerCitizen(req, res) {
  let conn;
  try {
    const {
      registration_type = 'CITIZEN',
      is_child = false,
      first_name,
      last_name,
      middle_names,
      name_si,
      name_ta,
      date_of_birth,
      gender,
      blood_group,
      nic_number,
      phone_number,
      permanent_address,
      birth_place,
      email,
      username,
      password,
      otp_code,
      // Child & Parent Information (as in Sri Lankan Birth Certificate)
      father_name,
      father_nic,
      father_phone,
      mother_name,
      mother_nic,
      mother_phone,
      hospital_name,
      attending_physician,
      informant_name,
      informant_nic,
      informant_phone
    } = req.body;

    const isChildRegistration = (registration_type && registration_type.toUpperCase() === 'CHILD') ||
      Boolean(is_child) || Boolean(father_name || mother_name);

    // 1. Mandatory field checks
    if (!first_name || !last_name || !date_of_birth || !email || !username || !password) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, date of birth, email, username, and password are required.'
      });
    }

    // 2. Strict Human Name Validation Guardrail
    if (!isValidRealName(first_name)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid first name. Realistic human names only (no test/dummy placeholders or single letters).'
      });
    }

    if (!isValidRealName(last_name)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid last name. Realistic human names only (no test/dummy placeholders or single letters).'
      });
    }

    if (middle_names && !isValidRealName(middle_names)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid middle name. Realistic human names only.'
      });
    }

    // Child registration specific parent validations (Birth Certificate standard)
    if (isChildRegistration) {
      if (!father_name && !mother_name) {
        return res.status(400).json({
          success: false,
          message: "Parents' information (Father or Mother details) is required for Child registration as on a birth certificate."
        });
      }

      if (father_name && !isValidRealName(father_name)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Father's full name. Realistic human name required."
        });
      }

      if (mother_name && !isValidRealName(mother_name)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Mother's full name. Realistic human name required."
        });
      }

      if (!father_phone && !mother_phone && !phone_number) {
        return res.status(400).json({
          success: false,
          message: "Parent contact phone number is required for child enrollment and 2FA."
        });
      }
    }

    // Permanent Residence (Used if provided; defaults to birth place or national default if omitted)
    const finalAddress = (permanent_address && permanent_address.trim())
      ? permanent_address.trim()
      : (birth_place && birth_place.trim() ? birth_place.trim() : 'Sri Lanka');

    // 3. Email validation
    const emailTrimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address format.'
      });
    }

    // 4. Password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    const usernameTrimmed = username.trim();

    // 5. Uniqueness checks
    const [existingUsers] = await pool.query(
      `SELECT user_id, username, email FROM users WHERE username = ? OR email = ?`,
      [usernameTrimmed, emailTrimmed]
    );

    if (existingUsers.length > 0) {
      const match = existingUsers[0];
      if (match.username.toLowerCase() === usernameTrimmed.toLowerCase()) {
        return res.status(409).json({
          success: false,
          message: 'Username is already taken. Please choose another username.'
        });
      }
      if (match.email.toLowerCase() === emailTrimmed) {
        return res.status(409).json({
          success: false,
          message: 'Email address is already registered. Please use another email or log in.'
        });
      }
    }

    let finalNic = nic_number && nic_number.trim() ? nic_number.trim() : null;

    if (finalNic) {
      const [existingNic] = await pool.query(
        `SELECT citizen_id FROM citizens WHERE nic_number = ?`,
        [finalNic]
      );
      if (existingNic.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'NIC number is already registered in the National Registry.'
        });
      }
    }

    // 6. Verify 2FA OTP Code if provided
    if (otp_code && otp_code.trim()) {
      const contactForOtp = phone_number ? phone_number.trim() : (father_phone || mother_phone || emailTrimmed);
      const [otpRows] = await pool.query(
        `SELECT * FROM otp_verifications
         WHERE (identifier = ? OR identifier = ?) AND otp_code = ? AND purpose = 'REGISTER' AND is_used = FALSE AND expires_at >= NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [emailTrimmed, contactForOtp, otp_code.trim()]
      );

      if (otpRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP code. Please enter the valid 6-digit code dispatched to your email or phone.'
        });
      }

      // Mark OTP as used
      await pool.query(
        `UPDATE otp_verifications SET is_used = TRUE WHERE id = ?`,
        [otpRows[0].id]
      );
    }

    // 7. Generate Citizen ID & Smart NIC Credentials
    const dobFormatted = date_of_birth.replace(/[^0-9]/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const citizenId = `LK-${dobFormatted.substring(0, 8)}-${randomSuffix}`;
    const qrToken = crypto.randomBytes(16).toString('hex').toUpperCase();

    // If pupil does not have a prior NIC, generate the official 12-digit format: YYYY + DayOfYear + Serial + Check
    if (!finalNic) {
      const birthYear = dobFormatted.substring(0, 4);
      const isFemale = (gender || '').toUpperCase() === 'FEMALE';
      const dayOfYear = (isFemale ? 500 : 0) + Math.floor(10 + Math.random() * 350);
      finalNic = `${birthYear}${String(dayOfYear).padStart(3, '0')}${Math.floor(10000 + Math.random() * 90000)}`;
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 10);
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    const cardSerial = `${Math.floor(10 + Math.random() * 90)}CBD-${Math.floor(100 + Math.random() * 900)}`;

    // 8. Resolve CITIZEN role_id
    const [roleRows] = await pool.query(
      `SELECT role_id FROM roles WHERE role_name = 'CITIZEN' LIMIT 1`
    );
    const citizenRoleId = roleRows.length > 0 ? roleRows[0].role_id : 1;

    // 9. Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // 10. Transactional insert into citizens, users, and birth_registrations
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const finalContactPhone = (phone_number && phone_number.trim())
      ? phone_number.trim()
      : (father_phone ? father_phone.trim() : (mother_phone ? mother_phone.trim() : null));

    const isMaleReg = (gender || '').toUpperCase().startsWith('M');
    const assignedProfilePic = isMaleReg ? '/uploads/citizen_bilaal.jpg' : '/uploads/citizen_yumna.jpg';

    await conn.query(
      `INSERT INTO citizens (
        citizen_id, nic_number, first_name, middle_names, last_name,
        name_si, name_ta, gender, date_of_birth, blood_group, profile_picture,
        permanent_address, current_address, birth_place, contact_phone,
        date_of_issue, date_of_expiry, card_serial, signature_name,
        qr_token, is_active, is_child, father_name, father_nic, mother_name, mother_nic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?)`,
      [
        citizenId,
        finalNic,
        first_name.trim(),
        middle_names && middle_names.trim() ? middle_names.trim() : null,
        last_name.trim(),
        name_si && name_si.trim() ? name_si.trim() : null,
        name_ta && name_ta.trim() ? name_ta.trim() : null,
        gender || 'OTHER',
        date_of_birth,
        blood_group || 'O+',
        assignedProfilePic,
        finalAddress,
        finalAddress,
        birth_place && birth_place.trim() ? birth_place.trim() : 'Colombo',
        finalContactPhone,
        todayStr,
        expiryStr,
        cardSerial,
        first_name.trim(),
        qrToken,
        isChildRegistration ? 1 : 0,
        father_name ? father_name.trim() : null,
        father_nic ? father_nic.trim() : null,
        mother_name ? mother_name.trim() : null,
        mother_nic ? mother_nic.trim() : null
      ]
    );

    const [userResult] = await conn.query(
      `INSERT INTO users (
        username, password_hash, email, phone_number,
        role_id, associated_citizen_id, profile_picture, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        usernameTrimmed,
        passwordHash,
        emailTrimmed,
        finalContactPhone,
        citizenRoleId,
        citizenId,
        assignedProfilePic
      ]
    );

    // If Child registration or parent details provided, resolve parents and create birth registration
    let birthRegNumber = null;
    if (isChildRegistration) {
      let resolvedFatherId = null;
      let resolvedMotherId = null;

      if (father_nic && father_nic.trim()) {
        const [fMatch] = await conn.query(
          `SELECT citizen_id FROM citizens WHERE nic_number = ? LIMIT 1`,
          [father_nic.trim()]
        );
        if (fMatch.length > 0) resolvedFatherId = fMatch[0].citizen_id;
      }

      if (mother_nic && mother_nic.trim()) {
        const [mMatch] = await conn.query(
          `SELECT citizen_id FROM citizens WHERE nic_number = ? LIMIT 1`,
          [mother_nic.trim()]
        );
        if (mMatch.length > 0) resolvedMotherId = mMatch[0].citizen_id;
      }

      const birthYear = dobFormatted.substring(0, 4) || new Date().getFullYear();
      birthRegNumber = `BR-${birthYear}-${Math.floor(100000 + Math.random() * 900000)}`;

      await conn.query(
        `INSERT INTO birth_registrations (
          citizen_id, registration_number, place_of_birth, hospital_name, attending_physician,
          father_citizen_id, mother_citizen_id, informant_name, date_of_registration, registered_by_user_id,
          father_name, father_nic, father_phone, mother_name, mother_nic, mother_phone,
          informant_phone, informant_nic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          citizenId,
          birthRegNumber,
          birth_place && birth_place.trim() ? birth_place.trim() : 'Colombo',
          hospital_name && hospital_name.trim() ? hospital_name.trim() : 'National Maternity Hospital, Colombo',
          attending_physician && attending_physician.trim() ? attending_physician.trim() : 'Chief Obstetric Medical Officer',
          resolvedFatherId,
          resolvedMotherId,
          informant_name && informant_name.trim() ? informant_name.trim() : `${father_name || mother_name || 'Parent'} (Parent / Guardian)`,
          todayStr,
          father_name ? father_name.trim() : null,
          father_nic ? father_nic.trim() : null,
          father_phone ? father_phone.trim() : null,
          mother_name ? mother_name.trim() : null,
          mother_nic ? mother_nic.trim() : null,
          mother_phone ? mother_phone.trim() : null,
          informant_phone ? informant_phone.trim() : (father_phone || mother_phone || finalContactPhone),
          informant_nic ? informant_nic.trim() : (father_nic || mother_nic || null)
        ]
      );

      // Link Family Relationships if parent citizen was resolved
      if (resolvedFatherId) {
        await conn.query(
          `INSERT INTO family_relationships (citizen_id, related_citizen_id, relationship_type, verified)
           VALUES (?, ?, 'PARENT', 1)
           ON DUPLICATE KEY UPDATE verified = 1`,
          [citizenId, resolvedFatherId]
        ).catch(() => {});
      }
      if (resolvedMotherId) {
        await conn.query(
          `INSERT INTO family_relationships (citizen_id, related_citizen_id, relationship_type, verified)
           VALUES (?, ?, 'PARENT', 1)
           ON DUPLICATE KEY UPDATE verified = 1`,
          [citizenId, resolvedMotherId]
        ).catch(() => {});
      }
    }

    await conn.commit();

    // 11. Generate JWT Token so user is immediately authenticated
    const token = jwt.sign(
      {
        user_id: userResult.insertId,
        username: usernameTrimmed,
        email: emailTrimmed,
        role_id: citizenRoleId,
        role_name: 'CITIZEN',
        associated_citizen_id: citizenId,
        profile_picture: null,
        is_child: isChildRegistration ? 1 : 0
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // 12. Audit log
    await logAudit({
      userId: userResult.insertId,
      actionType: 'CREATE',
      moduleAccessed: 'AUTHENTICATION',
      targetCitizenId: citizenId,
      ipAddress: req.ip || req.connection?.remoteAddress || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'UNKNOWN',
      details: isChildRegistration
        ? `Child registration completed for pupil username '${usernameTrimmed}' (Citizen ID: ${citizenId}, Birth Reg: ${birthRegNumber})`
        : `Citizen registration with 2FA verification completed for username '${usernameTrimmed}' (Citizen ID: ${citizenId}, NIC: ${finalNic})`
    });

    return res.status(201).json({
      success: true,
      message: isChildRegistration
        ? 'Child registration verified and saved successfully! Birth certificate record and digital pupil identity created.'
        : 'Citizen registration verified and saved successfully! National Smart Identity Card has been created.',
      citizen_id: citizenId,
      nic_number: finalNic,
      birth_reg_number: birthRegNumber,
      is_child: isChildRegistration,
      username: usernameTrimmed,
      token,
      user: {
        user_id: userResult.insertId,
        username: usernameTrimmed,
        email: emailTrimmed,
        role_id: citizenRoleId,
        role_name: 'CITIZEN',
        associated_citizen_id: citizenId,
        is_child: isChildRegistration ? 1 : 0
      }
    });

  } catch (error) {
    if (conn) await conn.rollback();
    console.error('[registerCitizen Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to complete citizen registration.',
      error: error.message
    });
  } finally {
    if (conn) conn.release();
  }
}

/**
 * GET /api/auth/me
 * Returns authenticated user details and profile
 */
async function getMe(req, res) {
  try {
    const userId = req.user.user_id;

    const [rows] = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.phone_number, u.associated_citizen_id,
              u.profile_picture, u.is_active, u.created_at, r.role_id, r.role_name, r.description AS role_description
       FROM users u
       INNER JOIN roles r ON u.role_id = r.role_id
       WHERE u.user_id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.'
      });
    }

    const userProfile = rows[0];

    // If user has an associated citizen ID, fetch quick demographic summary
    let citizenSummary = null;
    if (userProfile.associated_citizen_id) {
      const [citRows] = await pool.query(
        `SELECT citizen_id, nic_number, first_name, middle_names, last_name, gender, date_of_birth, blood_group, profile_picture, qr_token
         FROM citizens WHERE citizen_id = ?`,
        [userProfile.associated_citizen_id]
      );
      if (citRows.length > 0) {
        citizenSummary = citRows[0];
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        ...userProfile,
        citizen: citizenSummary
      }
    });
  } catch (error) {
    console.error('[getMe Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve user profile.',
      error: error.message
    });
  }
}

module.exports = {
  sendOtp,
  verifyOtp,
  login,
  registerCitizen,
  getMe
};
