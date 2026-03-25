const mongoose = require('mongoose');
require('dotenv').config();
const Clinic = require('./models/Clinic');

async function checkClinics() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const clinics = await Clinic.find({}, '_id name');
    console.log('Clinics List:', JSON.stringify(clinics, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkClinics();
