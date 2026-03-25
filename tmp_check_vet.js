const mongoose = require('mongoose');
require('dotenv').config();
const Veterinarian = require('./models/Veterinarian');

async function checkVet() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const riona = await Veterinarian.findOne({ email: 'riona@gmail.com' });
    console.log('Riona Data:', JSON.stringify(riona, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkVet();
