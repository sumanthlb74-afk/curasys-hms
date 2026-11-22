import mongoose from 'mongoose';
import { prescriptionAdviceSuggestions, prescriptionTimings } from '../../shared/constants.js';

const medicineSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  dosage: { type: String, required: true, trim: true, maxlength: 100 },
  frequency: { type: String, required: true, trim: true, maxlength: 100 },
  duration: { type: String, required: true, trim: true, maxlength: 100 },
  timing: { type: String, enum: ['', ...prescriptionTimings], default: '' },
  route: { type: String, trim: true, default: '', maxlength: 50 },
  instructions: { type: String, trim: true, default: '', maxlength: 500 },
}, { _id: false });

const adviceSchema = new mongoose.Schema({
  suggestions: { type: [{ type: String, enum: prescriptionAdviceSuggestions }], default: [] },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  medicines: { type: [medicineSchema], required: true, validate: [(items) => items.length > 0, 'At least one medicine is required.'] },
  diagnosis: { type: String, required: true, trim: true, maxlength: 2000 },
  instructions: { type: String, trim: true, default: '', maxlength: 2000 },
  followUp: { type: String, trim: true, default: '', maxlength: 500 },
  advice: { type: adviceSchema, default: () => ({}) },
}, { timestamps: true });

export default mongoose.models.Prescription || mongoose.model('Prescription', prescriptionSchema);
