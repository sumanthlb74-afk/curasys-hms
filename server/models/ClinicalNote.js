import mongoose from 'mongoose';

const clinicalNoteSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  chiefComplaint: { type: String, required: true, trim: true, maxlength: 1000 },
  historyOfPresentIllness: { type: String, trim: true, default: '', maxlength: 3000 },
  examination: { type: String, trim: true, default: '', maxlength: 3000 },
  assessment: { type: String, required: true, trim: true, maxlength: 2000 },
  plan: { type: String, required: true, trim: true, maxlength: 3000 },
  followUp: { type: String, trim: true, default: '', maxlength: 1000 },
}, { timestamps: true });

export default mongoose.models.ClinicalNote || mongoose.model('ClinicalNote', clinicalNoteSchema);
