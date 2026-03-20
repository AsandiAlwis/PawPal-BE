const mongoose = require('mongoose');
const Clinic = require('./models/Clinic');
const dotenv = require('dotenv');
dotenv.config();

async function checkClinic() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/PetCare?retryWrites=true&w=majority');
  const clinic = await Clinic.findById('694fc4d6ca17c25090ce82eb');
  console.log('Clinic Info:', clinic);
  process.exit(0);
}
checkClinic();
