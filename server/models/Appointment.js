import mongoose from 'mongoose';
import { appointmentStatuses, triageLevels } from '../../shared/constants.js';

const appointmentSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  department: { type: String, required: true, trim: true, maxlength: 100 },
  date: { type: Date, required: true },
  time: { type: String, required: true, match: /^([01]\d|2[0-3]):00$/ },
  symptoms: { type: String, required: true, trim: true, maxlength: 2000 },
  status: {
    type: String,
    enum: appointmentStatuses,
    default: 'Booked',
    index: true,
  },
  triage: {
    type: String,
    enum: triageLevels,
    default: 'OPD Routine',
  },
}, { timestamps: true });

appointmentSchema.index(
  { doctorId: 1, date: 1, time: 1 },
  {
    name: 'appointment_doctor_slot_active_unique_v2',
    unique: true,
    partialFilterExpression: { status: { $in: appointmentStatuses.filter((status) => !['Cancelled', 'Completed'].includes(status)) }, doctorId: { $type: 'objectId' } },
  },
);

export default mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
