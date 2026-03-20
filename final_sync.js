const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const MedicalRecord = require('./models/MedicalRecord');
const dotenv = require('dotenv');
dotenv.config();

async function finalSync() {
  const uri = 'mongodb+srv://saman2020al_db_user:C7yfY6OEsM3pobh5@pawpal.jkf03x8.mongodb.net/test?retryWrites=true&w=majority';
  await mongoose.connect(uri);
  
  // Find appointments with either legacy medicalRecordUrl OR prescriptionUrl
  const appointments = await Appointment.find({ 
    $or: [{ prescriptionUrl: { $ne: null } }, { medicalRecordUrl: { $ne: null } }] 
  });
  
  console.log(`Found ${appointments.length} appointments with documents.`);
  let synced = 0;

  for (const appt of appointments) {
    // Try to find by appointmentId first (new records have it)
    let medRecord = await MedicalRecord.findOne({ appointmentId: appt._id });
    
    // If not found, try to find by petId and roughly the same date
    if (!medRecord) {
      const dateStart = new Date(appt.dateTime);
      dateStart.setHours(0,0,0,0);
      const dateEnd = new Date(appt.dateTime);
      dateEnd.setHours(23,59,59,999);
      
      medRecord = await MedicalRecord.findOne({
        petId: appt.petId?._id || appt.petId,
        date: { $gte: dateStart, $lte: dateEnd }
      });
    }

    if (medRecord) {
      let changed = false;
      if (appt.prescriptionUrl && medRecord.prescriptionUrl !== appt.prescriptionUrl) {
        medRecord.prescriptionUrl = appt.prescriptionUrl;
        changed = true;
      }
      if (!medRecord.appointmentId) {
        medRecord.appointmentId = appt._id;
        changed = true;
      }
      // Also ensure medicalRecordUrl is in attachments
      if (appt.medicalRecordUrl && !medRecord.attachments.includes(appt.medicalRecordUrl)) {
        medRecord.attachments.push(appt.medicalRecordUrl);
        changed = true;
      }

      if (changed) {
        await medRecord.save();
        synced++;
      }
    }
  }

  console.log(`Final sync completed. Updated ${synced} medical records.`);
  process.exit(0);
}
finalSync();
