const http = require('http');
const { pool } = require('../config/db');

async function request(options, bodyJson = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on('error', reject);
    if (bodyJson) {
      req.write(typeof bodyJson === 'string' ? bodyJson : JSON.stringify(bodyJson));
    }
    req.end();
  });
}

async function loginUser(username, email, password) {
  const loginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username, email, password });

  if (!loginRes.data.requires_2fa) {
    throw new Error(`Login initiation failed: ${JSON.stringify(loginRes.data)}`);
  }

  // Fetch real OTP from database
  const [rows] = await pool.query(
    `SELECT otp_code FROM otp_verifications WHERE identifier = ? AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  if (rows.length === 0) {
    throw new Error(`No OTP found in database for ${email}`);
  }

  const otpCode = rows[0].otp_code;

  const verifyRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/verify-otp',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    identifier: email,
    otp_code: otpCode,
    purpose: 'LOGIN'
  });

  if (verifyRes.status !== 200 || !verifyRes.data.token) {
    throw new Error(`OTP verification failed for ${username}: ${JSON.stringify(verifyRes.data)}`);
  }

  return verifyRes.data.token;
}

async function testDeleteFlow() {
  console.log('=== TESTING CITIZEN DELETION LOCKOUT AND ADMIN DELETION FLOW ===\n');

  try {
    const citizenId = 'LK-19900512-0042';

    // 1. Authenticate Citizen & Admin
    console.log('[Step 1] Authenticating Citizen and Admin with 3 credentials...');
    const citizenToken = await loginUser('citizen', 'citizen@ocodr.gov.lk', 'password123');
    const adminToken = await loginUser('admin', 'admin@ocodr.gov.lk', 'password123');
    console.log('Citizen and Admin authenticated successfully.');

    // 2. Prepare test data (set photo and fields)
    await pool.query(
      `UPDATE citizens SET profile_picture = '/uploads/test_avatar.png', contact_phone = '+94771234567', current_address = 'Colombo 03' WHERE citizen_id = ?`,
      [citizenId]
    );

    // 3. Citizen attempts to delete profile photo -> Expected 403 Forbidden
    console.log('\n[Step 2] Testing: Citizen attempts to delete profile photo...');
    const citDelPhoto = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/citizens/${citizenId}/photo`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });
    console.log(`Status: ${citDelPhoto.status}, Message: ${citDelPhoto.data.message}`);
    if (citDelPhoto.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden for citizen photo deletion, got ${citDelPhoto.status}`);
    }

    // 4. Citizen attempts to clear field -> Expected 403 Forbidden
    console.log('\n[Step 3] Testing: Citizen attempts to clear contact_phone...');
    const citClearField = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/citizens/${citizenId}/field/contact_phone`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });
    console.log(`Status: ${citClearField.status}, Message: ${citClearField.data.message}`);
    if (citClearField.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden for citizen field clearing, got ${citClearField.status}`);
    }

    // 5. Citizen attempts to delete document -> Expected 403 Forbidden
    console.log('\n[Step 4] Testing: Citizen attempts to delete document...');
    const [docInsert] = await pool.query(
      `INSERT INTO document_uploads (citizen_id, module_category, document_title, file_path, file_mime_type, uploaded_by_user_id)
       VALUES (?, 'MEDICAL', 'Test Medical Report', 'uploads/test_doc.pdf', 'application/pdf', 1)`,
      [citizenId]
    );
    const testDocId = docInsert.insertId;

    const citDelDoc = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/documents/${testDocId}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });
    console.log(`Status: ${citDelDoc.status}, Message: ${citDelDoc.data.message}`);
    if (citDelDoc.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden for citizen document deletion, got ${citDelDoc.status}`);
    }

    // 6. Citizen attempts to deactivate/delete citizen record -> Expected 403 Forbidden
    console.log('\n[Step 5] Testing: Citizen attempts to deactivate/delete record...');
    const citDelRecord = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/citizens/${citizenId}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    });
    console.log(`Status: ${citDelRecord.status}, Message: ${citDelRecord.data.message}`);
    if (citDelRecord.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden for citizen record deletion, got ${citDelRecord.status}`);
    }

    // 7. Admin deletion operations -> Expected 200 OK
    console.log('\n[Step 6] Testing: Admin deletes profile photo...');
    const adminDelPhoto = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/citizens/${citizenId}/photo`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log(`Status: ${adminDelPhoto.status}, Message: ${adminDelPhoto.data.message}`);
    if (adminDelPhoto.status !== 200) {
      throw new Error(`Admin photo delete failed: ${adminDelPhoto.data.message}`);
    }

    console.log('\n[Step 7] Testing: Admin clears contact_phone field...');
    const adminClearField = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/citizens/${citizenId}/field/contact_phone`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log(`Status: ${adminClearField.status}, Message: ${adminClearField.data.message}`);
    if (adminClearField.status !== 200) {
      throw new Error(`Admin clear field failed: ${adminClearField.data.message}`);
    }

    console.log('\n[Step 8] Testing: Admin deletes document...');
    const adminDelDoc = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/documents/${testDocId}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log(`Status: ${adminDelDoc.status}, Message: ${adminDelDoc.data.message}`);
    if (adminDelDoc.status !== 200) {
      throw new Error(`Admin document delete failed: ${adminDelDoc.data.message}`);
    }

    // 8. Restore citizen record
    await pool.query(
      `UPDATE citizens SET contact_phone = '+94771234567', current_address = 'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka', permanent_address = 'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka' WHERE citizen_id = ?`,
      [citizenId]
    );

    console.log('\n>>> ALL CITIZEN DELETION RESTRICTION TESTS PASSED! <<<');
    process.exit(0);
  } catch (err) {
    console.error('\n[Test Failure]', err);
    process.exit(1);
  }
}

testDeleteFlow();
