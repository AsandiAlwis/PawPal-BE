const mongoose = require('mongoose');
const MedicalRecord = require('./models/MedicalRecord');
const dotenv = require('dotenv');
dotenv.config();

async function checkRecord() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const count = await MedicalRecord.countDocuments({});
  console.log('MedicalRecord count in "test":', count);
  process.exit(0);
}
checkRecord();
