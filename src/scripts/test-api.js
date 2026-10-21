const http = require('http');
const { pool } = require('../config/db');

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function loginWithTriple(username, email, password) {
  const loginRes = await request('POST', '/api/auth/login', { username, email, password });
  if (loginRes.status !== 200 || !loginRes.data.requires_2fa) {
    throw new Error(`Login failed for ${username}: ${JSON.stringify(loginRes.data)}`);
  }

  const [rows] = await pool.query(
    `SELECT otp_code FROM otp_verifications WHERE identifier = ? AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
  if (rows.length === 0) throw new Error(`No OTP found in DB for ${email}`);

  const verifyRes = await request('POST', '/api/auth/verify-otp', {
    identifier: email,
    otp_code: rows[0].otp_code,
    purpose: 'LOGIN'
  });

  if (verifyRes.status !== 200 || !verifyRes.data.token) {
    throw new Error(`Verify OTP failed for ${username}: ${JSON.stringify(verifyRes.data)}`);
  }

  return verifyRes.data.token;
}

async function runTests() {
  console.log('=== STARTING OCODR API AUTOMATED INTEGRATION TESTS ===\n');

  try {
    // 1. Healthcheck
    console.log('[Test 1] Healthcheck endpoint');
    const health = await request('GET', '/api/health');
    console.log(`Status: ${health.status}, Response:`, health.data.status);
    if (health.status !== 200) throw new Error('Health check failed');

    // 2. Login Flow (Citizen): Step 1 - Send 2FA Challenge with triple credentials
    console.log('\n[Test 2] Citizen Login (Initiate 2FA with triple credentials)');
    const loginRes = await request('POST', '/api/auth/login', {
      username: 'citizen',
      email: 'citizen@ocodr.gov.lk',
      password: 'password123'
    });
    console.log(`Status: ${loginRes.status}, Requires 2FA:`, loginRes.data.requires_2fa);
    if (loginRes.status !== 200 || !loginRes.data.requires_2fa) {
      throw new Error('Citizen login 2FA initiation failed');
    }

    const [otpRows] = await pool.query(
      `SELECT otp_code FROM otp_verifications WHERE identifier = 'citizen@ocodr.gov.lk' AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`
    );
    const otpCode = otpRows[0].otp_code;
    console.log(`Real OTP retrieved securely from DB for citizen@ocodr.gov.lk: ${otpCode}`);

    // 3. Step 2 - Verify OTP and obtain JWT
    console.log('\n[Test 3] Verify OTP and acquire JWT');
    const verifyRes = await request('POST', '/api/auth/verify-otp', {
      identifier: 'citizen@ocodr.gov.lk',
      otp_code: otpCode,
      purpose: 'LOGIN'
    });
    console.log(`Status: ${verifyRes.status}, Received Token:`, Boolean(verifyRes.data.token));
    if (verifyRes.status !== 200 || !verifyRes.data.token) {
      throw new Error('OTP verification failed');
    }
    const citizenToken = verifyRes.data.token;

    // 4. Test Citizen RBAC: Access own record (LK-19900512-0042)
    console.log('\n[Test 4] Citizen fetches own record (LK-19900512-0042)');
    const citizenRecord = await request('GET', '/api/citizens/LK-19900512-0042', null, citizenToken);
    console.log(`Status: ${citizenRecord.status}, Has Medical:`, Boolean(citizenRecord.data.data?.medical_records), 'Has Passports:', Boolean(citizenRecord.data.data?.passports));
    if (citizenRecord.status !== 200) throw new Error('Citizen fetch failed');

    // 5. Test Citizen RBAC: Attempting to access another citizen's record should be 403
    console.log('\n[Test 5] Citizen attempts to access unauthorized citizen (LK-19880214-9912)');
    const forbiddenCheck = await request('GET', '/api/citizens/LK-19880214-9912', null, citizenToken);
    console.log(`Status: ${forbiddenCheck.status} (Expected 403 Forbidden)`);
    if (forbiddenCheck.status !== 403) throw new Error('Citizen RBAC violation check failed');

    // 6. Test Doctor / Hospital Login & Strict RBAC Partitioning
    console.log('\n[Test 6] Hospital (Doctor) Login & Data Partitioning Check');
    const doctorToken = await loginWithTriple('doctor.perera', 'doctor@health.gov.lk', 'password123');

    const docPatientView = await request('GET', '/api/citizens/LK-19900512-0042', null, doctorToken);
    console.log(`Doctor Record Fetch Status: ${docPatientView.status}`);
    console.log('Doctor sees Medical Records:', Boolean(docPatientView.data.data?.medical_records));
    console.log('Doctor sees Vaccines:', Boolean(docPatientView.data.data?.vaccination_records));
    console.log('Doctor sees Passports (Should be undefined):', docPatientView.data.data?.passports);
    console.log('Doctor sees Education (Should be undefined):', docPatientView.data.data?.school_education);
    if (docPatientView.data.data?.passports !== undefined || docPatientView.data.data?.school_education !== undefined) {
      throw new Error('Healthcare RBAC Data Leakage detected!');
    }

    // 7. Test Police Login & Strict RBAC Partitioning
    console.log('\n[Test 7] Police Login & Data Partitioning Check');
    const policeToken = await loginWithTriple('officer.fernando', 'police@police.gov.lk', 'password123');

    const polCitizenView = await request('GET', '/api/citizens/LK-19900512-0042', null, policeToken);
    console.log(`Police Record Fetch Status: ${polCitizenView.status}`);
    console.log('Police sees Passports:', Boolean(polCitizenView.data.data?.passports));
    console.log('Police sees Driving Licences:', Boolean(polCitizenView.data.data?.driving_licences));
    console.log('Police sees Medical (Should be undefined):', polCitizenView.data.data?.medical_records);
    if (polCitizenView.data.data?.medical_records !== undefined) {
      throw new Error('Police RBAC Data Leakage detected!');
    }

    // 8. Test Registrar Register New Birth
    console.log('\n[Test 8] Registrar Registers New Birth (Atomic ID & QR Token)');
    const registrarToken = await loginWithTriple('registrar.vital', 'vital@rgd.gov.lk', 'password123');

    // 8a. Test Anti-Hallucination Guardrail: Attempt to register with dummy / fake name
    console.log('\n[Test 8a] Anti-Hallucination Validation: Rejecting synthetic test name');
    const rejectedBirthRes = await request('POST', '/api/vital/register-birth', {
      first_name: 'test_dummy',
      middle_names: 'fake123',
      last_name: 'hallucination',
      gender: 'FEMALE',
      date_of_birth: '2026-03-15',
      place_of_birth: 'Colombo General Hospital'
    }, registrarToken);

    console.log(`Anti-Hallucination Guardrail Status: ${rejectedBirthRes.status} (Expected 400)`);
    if (rejectedBirthRes.status !== 400) {
      throw new Error('Anti-hallucination guardrail failed: Server allowed dummy test name!');
    }
    console.log('Guardrail properly blocked synthetic name:', rejectedBirthRes.data.message);

    // 8b. Test Valid Civil Birth Registration
    console.log('\n[Test 8b] Registrar: Valid Civil Birth Registration');
    const newBirthRes = await request('POST', '/api/vital/register-birth', {
      first_name: 'Minoli',
      middle_names: 'Chamari',
      last_name: 'Jayawardena',
      gender: 'FEMALE',
      date_of_birth: '2026-03-15',
      place_of_birth: 'Castle Street Hospital, Colombo',
      hospital_name: 'Castle Street Hospital',
      mother_citizen_id: 'LK-19900512-0042',
      informant_name: 'Kasun Jayawardena (Father)'
    }, registrarToken);

    console.log(`Birth Registration Status: ${newBirthRes.status}`);
    console.log('Response Message:', newBirthRes.data.message);
    console.log('Generated Citizen ID:', newBirthRes.data.data?.citizen_id);
    console.log('Generated QR Token:', newBirthRes.data.data?.qr_token);
    if (newBirthRes.status !== 201 || !newBirthRes.data.data?.citizen_id) {
      throw new Error('Birth registration failed');
    }

    // 9. Test Public QR Verification for generated token
    console.log('\n[Test 9] Safe Public QR Code Verification');
    const qrVerifyRes = await request('GET', `/api/verify/qr/${newBirthRes.data.data.qr_token}`);
    console.log(`QR Verify Status: ${qrVerifyRes.status}, Valid: ${qrVerifyRes.data.valid}, Status: ${qrVerifyRes.data.status}`);
    console.log('Verified Citizen Name:', qrVerifyRes.data.data?.full_name);
    console.log('Masked NIC:', qrVerifyRes.data.data?.masked_nic);
    if (qrVerifyRes.status !== 200 || !qrVerifyRes.data.valid) {
      throw new Error('QR Verification failed');
    }

    // 10. Test Admin Audit Logs
    console.log('\n[Test 10] Admin Audit Logs View');
    const adminToken = await loginWithTriple('admin', 'admin@ocodr.gov.lk', 'password123');

    const auditLogsRes = await request('GET', '/api/audit/logs?limit=5', null, adminToken);
    console.log(`Audit Logs Status: ${auditLogsRes.status}, Total Logged Events:`, auditLogsRes.data.pagination?.total);
    console.log('Recent Audit Actions:', auditLogsRes.data.data?.map(l => `${l.action_type} on ${l.module_accessed} by ${l.username || 'user_' + l.user_id}`));
    if (auditLogsRes.status !== 200 || auditLogsRes.data.data?.length === 0) {
      throw new Error('Audit logs query failed');
    }

    console.log('\n>>> ALL 10 INTEGRATION TESTS PASSED SUCCESSFULLY! <<<\n');
    process.exit(0);
  } catch (err) {
    console.error('\n[Test Suite Failed]', err);
    process.exit(1);
  }
}

runTests();
