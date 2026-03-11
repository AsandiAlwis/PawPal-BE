require('dotenv').config();
const mongoose = require('mongoose');
const Veterinarian = require('./models/Veterinarian');
const PetProfile = require('./models/PetProfile');

async function fix() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('connected');

    // manually trigger markNotificationAsRead directly to test
    const { markNotificationAsRead } = require('./controllers/veterinarianController');

    // find a pending pet
    const pending = await PetProfile.findOne({ registrationStatus: 'Pending', isReadByVet: { $ne: true } });
    if (!pending) { console.log('No pending pets'); return; }

    const req = { params: { type: 'registration', id: pending._id.toString() } };
    const res = {
        status: (code) => ({ json: (data) => console.log('res:', code, data) }),
        json: (data) => console.log('res json:', data)
    };

    console.log('Testing controller handler directly...');
    await markNotificationAsRead(req, res);

    const updated = await PetProfile.findById(pending._id);
    console.log('isReadByVet after:', updated.isReadByVet);

    await mongoose.disconnect();
}

fix();
