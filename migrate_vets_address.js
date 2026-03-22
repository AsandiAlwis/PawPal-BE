const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Veterinarian = require('./models/Veterinarian');
dotenv.config();

async function migrateVets() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find vets who were added via dashboard but have no address
    const result = await Veterinarian.updateMany(
      { 
        createdByVetId: { $ne: null },
        $or: [ { address: null }, { address: "" } ]
      },
      { $set: { address: 'Registered by Clinic' } }
    );

    console.log(`Updated ${result.modifiedCount} dashboard-added vets by setting default address`);

    await mongoose.disconnect();
    console.log('Disconnected');
  } catch (err) {
    console.error('Error during migration:', err);
  }
}

migrateVets();
