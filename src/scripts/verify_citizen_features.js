const { pool } = require('../config/db');

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function loginUser(username, email, password) {
  const baseUrl = `http://localhost:5000/api`;
  const loginRes = await api(`${baseUrl}/auth/login`, {
    method: 'POST',
    body: { username, email, password, client_mode: 'web' }
  });

  if (loginRes.status !== 200 || !loginRes.data.requires_2fa) {
    throw new Error(`Login failed for ${username}: ` + JSON.stringify(loginRes.data));
  }

  const identifier = loginRes.data.identifier;
  const tempToken = loginRes.data.temp_token;

  let otpCode = loginRes.data.dev_otp;
  if (!otpCode) {
    const [rows] = await pool.query(
      `SELECT otp_code FROM otp_verifications WHERE identifier = ? AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`,
      [identifier]
    );
    otpCode = rows[0]?.otp_code;
  }

  const verifyRes = await api(`${baseUrl}/auth/verify-otp`, {
    method: 'POST',
    body: {
      identifier,
      otp_code: otpCode,
      purpose: 'LOGIN',
      temp_token: tempToken
    }
  });

  if (verifyRes.status !== 200 || !verifyRes.data.token) {
    throw new Error(`OTP Verification failed for ${username}: ` + JSON.stringify(verifyRes.data));
  }

  return {
    token: verifyRes.data.token,
    user: verifyRes.data.user
  };
}

async function run() {
  const baseUrl = `http://localhost:5000/api`;

  try {
    // 0. Ensure user 'citizen' has associated_citizen_id
    await pool.query("UPDATE users SET associated_citizen_id = 'LK-20051102-0220' WHERE username = 'citizen'");

    // 1. Authenticate Citizen
    console.log('\n--- 1. Testing Citizen Login ---');
    const citizenAuth = await loginUser('citizen', 'citizen@ocodr.gov.lk', 'password123');
    const citToken = citizenAuth.token;
    const citHeaders = { Authorization: `Bearer ${citToken}` };
    const citCitizenId = citizenAuth.user.associated_citizen_id;
    console.log(`Citizen authenticated! Citizen ID: ${citCitizenId}, Role: ${citizenAuth.user.role_name}`);

    // 2. Authenticate Admin
    console.log('\n--- 2. Testing Admin Login ---');
    const adminAuth = await loginUser('admin', 'admin@ocodr.gov.lk', 'password123');
    const adminToken = adminAuth.token;
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    console.log(`Admin authenticated! Role: ${adminAuth.user.role_name}`);

    // 3. Citizen adds Passport
    console.log('\n--- 3. Citizen Adding Passport ---');
    const testPassportNum = 'N' + Math.floor(1000000 + Math.random() * 9000000);
    const passRes = await api(`${baseUrl}/passport/add`, {
      method: 'POST',
      headers: citHeaders,
      body: {
        citizen_id: citCitizenId,
        passport_number: testPassportNum,
        issue_date: '2024-01-15',
        expiry_date: '2034-01-14',
        issue_country: 'SRI LANKA',
        status: 'ACTIVE'
      }
    });
    console.log('Passport Add Result (Citizen):', passRes.status, passRes.data?.message);

    // 4. Citizen adds Licence
    console.log('\n--- 4. Citizen Adding Driving Licence ---');
    const testLicenceNum = 'B' + Math.floor(1000000 + Math.random() * 9000000);
    const licRes = await api(`${baseUrl}/licence/add`, {
      method: 'POST',
      headers: citHeaders,
      body: {
        citizen_id: citCitizenId,
        licence_number: testLicenceNum,
        vehicle_classes: 'B, B1, A',
        issue_date: '2023-05-10',
        expiry_date: '2031-05-09',
        demerit_points: 0,
        status: 'VALID'
      }
    });
    console.log('Licence Add Result (Citizen):', licRes.status, licRes.data?.message);

    // 5. Citizen adds Academic Qualification
    console.log('\n--- 5. Citizen Adding Academic Qualification ---');
    const eduRes = await api(`${baseUrl}/education/add`, {
      method: 'POST',
      headers: citHeaders,
      body: {
        citizen_id: citCitizenId,
        type: 'HIGHER',
        institution_name: 'University of Colombo',
        qualification_level: 'BACHELORS',
        qualification_title: 'B.Sc. in Computer Science',
        class_or_gpa: 'First Class Honours',
        graduation_year: 2022
      }
    });
    console.log('Education Add Result (Citizen):', eduRes.status, eduRes.data?.message);

    // 6. Citizen adds Civil Marriage Record
    console.log('\n--- 6. Citizen Adding Marriage Record ---');
    const marriageRes = await api(`${baseUrl}/vital/marriage/add`, {
      method: 'POST',
      headers: citHeaders,
      body: {
        spouse_one_id: citCitizenId,
        spouse_two_id: null,
        marriage_date: '2021-08-20',
        registration_place: 'Colombo Divisional Secretariat',
        status: 'ACTIVE'
      }
    });
    console.log('Marriage Add Result (Citizen):', marriageRes.status, marriageRes.data?.message);

    // 7. Admin tests: Admin should be forbidden (403) from adding any of these
    console.log('\n--- 7. Verifying Admin is Forbidden (not admin) ---');
    
    // Admin adding passport -> Expect 403
    const adminPassRes = await api(`${baseUrl}/passport/add`, {
      method: 'POST',
      headers: adminHeaders,
      body: {
        citizen_id: citCitizenId,
        passport_number: 'N9999999',
        issue_date: '2024-01-01',
        expiry_date: '2034-01-01'
      }
    });
    console.log('Admin add passport status:', adminPassRes.status, adminPassRes.data?.message);

    // Admin adding licence -> Expect 403
    const adminLicRes = await api(`${baseUrl}/licence/add`, {
      method: 'POST',
      headers: adminHeaders,
      body: {
        citizen_id: citCitizenId,
        licence_number: 'B9999999',
        vehicle_classes: 'B',
        issue_date: '2024-01-01',
        expiry_date: '2034-01-01'
      }
    });
    console.log('Admin add licence status:', adminLicRes.status, adminLicRes.data?.message);

    // Admin adding education -> Expect 403
    const adminEduRes = await api(`${baseUrl}/education/add`, {
      method: 'POST',
      headers: adminHeaders,
      body: {
        citizen_id: citCitizenId,
        institution_name: 'Test University',
        qualification_title: 'B.A.',
        graduation_year: 2020
      }
    });
    console.log('Admin add education status:', adminEduRes.status, adminEduRes.data?.message);

    // Admin adding marriage -> Expect 403
    const adminMarriageRes = await api(`${baseUrl}/vital/marriage/add`, {
      method: 'POST',
      headers: adminHeaders,
      body: {
        spouse_one_id: citCitizenId,
        marriage_date: '2020-01-01',
        registration_place: 'Colombo'
      }
    });
    console.log('Admin add marriage status:', adminMarriageRes.status, adminMarriageRes.data?.message);

    // Admin registering birth -> Expect 403
    const adminBirthRes = await api(`${baseUrl}/vital/register-birth`, {
      method: 'POST',
      headers: adminHeaders,
      body: {
        first_name: 'Childname',
        last_name: 'Citizen',
        gender: 'FEMALE',
        date_of_birth: '2024-01-01',
        place_of_birth: 'Colombo'
      }
    });
    console.log('Admin register birth status:', adminBirthRes.status, adminBirthRes.data?.message);

    console.log('\nSummary of Status Codes:');
    console.log({
      passRes: passRes.status,
      licRes: licRes.status,
      eduRes: eduRes.status,
      marriageRes: marriageRes.status,
      adminPassRes: adminPassRes.status,
      adminLicRes: adminLicRes.status,
      adminEduRes: adminEduRes.status,
      adminMarriageRes: adminMarriageRes.status,
      adminBirthRes: adminBirthRes.status
    });

    if (
      passRes.status === 201 &&
      licRes.status === 201 &&
      eduRes.status === 201 &&
      marriageRes.status === 201 &&
      adminPassRes.status === 403 &&
      adminLicRes.status === 403 &&
      adminEduRes.status === 403 &&
      adminMarriageRes.status === 403 &&
      adminBirthRes.status === 403
    ) {
      console.log('\n>>> ALL 9 PERMISSION & RBAC CHECKS PASSED WITH FLYING COLORS! <<<');
    } else {
      console.error('\n>>> SOME CHECKS DID NOT MATCH EXPECTED STATUS CODES! <<<');
    }
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();
