const nodemailer = require('nodemailer');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

let transporter = null;

// Initialize transporter
async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const isGmail = (process.env.SMTP_HOST || '').toLowerCase().includes('gmail') ||
                    (process.env.SMTP_USER || '').toLowerCase().includes('@gmail.com');

    if (isGmail) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
  } else {
    // Immediate high-performance console mock for local development
    transporter = {
      sendMail: async (mailOptions) => {
        console.log(`[OCODR Dispatch] E-mail dispatched to: ${mailOptions.to} (${mailOptions.subject})`);
        return { messageId: 'dev-mock-' + Date.now() };
      }
    };
  }

  return transporter;
}

/**
 * Generate a 6-digit cryptographic secure OTP
 */
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Send OTP Email to the user identifier
 */
async function sendOtpEmail(toEmail, otpCode, purpose = 'LOGIN') {
  console.log(`\n======================================================`);
  console.log(`[OCODR SECURITY] >>> OTP CODE GENERATED <<<`);
  console.log(`Recipient: ${toEmail}`);
  console.log(`Purpose:   ${purpose}`);
  console.log(`OTP Code:  ${otpCode}`);
  console.log(`Expires:   ${process.env.OTP_EXPIRY_MINUTES || 5} minutes`);
  console.log(`======================================================\n`);

  try {
    const activeTransporter = await getTransporter();
    const info = await activeTransporter.sendMail({
      from: process.env.EMAIL_FROM || '"OCODR Digital Identity" <noreply@ocodr.gov.lk>',
      to: toEmail,
      subject: `[OCODR] Verification Code for ${purpose}: ${otpCode}`,
      text: `Your One Citizen One Digital Record (OCODR) verification code is: ${otpCode}. It expires in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes. Do NOT share this code with anyone.`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 540px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">Democratic Socialist Republic of Sri Lanka</h1>
            <p style="margin: 6px 0 0 0; color: #38bdf8; font-size: 14px; font-weight: 600;">One Citizen One Digital Record (OCODR)</p>
          </div>
          <div style="padding: 32px 24px; text-align: center;">
            <p style="font-size: 15px; color: #475569; margin-top: 0;">Use the following One-Time Password (OTP) to authenticate your request:</p>
            <div style="margin: 24px 0; display: inline-block; padding: 14px 28px; background: #f8fafc; border: 2px dashed #0284c7; border-radius: 8px;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a;">${otpCode}</span>
            </div>
            <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
              This code is valid for <strong>${process.env.OTP_EXPIRY_MINUTES || 5} minutes</strong>. If you did not initiate this request, contact cybersecurity authorities immediately.
            </p>
          </div>
          <div style="background-color: #f1f5f9; padding: 14px; text-align: center; font-size: 12px; color: #94a3b8;">
            National Digital Identity Management Authority &copy; 2026. All rights reserved.
          </div>
        </div>
      `
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[Mailer Error] Failed to dispatch OTP email:', error.message);
    // Even if remote transport fails, OTP is logged to console in development
    return { success: false, error: error.message };
  }
}

module.exports = {
  generateOtp,
  sendOtpEmail
};
