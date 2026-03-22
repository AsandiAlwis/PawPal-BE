const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function checkVetVeryRaw() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const vets = await db.collection('veterinarians').find({}).toArray();
    
    console.log(`Reviewing all ${vets.length} vets...`);
    vets.forEach(v => {
       console.log(`ID: ${v._id}, Email: ${v.email}, VetID: ${v.hasOwnProperty('veterinaryId') ? (v.veterinaryId === null ? "null" : (v.veterinaryId === "" ? '""' : v.veterinaryId)) : "MISSING"}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkVetVeryRaw();
