const mongoose = require('mongoose');
const { Schema } = mongoose;

const prescriptionSchema = new Schema({
  petId: {
    type: Schema.Types.ObjectId,
    ref: 'PetProfile',
    required: true
  },
  medicalRecordId: {
    type: Schema.Types.ObjectId,
    ref: 'MedicalRecord',
    default: null
  },
  medicationName: {
    type: String,
    required: true,
    trim: true
  },
  dosage: {
    type: String,
    required: true,
    trim: true
  },
  duration: {
    type: String,
    trim: true,
    default: ''
  },
  instructions: {
    type: String,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    enum: ['Medication', 'Vaccination'],
    required: true
  },
  dueDate: {
    type: Date,
    default: null
  },
  // ← Added: Tracks which vet created the prescription
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'Veterinarian',  // Change to 'Vet' if you have a separate Vet model
    required: true
  },
  // Soft delete fields (good practice)
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true  // Automatically adds createdAt and updatedAt
});

module.exports = mongoose.model('Prescription', prescriptionSchema);