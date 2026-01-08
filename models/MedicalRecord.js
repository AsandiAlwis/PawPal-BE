const mongoose = require('mongoose');

const medicalRecordSchema = new mongoose.Schema({
  petId: { type: mongoose.Schema.Types.ObjectId, ref: 'PetProfile', required: true },
  vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true },
  date: { type: Date, default: Date.now },
  diagnosis: { type: String },
  treatmentNotes: { type: String },
  visibleToOwner: { type: Boolean, default: false },
  attachments: [{ type: String }] // Array of URLs
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);