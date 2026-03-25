const mongoose = require('mongoose');
require('dotenv').config();
const PetProfile = require('./models/PetProfile');

async function checkPets() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const pets = await PetProfile.find({}, '_id name registeredClinicId');
    console.log('Pets List:', JSON.stringify(pets, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkPets();
