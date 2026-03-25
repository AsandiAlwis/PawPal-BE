const ChatMessage = require('../models/ChatMessage');
const PetProfile = require('../models/PetProfile');
const mongoose = require('mongoose');

// Send a new message (Owner or Vet) — uses req.user from auth middleware
exports.sendMessage = async (req, res) => {
  try {
    const { petId, content, attachments } = req.body;
    const senderId = req.user.id;
    const senderType = req.user.role === 'owner' ? 'Owner' : 'Vet';

    if (!petId || !content?.trim()) {
      return res.status(400).json({ message: 'petId and content are required' });
    }

    const pet = await PetProfile.findById(petId)
      .select('name registeredClinicId ownerId')
      .populate([
        { path: 'ownerId', select: 'firstName lastName email' },
        { path: 'registeredClinicId', select: 'name' }
      ]);
    if (!pet) return res.status(404).json({ message: 'Pet not found' });

    const message = new ChatMessage({
      petId,
      senderId,
      senderType,
      content: content.trim(),
      attachments: attachments || [],
      timestamp: new Date()
    });

    await message.save();

    const populatedMessage = await ChatMessage.findById(message._id)
      .populate('senderId', 'firstName lastName profilePhoto specialization')
      .lean();

    // Emit via Socket.IO to the pet's chat room for real-time delivery
    const io = req.app.get('socketio');
    if (io) {
      console.log(`💬 Chat: Emitting new_message to chat_pet_${petId}`);
      io.to(`chat_pet_${petId}`).emit('new_message', populatedMessage);

      // Also emit a notification to the other party's room
      if (senderType === 'Owner') {
        const clinicId = pet.registeredClinicId?._id || pet.registeredClinicId;
        if (clinicId) {
          console.log(`📡 Chat: Notifying clinic_${clinicId} about new message`);
          io.to(`clinic_${clinicId}`).emit('chat_notification', {
            petId,
            petName: pet.name,
            senderName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Owner',
            content: content.trim()
          });
        }
      } else {
        const ownerId = pet.ownerId?._id || pet.ownerId;
        if (ownerId) {
          console.log(`📡 Chat: Notifying user_${ownerId} about new message`);
          io.to(`user_${ownerId}`).emit('chat_notification', {
            petId,
            petName: pet.name,
            senderName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Vet',
            content: content.trim()
          });
        }
      }
    }

    res.status(201).json({ message: 'Message sent', data: populatedMessage });
  } catch (error) {
    res.status(400).json({ message: 'Error sending message', error: error.message });
  }
};

// Get full chat history for a pet
exports.getChatHistory = async (req, res) => {
  try {
    const { petId } = req.params;
    const { limit = 60, page = 1 } = req.query;

    const messages = await ChatMessage.find({ petId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('senderId', 'firstName lastName profilePhoto specialization')
      .lean();

    const chronological = messages.reverse();
    const total = await ChatMessage.countDocuments({ petId });

    res.status(200).json({
      messages: chronological,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), hasMore: chronological.length === parseInt(limit) }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching chat history', error: error.message });
  }
};

// Get chat list for the authenticated user
exports.getUserChatList = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role; // 'owner' or 'vet'

    let matchCondition;

    if (userRole === 'owner') {
      const ownerPets = await PetProfile.find({ ownerId: userId }).select('_id');
      const petIds = ownerPets.map(p => p._id);
      matchCondition = { petId: { $in: petIds } };
    } else {
      // Vet: get all chats this vet sent OR any chats for pets registered in their clinic
      matchCondition = { senderId: userId };
      // Also include chats for pets at their clinic
      if (req.user.clinicId) {
        const clinicPets = await PetProfile.find({ registeredClinicId: req.user.clinicId }).select('_id');
        const clinicPetIds = clinicPets.map(p => p._id);
        matchCondition = { petId: { $in: clinicPetIds } };
      }
    }

    const chats = await ChatMessage.aggregate([
      { $match: matchCondition },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$petId',
          latestMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isRead', false] },
                    { $ne: ['$senderId', new mongoose.Types.ObjectId(userId)] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'petprofiles',
          localField: '_id',
          foreignField: '_id',
          as: 'pet'
        }
      },
      { $unwind: '$pet' },
      {
        $lookup: {
          from: 'petowners',
          localField: 'pet.ownerId',
          foreignField: '_id',
          as: 'owner'
        }
      },
      { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          petId: '$_id',
          petName: '$pet.name',
          petPhoto: '$pet.photo',
          petSpecies: '$pet.species',
          ownerName: { $concat: ['$owner.firstName', ' ', '$owner.lastName'] },
          ownerId: '$pet.ownerId',
          unreadCount: 1,
          latestMessage: {
            content: '$latestMessage.content',
            timestamp: '$latestMessage.timestamp',
            senderType: '$latestMessage.senderType'
          }
        }
      },
      { $sort: { 'latestMessage.timestamp': -1 } }
    ]);

    res.status(200).json({ count: chats.length, chats });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching chat list', error: error.message });
  }
};

// Get the latest message for a pet (preview)
exports.getLatestMessageByPet = async (req, res) => {
  try {
    const { petId } = req.params;
    const latestMessage = await ChatMessage.findOne({ petId })
      .sort({ timestamp: -1 })
      .populate('senderId', 'firstName lastName')
      .lean();
    res.status(200).json(latestMessage || null);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching latest message', error: error.message });
  }
};

// Mark messages as read (placeholder)
exports.markMessagesAsRead = async (req, res) => {
  try {
    const { petId } = req.body;
    if (!petId) return res.status(400).json({ message: 'petId is required' });

    const userRole = req.user.role === 'owner' ? 'Owner' : 'Vet';
    const senderToMark = userRole === 'Owner' ? 'Vet' : 'Owner';

    const result = await ChatMessage.updateMany(
      {
        petId,
        senderType: senderToMark,
        isRead: { $ne: true }
      },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: 'Messages marked as read',
      modified: result.modifiedCount > 0
    });
  } catch (error) {
    res.status(500).json({ message: 'Error marking messages as read', error: error.message });
  }
};