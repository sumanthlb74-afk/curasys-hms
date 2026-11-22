import mongoose from 'mongoose';
import { preliminaryCheckSymptoms } from '../../shared/constants.js';

const vitalSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  enteredByRole: { type: String, enum: ['', 'doctor', 'staff', 'admin'], default: '' },
  symptoms: { type: [{ type: String, enum: preliminaryCheckSymptoms }], default: [] },
  symptomOther: { type: String, trim: true, maxlength: 200, default: '' },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  editedAt: { type: Date, default: null },
  heartRate: { type: Number, min: 20, max: 300, default: null },
  systolic: { type: Number, min: 40, max: 300, default: null },
  diastolic: { type: Number, min: 20, max: 200, default: null },
  respiratoryRate: { type: Number, min: 1, max: 100, default: null },
  temperatureC: { type: Number, min: 25, max: 45, default: null },
  bloodGlucose: { type: Number, min: 1, max: 2000, default: null },
  oxygenSaturation: { type: Number, min: 1, max: 100, default: null },
  heightCm: { type: Number, min: 30, max: 250, default: null },
  weightKg: { type: Number, min: 1, max: 500, default: null },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
}, { timestamps: true });

export default mongoose.models.Vital || mongoose.model('Vital', vitalSchema);
