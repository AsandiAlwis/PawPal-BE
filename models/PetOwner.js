const mongoose = require('mongoose');

const petOwnerSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  address: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String }, // Optional for Google Auth users
  googleId: { type: String, unique: true, sparse: true },
  twoFactorSecret: { type: String },
  isTwoFactorEnabled: { type: Boolean, default: false },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  profilePhoto: { type: String }, // URL to image
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

petOwnerSchema.index({ location: '2dsphere' }); // For geo queries (nearby clinics)

module.exports = mongoose.model('PetOwner', petOwnerSchema);