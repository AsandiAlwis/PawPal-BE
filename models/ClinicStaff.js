// models/ClinicStaff.js
const mongoose = require('mongoose');

const clinicStaffSchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: false
  },
  assignedClinics: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic'
  }],
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phoneNumber: { type: String },
  passwordHash: { type: String, required: false }, // Optional for Google Auth users
  googleId: { type: String, unique: true, sparse: true },
  role: {
    type: String,
    required: true
  },
  accessLevel: {
    type: String,
    enum: ['Enhanced', 'Basic'],
    default: 'Basic'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Veterinarian',
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Deleted'],
    default: 'Active'
  }
}, { timestamps: true });

module.exports = mongoose.model('ClinicStaff', clinicStaffSchema);