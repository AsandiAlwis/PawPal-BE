const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Veterinarian = require('./models/Veterinarian');
dotenv.config();

async function checkVets() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const nullVets = await Veterinarian.find({ veterinaryId: null });
    console.log(`Found ${nullVets.length} vets with veterinaryId: null`);
    nullVets.forEach(v => {
      console.log(`- ${v.email} (${v._id})`);
    });

    const emptyStringVets = await Veterinarian.find({ veterinaryId: "" });
    console.log(`Found ${emptyStringVets.length} vets with veterinaryId: ""`);
    emptyStringVets.forEach(v => {
      console.log(`- ${v.email} (${v._id})`);
    });

    const allVets = await Veterinarian.find({});
    console.log(`Total vets: ${allVets.length}`);

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkVets();
