const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const dotenv = require('dotenv');
dotenv.config();

async function checkAppt() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/PetCare?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const appt = await Appointment.findOne({ status: 'Completed' });
  if (appt) {
    console.log('Appt fields:', Object.keys(appt.toObject()));
    console.log('Appt data:', appt.toObject());
  } else {
    console.log('No completed appt found');
  }
  process.exit(0);
}
checkAppt();
