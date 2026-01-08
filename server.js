const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Adjust for production
  credentials: true
}));
app.use(express.json({ limit: '10mb' })); // Increased limit for file uploads later
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1); // Exit process if DB fails
  });

// === API Routes ===
app.use('/api/auth', require('./routes/authRoutes'));                    // Login & /me
app.use('/api/owners', require('./routes/petOwnerRoutes'));              // Pet owners
app.use('/api/pets', require('./routes/petProfileRoutes'));              // Pet profiles
app.use('/api/clinics', require('./routes/clinicRoutes'));               // Clinics
app.use('/api/vets', require('./routes/veterinarianRoutes'));            // Veterinarians
app.use('/api/appointments', require('./routes/appointmentRoutes'));     // Appointments
app.use('/api/medical-records', require('./routes/medicalRecordRoutes')); // Medical records
app.use('/api/prescriptions', require('./routes/prescriptionRoutes'));   // Prescriptions & vaccinations
app.use('/api/chat', require('./routes/chatMessageRoutes'));             // Chat messages

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
      chat: '/api/chat'
    }
  });
});

// === Global Error Handler ===
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'production' ? {} : err.message
  });
});

// === 404 Handler === (Place this AFTER all your routes)
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

module.exports = app; // For testing