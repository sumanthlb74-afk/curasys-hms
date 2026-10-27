import mongoose from 'mongoose';

const vitalSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
