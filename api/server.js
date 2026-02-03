const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// === Cloudinary Configuration ===
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer + Cloudinary Storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'vet-medical-records',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf'],
    resource_type: 'auto',
    transformation: [{ width: 1000, height: 1000, crop: 'limit' }],
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'), false);
    }
  }
});

// === Middleware ===
app.use(cors({
  origin: 'http://localhost:5173', // Update in production
  credentials: true
}));
app.use(express.json({ limit: '20mb' })); // Increased for file uploads
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// === MongoDB Connection ===
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// === API Routes ===
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/owners', require('../routes/petOwnerRoutes'));
app.use('/api/pets', require('../routes/petProfileRoutes'));
app.use('/api/clinics', require('../routes/clinicRoutes'));
app.use('/api/vets', require('../routes/veterinarianRoutes'));
app.use('/api/appointments', require('../routes/appointmentRoutes'));
app.use('/api/medical-records', require('../routes/medicalRecordRoutes'));
app.use('/api/prescriptions', require('../routes/prescriptionRoutes'));
app.use('/api/chat', require('../routes/chatMessageRoutes'));
app.use('/api/upload', require('../routes/uploadRoutes'));

// === Health Check & Root Route ===
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'PetCare Connect Backend is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.status(200).json({
    message: '🐾 Welcome to PetCare Connect API 🏥',
    version: '1.0.0',
    documentation: '/health',
    endpoints: {
      auth: '/api/auth',
      owners: '/api/owners',
      pets: '/api/pets',
      clinics: '/api/clinics',
      vets: '/api/vets',
      appointments: '/api/appointments',
      medicalRecords: '/api/medical-records',
      prescriptions: '/api/prescriptions',
      chat: '/api/chat',
      upload: '/api/upload'
    }
  });
});

// === Global Error Handler ===
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.message });
  }
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'production' ? {} : err.message
  });
});

// === 404 Handler ===
app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
    requestedUrl: req.originalUrl
  });
});

// === Start Server ===
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Access at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received: Closing server...');
  server.close(() => {
    mongoose.connection.close();
  });
});

module.exports = app;