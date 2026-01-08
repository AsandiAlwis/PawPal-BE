const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
  petId: { type: mongoose.Schema.Types.ObjectId, ref: 'PetProfile', required: true },
  medicalRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalRecord' },
  medicationName: { type: String, required: true },
  dosage: { type: String, required: true },
  duration: { type: String, required: true },
  instructions: { type: String },
  type: { type: String, enum: ['Medication', 'Vaccination'], required: true },
  dueDate: { type: Date }
});

module.exports = mongoose.model('Prescription', prescriptionSchema);