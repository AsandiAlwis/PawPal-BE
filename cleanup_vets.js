const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Veterinarian = require('./models/Veterinarian');
dotenv.config();

async function fixVetData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // 1. Unset veterinaryId where it is null or empty string
    const result = await Veterinarian.updateMany(
      { $or: [ { veterinaryId: null }, { veterinaryId: "" } ] },
      { $unset: { veterinaryId: "" } }
    );

    console.log(`Updated ${result.modifiedCount} vets by unsetting veterinaryId`);

    // 2. Double check
    const nullVets = await Veterinarian.find({ veterinaryId: null });
    console.log(`Remaining vets with veterinaryId: null (should be 0): ${nullVets.length}`);

    await mongoose.disconnect();
    console.log('Disconnected');
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}

fixVetData();
