const mongoose = require('mongoose');

const petProfileSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PetOwner', required: true },
  name: { type: String, required: true },
  species: { type: String, required: true },
  breed: { type: String },
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  color: { type: String },
  weight: { type: Number },
  microchipNumber: { type: String },
  photo: { type: String }, // URL to image
  notes: { type: String },
  registrationStatus: { 
    type: String, 
    enum: ['Pending', 'Approved', 'Rejected'], 
    default: 'Pending' 
  },
  registeredClinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },

  // === ADD THESE SOFT DELETE FIELDS ===
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null }
});

// Optional: Create index for better query performance
petProfileSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('PetProfile', petProfileSchema);