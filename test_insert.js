const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Veterinarian = require('./models/Veterinarian');
dotenv.config();

async function testInsert() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const uniqueId = 'test-' + Date.now();
    const newVet = new Veterinarian({
       firstName: 'Test',
       lastName: 'Insertion',
       email: `${uniqueId}@test.com`,
       accessLevel: 'Basic'
    });
    
    console.log('Attempting save with MISSING veterinaryId...');
    await newVet.save();
    console.log('Save SUCCESSFUL!');
    
    // cleanup
    // await Veterinarian.deleteOne({ email: `${uniqueId}@test.com` });

    await mongoose.disconnect();
  } catch (err) {
    console.error('Save FAILED:', err);
  }
}

testInsert();
