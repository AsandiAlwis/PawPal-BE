const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  petId: { type: mongoose.Schema.Types.ObjectId, ref: 'PetProfile', required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PetOwner', required: true }, // ← NEW
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  vetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian', required: true },
  dateTime: { type: Date, required: true },
  status: {
    type: String,
    enum: ['Booked', 'Confirmed', 'Rescheduled', 'Canceled', 'Completed'],
    default: 'Booked'
  },
  reason: { type: String },
  notes: { type: String }, // Owner notes
  diagnosis: { type: String }, // ← NEW
  medicalNotes: { type: String }, // Vet notes
  medicalRecordUrl: { type: String },
  prescriptionUrl: { type: String },
  isReadByVet: { type: Boolean, default: false }
}, { timestamps: true });

// Compound index for faster queries
appointmentSchema.index({ ownerId: 1, dateTime: -1 });
appointmentSchema.index({ vetId: 1, dateTime: 1 });
appointmentSchema.index({ clinicId: 1, dateTime: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);