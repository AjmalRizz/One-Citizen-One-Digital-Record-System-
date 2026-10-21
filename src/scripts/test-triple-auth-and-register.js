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

async function runTests() {
  console.log('=== TESTING TRIPLE-CREDENTIAL AUTH, DETECTION, OTP & CITIZEN REGISTRATION ===\n');

  try {
    // ----------------------------------------------------
    // Test 1: Missing credentials in login -> 400 Bad Request
    // ----------------------------------------------------
    console.log('[Test 1] Login with missing email parameter (only username & password)...');
    const missingEmailRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'citizen', password: 'password123' });

    console.log(`Status: ${missingEmailRes.status}, Message: ${missingEmailRes.data.message}`);
    if (missingEmailRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for missing email, got ${missingEmailRes.status}`);
    }

    // ----------------------------------------------------
    // Test 2: Non-existent username -> 401 Invalid username
    // ----------------------------------------------------
    console.log('\n[Test 2] Login with invalid/non-existent username...');
    const invalidUserRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'ghost.user.999', email: 'citizen@ocodr.gov.lk', password: 'password123' });

    console.log(`Status: ${invalidUserRes.status}, Message: ${invalidUserRes.data.message}`);
    if (invalidUserRes.status !== 401 || !invalidUserRes.data.message.includes('Invalid username')) {
      throw new Error(`Expected HTTP 401 Invalid username, got ${invalidUserRes.status}: ${invalidUserRes.data.message}`);
    }

    // ----------------------------------------------------
    // Test 3: Correct username + Wrong password -> 401 Incorrect password
    // ----------------------------------------------------
    console.log('\n[Test 3] Login with correct username & email but WRONG password...');
    const wrongPassRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'citizen', email: 'citizen@ocodr.gov.lk', password: 'wrongPassword999!' });

    console.log(`Status: ${wrongPassRes.status}, Message: ${wrongPassRes.data.message}`);
    if (wrongPassRes.status !== 401 || !wrongPassRes.data.message.toLowerCase().includes('password')) {
      throw new Error(`Expected HTTP 401 Incorrect password, got ${wrongPassRes.status}: ${wrongPassRes.data.message}`);
    }

    // ----------------------------------------------------
    // Test 4: Correct username & password + WRONG email -> 401 Incorrect email
    // ----------------------------------------------------
    console.log('\n[Test 4] Login with correct username & password but WRONG email...');
    const wrongEmailRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'citizen', email: 'imposter@randomdomain.com', password: 'password123' });

    console.log(`Status: ${wrongEmailRes.status}, Message: ${wrongEmailRes.data.message}`);
    if (wrongEmailRes.status !== 401 || !wrongEmailRes.data.message.toLowerCase().includes('email')) {
      throw new Error(`Expected HTTP 401 Incorrect email, got ${wrongEmailRes.status}: ${wrongEmailRes.data.message}`);
    }

    // ----------------------------------------------------
    // Test 5: Correct triple credentials -> 200 OK, 2FA challenge, NO dev_otp
    // ----------------------------------------------------
    console.log('\n[Test 5] Login with CORRECT Username, Email, and Password...');
    const successLoginRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'citizen', email: 'citizen@ocodr.gov.lk', password: 'password123' });

    console.log(`Status: ${successLoginRes.status}, Requires 2FA: ${successLoginRes.data.requires_2fa}`);
    console.log(`dev_otp returned: ${successLoginRes.data.dev_otp}`);

    if (successLoginRes.status !== 200 || !successLoginRes.data.requires_2fa) {
      throw new Error(`Expected HTTP 200 with requires_2fa=true, got ${successLoginRes.status}`);
    }

    if (successLoginRes.data.dev_otp !== undefined) {
      throw new Error(`SECURITY LEAK: dev_otp must NOT be returned in API response! Real email only.`);
    }

    // Retrieve the real dispatched OTP from the database
    const [otpDb] = await pool.query(
      `SELECT otp_code FROM otp_verifications WHERE identifier = 'citizen@ocodr.gov.lk' AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`
    );
    if (otpDb.length === 0) throw new Error('No OTP was inserted into the database for citizen');
    const realOtp = otpDb[0].otp_code;
    console.log(`Real OTP retrieved securely from DB: ${realOtp}`);

    // Verify OTP
    const verifyRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      identifier: 'citizen@ocodr.gov.lk',
      otp_code: realOtp,
      purpose: 'LOGIN'
    });

    console.log(`Verify Status: ${verifyRes.status}, JWT Token Issued: ${Boolean(verifyRes.data.token)}`);
    if (verifyRes.status !== 200 || !verifyRes.data.token) {
      throw new Error('OTP verification failed with real OTP');
    }

    // ----------------------------------------------------
    // Test 6: Citizen Self-Registration with Hallucinated / Dummy Name -> 400 Bad Request
    // ----------------------------------------------------
    console.log('\n[Test 6] Citizen Registration with dummy name ("Test Dummy")...');
    const dummyRegRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      first_name: 'Test',
      last_name: 'Dummy',
      date_of_birth: '1995-07-20',
      gender: 'MALE',
      email: 'testdummy@testmail.com',
      username: 'testdummyuser',
      password: 'password123'
    });

    console.log(`Status: ${dummyRegRes.status}, Message: ${dummyRegRes.data.message}`);
    if (dummyRegRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for dummy name registration, got ${dummyRegRes.status}`);
    }

    // ----------------------------------------------------
    // Test 7: Citizen Self-Registration with Valid Real Name -> 201 Created
    // ----------------------------------------------------
    const uniqueTimestamp = Date.now().toString().slice(-4);
    const regUsername = `kasun.${uniqueTimestamp}`;
    const regEmail = `kasun.${uniqueTimestamp}@gmail.com`;

    console.log(`\n[Test 7] Citizen Registration with real Sri Lankan human name (Kasun Wickramasinghe, username: ${regUsername})...`);
    const validRegRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      first_name: 'Kasun',
      middle_names: 'Janaka',
      last_name: 'Wickramasinghe',
      date_of_birth: '1994-08-15',
      gender: 'MALE',
      blood_group: 'B+',
      nic_number: `1994${uniqueTimestamp}1234`,
      phone_number: '+94779876543',
      email: regEmail,
      username: regUsername,
      password: 'password123'
    });

    console.log(`Status: ${validRegRes.status}, Message: ${validRegRes.data.message}`);
    console.log(`Generated Citizen ID: ${validRegRes.data.citizen_id}`);

    if (validRegRes.status !== 201 || !validRegRes.data.citizen_id) {
      throw new Error(`Expected HTTP 201 citizen registration, got ${validRegRes.status}: ${JSON.stringify(validRegRes.data)}`);
    }

    // Confirm record in DB
    const [dbCit] = await pool.query(`SELECT citizen_id, first_name, last_name, qr_token FROM citizens WHERE citizen_id = ?`, [validRegRes.data.citizen_id]);
    if (dbCit.length === 0) throw new Error('Registered citizen not found in database');
    console.log(`Confirmed DB Record: ${dbCit[0].first_name} ${dbCit[0].last_name} (${dbCit[0].citizen_id})`);

    // ----------------------------------------------------
    // Test 8: Login with newly registered citizen using Triple Credentials
    // ----------------------------------------------------
    console.log('\n[Test 8] Login as newly registered citizen using Username, Email, and Password...');
    const newCitLogin = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      username: regUsername,
      email: regEmail,
      password: 'password123'
    });

    console.log(`Status: ${newCitLogin.status}, Requires 2FA: ${newCitLogin.data.requires_2fa}`);
    if (newCitLogin.status !== 200 || !newCitLogin.data.requires_2fa) {
      throw new Error(`New citizen login failed: ${JSON.stringify(newCitLogin.data)}`);
    }

    // Clean up test citizen record
    await pool.query('DELETE FROM audit_logs WHERE target_citizen_id = ?', [validRegRes.data.citizen_id]);
    await pool.query('DELETE FROM users WHERE username = ?', [regUsername]);
    await pool.query('DELETE FROM citizens WHERE citizen_id = ?', [validRegRes.data.citizen_id]);

    console.log('\n>>> ALL TRIPLE-CREDENTIAL AUTH, DETECTION, OTP & REGISTRATION TESTS PASSED! <<<');
    process.exit(0);
  } catch (err) {
    console.error('\n[Test Failure]', err);
    process.exit(1);
  }
}

runTests();
