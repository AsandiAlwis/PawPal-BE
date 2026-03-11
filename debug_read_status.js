const mongoose = require('mongoose');
const PetProfile = require('./models/PetProfile');
const Appointment = require('./models/Appointment');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected');

    const pending = await PetProfile.find({ registrationStatus: 'Pending' }).select('name isReadByVet');
    console.log('Pending Pets Read Status:');
    pending.forEach(p => console.log(`${p.name}: ${p.isReadByVet}`));

    const apps = await Appointment.find({ status: { $in: ['Booked', 'Confirmed'] } }).select('status dateTime isReadByVet');
    console.log('Upcoming Apps Read Status:');
    apps.forEach(a => console.log(`${a.status} @ ${a.dateTime}: ${a.isReadByVet}`));

    await mongoose.disconnect();
}

check();
