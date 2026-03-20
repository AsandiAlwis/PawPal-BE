const mongoose = require('mongoose');
const MedicalRecord = require('./models/MedicalRecord');
const dotenv = require('dotenv');
dotenv.config();

async function checkRecordFields() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  const record = await MedicalRecord.findOne();
  console.log('Record fields:', Object.keys(record.toObject()));
  console.log('Record data:', record.toObject());
  process.exit(0);
}
checkRecordFields();
