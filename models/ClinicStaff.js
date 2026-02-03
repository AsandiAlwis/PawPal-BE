// models/ClinicStaff.js
const mongoose = require('mongoose');

const clinicStaffSchema = new mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true
  },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phoneNumber: { type: String },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: [
      'Receptionist',
      'Vet Tech',
      'Assistant',
      'Manager',
      'Kennel Staff'
    ],
    required: true
  },
  accessLevel: {
    type: String,
    enum: ['Basic', 'Moderate', 'Admin'],
    default: 'Basic'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Veterinarian',
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive','Deleted'],
    default: 'Active'
  }
}, { timestamps: true });

module.exports = mongoose.model('ClinicStaff', clinicStaffSchema);