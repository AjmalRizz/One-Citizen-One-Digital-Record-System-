/**
 * Integration Test: Edit Citizen Information
 */
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

async function loginWithOtp(username, email, password) {
  const loginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username, email, password });

  if (!loginRes.data.success) throw new Error(`Login failed for ${username}: ` + loginRes.data.message);

  const [otpRows] = await pool.query(
    `SELECT otp_code FROM otp_verifications WHERE identifier = ? AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  if (otpRows.length === 0) throw new Error(`No OTP in database for ${email}`);

  const verifyRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/verify-otp',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    identifier: email,
    otp_code: otpRows[0].otp_code,
    purpose: 'LOGIN'
  });

  return verifyRes.data.token;
}

async function runTest() {
  console.log('=== TESTING ADMIN-ONLY EDIT CITIZEN INFORMATION FLOW ===\n');

  try {
    // ----------------------------------------------------
    // 1. Citizen Login & 2FA
    // ----------------------------------------------------
    const citizenToken = await loginWithOtp('citizen', 'citizen@ocodr.gov.lk', 'password123');
    console.log('[Step 1] Authenticated as Citizen LK-19900512-0042');

    // ----------------------------------------------------
    // 2. Test: Citizen attempts to edit -> Must be REJECTED (403)
    // ----------------------------------------------------
    console.log('[Step 2] Testing: Citizen attempts PUT /api/citizens/LK-19900512-0042...');
    const citizenEditRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/citizens/LK-19900512-0042',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${citizenToken}`,
        'Content-Type': 'application/json'
      }
    }, {
      contact_phone: '+94779998877'
    });

    console.log(`Citizen Edit Status: ${citizenEditRes.status} (Expected 403 Forbidden)`);
    if (citizenEditRes.status !== 403) {
      throw new Error(`Security violation: Citizen was able to edit information (status ${citizenEditRes.status})`);
    }

    // ----------------------------------------------------
    // 3. Admin Login & 2FA
    // ----------------------------------------------------
    console.log('\n[Step 3] Authenticating as System Administrator...');
    const adminToken = await loginWithOtp('admin', 'admin@ocodr.gov.lk', 'password123');
    console.log('Authenticated as ADMIN');

    // ----------------------------------------------------
    // 4. Admin performs citizen edit -> Must SUCCEED (200)
    // ----------------------------------------------------
    console.log('\n[Step 4] Admin updating citizen information via PUT /api/citizens/LK-19900512-0042...');
    const updatedPhone = '+94775554433';
    const updatedAddress = 'No. 88, Bauddhaloka Mawatha, Colombo 07, Sri Lanka';

    const adminEditRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/citizens/LK-19900512-0042',
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    }, {
      contact_phone: updatedPhone,
      current_address: updatedAddress,
      permanent_address: 'No. 42, Galle Road, Kollupitiya, Colombo 03, Sri Lanka'
    });

    console.log(`Admin Edit Status: ${adminEditRes.status}`);
    console.log('Response Message:', adminEditRes.data.message);
    console.log('Updated Phone:', adminEditRes.data.data?.contact_phone);
    console.log('Updated Address:', adminEditRes.data.data?.current_address);

    if (adminEditRes.status !== 200 || adminEditRes.data.data?.contact_phone !== updatedPhone) {
      throw new Error('Admin edit failed: ' + JSON.stringify(adminEditRes.data));
    }

    // ----------------------------------------------------
    // 5. Verify database persistence
    // ----------------------------------------------------
    console.log('\n[Step 5] Fetching record as Admin to confirm persistence...');
    const citRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/citizens/LK-19900512-0042',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    const demo = citRes.data.data?.demographics;
    console.log('Persisted Contact Phone:', demo?.contact_phone);
    console.log('Persisted Current Address:', demo?.current_address);

    if (demo?.contact_phone !== updatedPhone || demo?.current_address !== updatedAddress) {
      throw new Error('Database persistence verification failed!');
    }

    console.log('\n>>> ALL ADMIN-ONLY EDIT CITIZEN TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } catch (err) {
    console.error('\n[Test Failed]', err);
    process.exit(1);
  }
}

runTest();
