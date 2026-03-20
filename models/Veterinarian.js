const mongoose = require('mongoose');

const veterinarianSchema = new mongoose.Schema({
  ownedClinics: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: []
  }],
  assignedClinics: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: []
  }],

  // This is what you have
  currentActiveClinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic'
  },

  // Add this for backward compatibility with code expecting clinicId
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic'
  },

  firstName: { type: String },
  lastName: { type: String },
  phoneNumber: { type: String }, // Optional for Google Auth users
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String }, // Optional for Google Auth users
  googleId: { type: String, unique: true, sparse: true },
  twoFactorSecret: { type: String },
  isTwoFactorEnabled: { type: Boolean, default: false },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  veterinaryId: { type: String, unique: true, sparse: true },
  specialization: { type: String },
  address: { type: String },

  accessLevel: {
    type: String,
    enum: ['Enhanced', 'Basic'],
    required: true
  },

  status: {
    type: String,
    enum: ['Active', 'Deactivated', 'Deleted'],
    default: 'Active'
  },

  // Add this field
  isPrimaryVet: {
    type: Boolean,
    default: false
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  // Add this to handle populate errors gracefully
  strictPopulate: false
});

/*
// Update timestamp
veterinarianSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

*/

// Add a virtual field to map currentActiveClinicId to clinicId for compatibility
veterinarianSchema.virtual('primaryClinicId').get(function () {
  return this.currentActiveClinicId || this.clinicId;
});

module.exports = mongoose.model('Veterinarian', veterinarianSchema);