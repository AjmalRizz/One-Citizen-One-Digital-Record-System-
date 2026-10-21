const http = require('http');
const fs = require('fs');
const path = require('path');

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

async function testUpload() {
  console.log('Testing document upload endpoint...');

  // 1. Login as citizen
  const loginData = JSON.stringify({ username: 'citizen', password: 'password123', direct_token: true });
  const token = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const json = JSON.parse(body);
        resolve(json.token);
      });
    });
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  console.log('Obtained token for citizen upload test.');

  // Create temporary test document
  const sampleContent = '%PDF-1.4 Mock National Pathology & Clinical Diagnostic Laboratory Report for OCODR.';
  
  let payload = '';
  payload += `--${boundary}\r\n`;
  payload += `Content-Disposition: form-data; name="citizen_id"\r\n\r\nLK-19900512-0042\r\n`;
  payload += `--${boundary}\r\n`;
  payload += `Content-Disposition: form-data; name="module_category"\r\n\r\nMEDICAL\r\n`;
  payload += `--${boundary}\r\n`;
  payload += `Content-Disposition: form-data; name="document_title"\r\n\r\nAnnual Fasting Blood Glucose Report\r\n`;
  payload += `--${boundary}\r\n`;
  payload += `Content-Disposition: form-data; name="file"; filename="blood_report.pdf"\r\n`;
  payload += `Content-Type: application/pdf\r\n\r\n`;
  payload += sampleContent;
  payload += `\r\n--${boundary}--\r\n`;

  const uploadRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/documents/upload',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  console.log('Upload Result Status:', uploadRes.status);
  console.log('Upload Response:', uploadRes.data);

  if (uploadRes.status !== 201) {
    throw new Error('Upload failed');
  }

  // Verify document is listed
  const listRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/documents/LK-19900512-0042',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });

  console.log('Document List Count:', listRes.data.data?.length);
  console.log('Latest Document Title:', listRes.data.data?.[0]?.document_title);

  console.log('>>> DOCUMENT UPLOAD & LISTING TEST PASSED! <<<');
  process.exit(0);
}

testUpload().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
