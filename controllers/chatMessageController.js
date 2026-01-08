const ChatMessage = require('../models/ChatMessage');
const PetProfile = require('../models/PetProfile');

// Send a new message (Owner or Vet)
exports.sendMessage = async (req, res) => {
  try {
    const { petId, senderId, senderType, content, attachments } = req.body;

    // Validation
    if (!petId || !senderId || !senderType || !content?.trim()) {
      return res.status(400).json({
        message: 'petId, senderId, senderType, and non-empty content are required'
      });
    }

    if (!['Owner', 'Vet'].includes(senderType)) {
      return res.status(400).json({
        message: 'senderType must be "Owner" or "Vet"'
      });
    }

    // Verify that the pet exists and is registered (optional strict check)
    const pet = await PetProfile.findById(petId).select('name registeredClinicId ownerId');
    if (!pet) {
      return res.status(404).json({ message: 'Pet not found' });
    }

    // Optional: Add access control later via middleware
    // e.g., ensure sender is either the owner or a vet from the registered clinic

    const message = new ChatMessage({
      petId,
      senderId,
      senderType,
      content: content.trim(),
      attachments: attachments || [],
      timestamp: new Date() // Explicitly set (though default exists)
    });

    await message.save();

    // Populate sender info for better frontend display
    const populatedMessage = await ChatMessage.findById(message._id)
      .populate('senderId', 'firstName lastName profilePhoto') // Works if sender is Owner or Vet (assuming similar fields)
      .lean();

    // For real-time: This data will be broadcasted via Socket.io later
    res.status(201).json({
      message: 'Message sent successfully',
      data: populatedMessage
    });
  } catch (error) {
    res.status(400).json({
      message: 'Error sending message',
      error: error.message
    });
  }
};

// Get chat history for a specific pet (with pagination)
exports.getChatHistory = async (req, res) => {
  try {
    const { petId } = req.params;
    const { limit = 50, page = 1, before } = req.query;

    if (!petId) {
      return res.status(400).json({ message: 'petId is required' });
    }

    const query = { petId };

    // Optional: Load messages before a specific timestamp (for infinite scroll)
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    const messages = await ChatMessage.find(query)
      .sort({ timestamp: -1 }) // Newest first for pagination
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('senderId', 'firstName lastName profilePhoto specialization') // Vet may have specialization
      .lean();

    // Reverse to return in chronological order (oldest → newest)
    const chronologicalMessages = messages.reverse();

    // Get total count for pagination metadata
    const total = await ChatMessage.countDocuments({ petId });

    res.status(200).json({
      messages: chronologicalMessages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: chronologicalMessages.length === parseInt(limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching chat history',
      error: error.message
    });
  }
};

// Get the latest message for a pet (useful for chat list preview)
exports.getLatestMessageByPet = async (req, res) => {
  try {
    const { petId } = req.params;

    const latestMessage = await ChatMessage.findOne({ petId })
      .sort({ timestamp: -1 })
      .populate('senderId', 'firstName lastName')
      .lean();

    res.status(200).json(latestMessage || null);
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching latest message',
      error: error.message
    });
  }
};

// Get all active chat conversations for a user (Owner or Vet)
// For chat list/dashboard
exports.getUserChatList = async (req, res) => {
  try {
    const { userId, userType } = req.query; // Will come from auth later

    if (!userId || !['Owner', 'Vet'].includes(userType)) {
      return res.status(400).json({
        message: 'userId and valid userType (Owner/Vet) are required'
      });
    }

    let matchCondition;
    if (userType === 'Owner') {
      // Get pets owned by user, then latest message per pet
      const ownerPets = await PetProfile.find({ ownerId: userId }).select('_id');
      const petIds = ownerPets.map(p => p._id);

      matchCondition = { petId: { $in: petIds } };
    } else {
      // Vet: messages where they are the sender
      matchCondition = { senderId: userId, senderType: 'Vet' };
    }

    const chats = await ChatMessage.aggregate([
      { $match: matchCondition },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$petId',
          latestMessage: { $first: '$$ROOT' },
          unreadCount: { $sum: 0 } // Placeholder – implement with read receipts later
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
      { $unwind: { path: '$owner', preserveNullOrEmptyArrays: true } },
      {
        $project: {
          petId: '$_id',
          petName: '$pet.name',
          petPhoto: '$pet.photo',
          ownerName: { $concat: ['$owner.firstName', ' ', '$owner.lastName'] },
          latestMessage: {
            content: '$latestMessage.content',
            timestamp: '$latestMessage.timestamp',
            senderType: '$latestMessage.senderType'
          }
        }
      },
      { $sort: { 'latestMessage.timestamp': -1 } }
    ]);

    res.status(200).json({
      count: chats.length,
      chats
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error fetching user chat list',
      error: error.message
    });
  }
};

// Mark messages as read (future enhancement placeholder)
exports.markMessagesAsRead = async (req, res) => {
  try {
    const { petId, userId } = req.body;
    // Implement read receipts logic here (e.g., separate ReadReceipt model)
    res.status(200).json({ message: 'Messages marked as read (feature pending)' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};