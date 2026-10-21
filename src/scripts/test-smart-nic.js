const http = require('http');

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('--- 1. Testing Official Multi-Line Sri Lankan Smart NIC QR Payload (Image 3) ---');
  const image3QrText = [
    '00',
    '200530702203',
    '2005-11-02',
    'M',
    '2025-01-27',
    '05CBD-220',
    'WASIM BARI AHMADH BILAAL',
    '186/C, PAHALA KONDADENIYA, KATUGASTOTA.',
    'KANDY',
    '20378454CBC6431CA51DA25E3A5CD78E#',
    '2035/01/26'
  ].join('\n');

  const qrVerifyRes = await postJson('/api/verify/qr', { token: image3QrText });
  console.log('QR Verify Response status:', qrVerifyRes.status);
  console.log('QR Verify Result Valid:', qrVerifyRes.data?.valid);
  console.log('QR Verify Citizen:', qrVerifyRes.data?.data?.full_name);
  console.log('QR Verify NIC:', qrVerifyRes.data?.data?.nic_number);
  console.log('QR Verify Address:', qrVerifyRes.data?.data?.permanent_address);
  console.log('QR Verify Birth Place:', qrVerifyRes.data?.data?.birth_place);
  console.log('QR Verify Serial:', qrVerifyRes.data?.data?.card_serial);

  console.log('\n--- 2. Testing Pupil Registration Flow with Permanent Residence and OTP ---');
  // Step A: Request OTP
  const pupilEmail = `pupil.test.${Date.now()}@school.lk`;
  const pupilPhone = '+94779876543';
  const otpRes = await postJson('/api/auth/send-otp', {
    identifier: pupilEmail,
    phone_number: pupilPhone,
    purpose: 'REGISTER'
  });
  console.log('Send OTP Status:', otpRes.status);
  console.log('OTP Dispatched, Dev OTP Code:', otpRes.data?.dev_otp);

  const devOtp = otpRes.data?.dev_otp;
  if (!devOtp) {
    console.error('Failed to get OTP code');
    return;
  }

  // Step B: Submit registration with OTP & Permanent Residence
  const regPayload = {
    first_name: 'Kavindu',
    last_name: 'Dissanayake',
    name_si: 'කවිඳු දිසානායක',
    name_ta: 'கவிந்து திஸாநாயக்க',
    date_of_birth: '2008-04-12',
    gender: 'MALE',
    blood_group: 'B+',
    permanent_address: 'No. 74/B, Peradeniya Road, Kandy, Sri Lanka',
    birth_place: 'Kandy',
    phone_number: pupilPhone,
    email: pupilEmail,
    username: `kavindu.${Date.now()}`,
    password: 'Password@2026',
    otp_code: devOtp
  };

  const registerRes = await postJson('/api/auth/register', regPayload);
  console.log('Registration Status:', registerRes.status);
  console.log('Registration Success:', registerRes.data?.success);
  console.log('Created Citizen ID:', registerRes.data?.citizen_id);
  console.log('Generated Smart NIC:', registerRes.data?.nic_number);

  const citizenId = registerRes.data?.citizen_id;
  const token = registerRes.data?.token;

  if (citizenId && token) {
    console.log('\n--- 3. Verifying Citizen Record in Database ---');
    const citRes = await getJson(`/api/citizens/${citizenId}`, token);
    console.log('Citizen Status:', citRes.status);
    const demo = citRes.data?.data?.demographics;
    console.log('Name:', demo?.full_name);
    console.log('Permanent Address:', demo?.permanent_address);
    console.log('Birth Place:', demo?.birth_place);
    console.log('Issue Date:', demo?.date_of_issue);
    console.log('Expiry Date:', demo?.date_of_expiry);
    console.log('Card Serial:', demo?.card_serial);

    console.log('\n--- 4. Verifying Smart NIC QR for New Pupil ---');
    const verifyNewCit = await getJson(`/api/verify/qr/${citizenId}`);
    console.log('Public Verification Valid:', verifyNewCit.data?.valid);
    console.log('Verified Name:', verifyNewCit.data?.data?.full_name);
    console.log('Verified Permanent Address:', verifyNewCit.data?.data?.permanent_address);
  }

  console.log('\nAll End-to-End Tests Finished Successfully!');
}

runTests().catch(console.error);
