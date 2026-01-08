const mongoose = require('mongoose');

const veterinarianSchema = new mongoose.Schema({
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' }, // Required for Normal Access
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  veterinaryId: { type: String, required: true }, // License ID
  specialization: { type: String },
  accessLevel: { type: String, enum: ['Primary', 'Full Access', 'Normal Access'], required: true },
  isPrimaryVet: { type: Boolean, default: false },
  createdByVetId: { type: mongoose.Schema.Types.ObjectId, ref: 'Veterinarian' },
  status: { type: String, enum: ['Active', 'Deactivated'], default: 'Active' }
});

module.exports = mongoose.model('Veterinarian', veterinarianSchema);