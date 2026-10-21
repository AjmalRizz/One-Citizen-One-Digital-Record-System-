/**
 * Test Suite: Profile Picture Upload & Verification
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');

async function request(options, bodyBuffer = null) {
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
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

async function runTest() {
  console.log('=== TESTING PROFILE PICTURE UPLOAD FLOW ===\n');

  try {
    // 1. Citizen Login with Username, Email, and Password
    const loginRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ username: 'citizen', email: 'citizen@ocodr.gov.lk', password: 'password123' }));

    if (!loginRes.data.success) throw new Error('Citizen login failed: ' + loginRes.data.message);

    // Retrieve real OTP from DB
    const [otpRows] = await pool.query(
      `SELECT otp_code FROM otp_verifications WHERE identifier = 'citizen@ocodr.gov.lk' AND purpose = 'LOGIN' AND is_used = FALSE ORDER BY created_at DESC LIMIT 1`
    );
    if (otpRows.length === 0) throw new Error('No OTP record found in database for citizen');

    // 2. 2FA OTP verification
    const verifyRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      identifier: 'citizen@ocodr.gov.lk',
      otp_code: otpRows[0].otp_code,
      purpose: 'LOGIN'
    }));

    const token = verifyRes.data.token;
    console.log('[Step 1] Authenticated as Citizen LK-19900512-0042');

    // 3. Prepare multipart/form-data with a 1x1 valid PNG image
    // Minimal valid 1x1 PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const imageBuffer = Buffer.from(pngBase64, 'base64');
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

    let multipartPayload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="profile_avatar.png"\r\nContent-Type: image/png\r\n\r\n`),
      imageBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    // 4. Upload photo to citizen record
    console.log('[Step 2] Uploading profile picture to /api/citizens/LK-19900512-0042/photo...');
    const uploadRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/citizens/LK-19900512-0042/photo',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartPayload.length
      }
    }, multipartPayload);

    console.log(`Upload Status: ${uploadRes.status}`);
    console.log(`Upload Response:`, uploadRes.data);
    if (uploadRes.status !== 200 || !uploadRes.data.photo_url) {
      throw new Error('Upload failed: ' + JSON.stringify(uploadRes.data));
    }

    const uploadedPhotoUrl = uploadRes.data.photo_url;

    // 5. Fetch Citizen record and verify profile_picture field
    console.log('\n[Step 3] Verifying citizen profile_picture is updated in database...');
    const citRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/citizens/LK-19900512-0042',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    console.log('Fetched Profile Picture:', citRes.data.data?.demographics?.profile_picture);
    if (citRes.data.data?.demographics?.profile_picture !== uploadedPhotoUrl) {
      throw new Error('Database profile_picture does not match uploaded URL!');
    }

    // 6. Verify image is served statically via /uploads/...
    console.log('\n[Step 4] Verifying static image file retrieval...');
    const fileRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: uploadedPhotoUrl,
      method: 'GET'
    });
    console.log(`Static Asset Status: ${fileRes.status}`);
    if (fileRes.status !== 200) {
      throw new Error('Could not fetch uploaded photo asset at ' + uploadedPhotoUrl);
    }

    // 7. Test Security: Attempt to update another citizen's photo (should be blocked)
    console.log('\n[Step 5] Testing RBAC Security: Unauthorized citizen photo update...');
    const badUploadRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/citizens/LK-19880214-9912/photo',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartPayload.length
      }
    }, multipartPayload);
    console.log(`Unauthorized upload status: ${badUploadRes.status} (Expected 403)`);
    if (badUploadRes.status !== 403) {
      throw new Error('Security check failed: citizen was allowed to upload photo for another citizen!');
    }

    console.log('\n>>> ALL PROFILE PICTURE TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } catch (err) {
    console.error('\n[Test Failed]', err);
    process.exit(1);
  }
}

runTest();
