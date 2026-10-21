const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const { testConnection } = require('./config/db');
const { uploadDir } = require('./middleware/uploadMiddleware');

// Route Handlers
const authRoutes = require('./routes/authRoutes');
const citizenRoutes = require('./routes/citizenRoutes');
const moduleRoutes = require('./routes/moduleRoutes');
const documentRoutes = require('./routes/documentRoutes');
const auditRoutes = require('./routes/auditRoutes');
const verifyRoutes = require('./routes/verifyRoutes');
const translateRoutes = require('./routes/translateRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Utility Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Enable pre-flight and Private Network Access headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Asset Directories
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadDir));

// System Health Endpoint
app.get('/api/health', async (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    service: 'One Citizen One Digital Record (OCODR) National Core API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Mount Core API Routes
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes); // Convenience alias
app.use('/api/citizens', citizenRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/translate', translateRoutes);
app.use('/api/admin', adminRoutes);

// Modular Routes (Healthcare, Education, Vital Registrations)
app.use('/api', moduleRoutes);

// Fallback routing for frontend
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global 404 Route for Unrecognized APIs
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint '${req.originalUrl}' does not exist on this server.`
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

const { launchInBrowser } = require('./utils/browserLauncher');

// Start Server & Check DB Connection
const server = app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(` [OCODR] One Citizen One Digital Record System Online `);
  console.log(` Server running on: http://localhost:${PORT}`);
  console.log(` Environment:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`======================================================\n`);
  
  await testConnection();

  // Automatically launch website in Chrome, Avast, or Microsoft Edge
  launchInBrowser(`http://localhost:${PORT}`);
});

// Graceful error handling - avoid crashing if port is already active
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n======================================================`);
    console.log(` [OCODR] Server is already running on http://localhost:${PORT}`);
    console.log(` [OCODR] Access existing instance at: http://localhost:${PORT}`);
    console.log(`======================================================\n`);

    launchInBrowser(`http://localhost:${PORT}`);
  } else {
    console.error('[OCODR Server Error]', err);
  }
});

module.exports = app;

