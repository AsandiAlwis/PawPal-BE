const express = require('express');
const router = express.Router();
const {
  sendMessage,
  getChatHistory,
  getLatestMessageByPet,
  getUserChatList,
  markMessagesAsRead
} = require('../controllers/chatMessageController');

// Import authentication middleware
const { protect, authorize } = require('../middleware/auth');
const PetProfile = require('../models/PetProfile');

// Middleware: Ensure user is authorized to access this pet's chat
const authorizePetChat = async (req, res, next) => {
  try {
    const { petId } = req.params;
    const pet = await PetProfile.findById(petId)
      .populate('registeredClinicId');

    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    const isOwner = req.user.role === 'owner' && pet.ownerId.toString() === req.user.id;
    const isVetFromClinic = req.user.role === 'vet' &&
      pet.registeredClinicId &&
      pet.registeredClinicId._id.toString() === req.user.clinicId;

    if (!isOwner && !isVetFromClinic) {
      return res.status(403).json({
        message: 'Not authorized to access chat for this pet'
      });
    }

    // Attach pet for potential use in controller
    req.pet = pet;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error in chat authorization', error: error.message });
  }
};

// === Protected Routes - All require login ===
router.use(protect); // All chat routes require authentication

// Send a message (Owner or Vet)
router.post('/send', sendMessage);

// Get full chat history for a pet (Owner or Vet from registered clinic)
router.get('/history/:petId', authorizePetChat, getChatHistory);

// Get latest message preview for a pet
router.get('/latest/:petId', authorizePetChat, getLatestMessageByPet);

// Get user's chat list (all conversations they participate in)
router.get('/user-chats', getUserChatList);

// Mark messages as read (future feature)
router.patch('/read', markMessagesAsRead);

module.exports = router;