const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: false, default: '' }, // ← Now optional
  phoneNumber: { type: String, required: true },
  operatingHours: { type: String, default: '' },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
  },
  primaryVetId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Veterinarian', 
    required: false,  // ← Now optional (set after vet creation)
    default: null 
  },
  description: { type: String, default: '' }
});

clinicSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Clinic', clinicSchema);