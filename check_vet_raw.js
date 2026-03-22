const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function checkVetRaw() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const vets = await db.collection('veterinarians').find({}).toArray();
    
    console.log(`Analyzing ${vets.length} vets...`);
    vets.forEach(v => {
      const hasKey = v.hasOwnProperty('veterinaryId');
      const val = v.veterinaryId;
      if (hasKey || val !== undefined) {
         console.log(`- ${v.email}: keyExists=${hasKey}, value=${val === null ? 'null' : (val === '' ? '""' : val)}`);
      }
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkVetRaw();
