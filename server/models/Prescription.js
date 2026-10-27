import mongoose from 'mongoose';

const medicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  dosage: { type: String, required: true, trim: true, maxlength: 100 },
  frequency: { type: String, required: true, trim: true, maxlength: 100 },
  duration: { type: String, required: true, trim: true, maxlength: 100 },
  route: { type: String, trim: true, default: '', maxlength: 50 },
  instructions: { type: String, trim: true, default: '', maxlength: 500 },
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  medicines: { type: [medicineSchema], required: true, validate: [(items) => items.length > 0, 'At least one medicine is required.'] },
  diagnosis: { type: String, required: true, trim: true, maxlength: 2000 },
  instructions: { type: String, trim: true, default: '', maxlength: 2000 },
  followUp: { type: String, trim: true, default: '', maxlength: 500 },
}, { timestamps: true });

export default mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);
