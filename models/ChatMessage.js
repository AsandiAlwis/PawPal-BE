const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  petId: { type: mongoose.Schema.Types.ObjectId, ref: 'PetProfile', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Owner or Vet ID
  senderType: { type: String, enum: ['Owner', 'Vet'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  attachments: [{ type: String }] // Array of URLs
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);