const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const dotenv = require('dotenv');
dotenv.config();

async function checkTestDB() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const count = await Appointment.countDocuments({ status: 'Completed' });
  console.log('Completed appts in "test" DB:', count);
  process.exit(0);
}
checkTestDB();
