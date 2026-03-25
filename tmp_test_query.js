const mongoose = require('mongoose');
require('dotenv').config();
const Veterinarian = require('./models/Veterinarian');

async function testQuery() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const clinicIdStr = '69b6c5550159fad320915521'; // Test Clinic
    const mongooseClinicId = new mongoose.Types.ObjectId(clinicIdStr);

    const vets = await Veterinarian.find({
      $or: [
        { currentActiveClinicId: mongooseClinicId },
        { clinicId: mongooseClinicId },
        { ownedClinics: { $in: [mongooseClinicId] } },
        { assignedClinics: { $in: [mongooseClinicId] } }
      ],
      status: 'Active'
    });

    console.log('Vets for Test Clinic:', vets.map(v => `${v.firstName} ${v.lastName} (${v._id})`));
    
    // Check Riona specifically
    const riona = await Veterinarian.findById('69c0f7bba25214e998be3a76');
    console.log('Riona Detailed:', JSON.stringify(riona, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testQuery();
