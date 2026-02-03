const mongoose = require('mongoose');

const veterinarianSchema = new mongoose.Schema({
  ownedClinics: [{ 
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
  
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  veterinaryId: { type: String, required: true, unique: true },
  specialization: { type: String },
  
  accessLevel: { 
    type: String, 
    enum: ['Primary', 'Full Access', 'Normal Access'], 
    required: true 
  },
  
  status: { 
    type: String, 
    enum: ['Active', 'Deactivated'], 
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
veterinarianSchema.virtual('primaryClinicId').get(function() {
  return this.currentActiveClinicId || this.clinicId;
});

module.exports = mongoose.model('Veterinarian', veterinarianSchema);