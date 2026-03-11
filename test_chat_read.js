const mongoose = require('mongoose');
require('dotenv').config();

async function testRead() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('connected');

    const ChatMessage = require('./models/ChatMessage');
    const unreadCount = await ChatMessage.countDocuments({ senderType: 'Owner', isRead: { $ne: true } });
    console.log('Unread Owner messages before:', unreadCount);

    // Mark one pet's messages
    const oneUnread = await ChatMessage.findOne({ senderType: 'Owner', isRead: { $ne: true } });
    if (oneUnread) {
        console.log('Found unread message for pet:', oneUnread.petId);

        const { markMessagesAsRead } = require('./controllers/chatMessageController');
        const req = {
            body: { petId: oneUnread.petId.toString() },
            user: { role: 'vet' } // simulate vet
        };
        const res = {
            status: (code) => ({ json: (data) => console.log('res:', code, data) }),
            json: (data) => console.log('res json:', data)
        };

        await markMessagesAsRead(req, res);

        const unreadCountAfter = await ChatMessage.countDocuments({ senderType: 'Owner', isRead: { $ne: true } });
        console.log('Unread Owner messages after:', unreadCountAfter);
    } else {
        console.log('No unread messages from owners found.');
    }

    await mongoose.disconnect();
}
testRead();
